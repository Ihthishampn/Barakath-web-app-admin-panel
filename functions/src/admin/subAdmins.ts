/**
 * Sub-admin lifecycle (super-admin only; privileged — sets custom auth claims).
 * createSubAdmin / updateSubAdmin / suspendSubAdmin / deleteSubAdmin.
 * The admins collection is CF-only-write; claims are the trust boundary.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, auth, FieldValue, callableOpts } from '../_lib/admin.js';
import { requireSuperAdmin, writeAudit } from '../_lib/guards.js';
import { buildSearchIndex } from '../_lib/search.js';

const PermsSchema = z.record(z.string(), z.record(z.string(), z.boolean()));
const RoleSchema = z.enum(['super_admin', 'sub_admin']);

type Perms = Record<string, Record<string, boolean>>;

/** True when two permission maps grant exactly the same actions. */
function permsEqual(a: Perms | undefined, b: Perms | undefined): boolean {
  const modules = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const m of modules) {
    const x = a?.[m] ?? {};
    const y = b?.[m] ?? {};
    for (const action of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (!!x[action] !== !!y[action]) return false;
    }
  }
  return true;
}

async function assertNotLastSuperAdmin(uid: string) {
  const snap = await db.collection('admins').where('role', '==', 'super_admin').where('status', '==', 'active').get();
  const others = snap.docs.filter((d) => d.id !== uid);
  if (others.length === 0) throw new HttpsError('failed-precondition', 'Cannot remove the last active super admin.');
}

export const createSubAdmin = onCall(callableOpts, async (req) => {
  const { uid: actor } = await requireSuperAdmin(req);
  const parsed = z
    .object({
      name: z.string().min(1), email: z.string().email(), password: z.string().min(6),
      phone: z.string().nullable().optional(), role: RoleSchema, modulePermissions: PermsSchema,
    })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid sub-admin payload.');
  const { name, email, password, phone, role, modulePermissions } = parsed.data;

  let user;
  try {
    user = await auth.createUser({ email, password, displayName: name, emailVerified: true });
  } catch (e) {
    // Only a genuine duplicate may be reported as one: a quota/network/password
    // failure used to surface as "email already exists" and sent the operator
    // hunting for an account that was never created.
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'An account with that email already exists.');
    }
    if (code === 'auth/invalid-password' || code === 'auth/invalid-email') {
      throw new HttpsError('invalid-argument', 'That email or password was rejected by Firebase Auth.');
    }
    throw new HttpsError('internal', 'Could not create the admin account. Please try again.');
  }

  const now = FieldValue.serverTimestamp();
  try {
    await auth.setCustomUserClaims(user.uid, { role, status: 'active' });
    await db.doc(`admins/${user.uid}`).set({
      id: user.uid, uid: user.uid, name, email, emailVerified: true, phone: phone ?? null, avatarUrl: null,
      role, status: 'active', suspendedAt: null, suspendedByUid: null, suspendReason: null,
      modulePermissions, mfaEnrolled: false, mfaMethod: null, mfaEnrolledAt: null, tokenRevokedAt: null,
      createdByUid: actor, lastLoginAt: null, lastActiveAt: now, lastPasswordChangeAt: now,
      searchIndex: buildSearchIndex([name, email, role]), createdAt: now, updatedAt: now,
    });
  } catch {
    // Anything failing after createUser leaves an Auth account with no admins
    // doc: it can authenticate but the panel rejects it, it is invisible in the
    // Sub Admin list, deleteSubAdmin can't reach it (it needs the doc) and the
    // email is burnt for every retry. Roll the account back so a retry works.
    await auth.deleteUser(user.uid).catch(() => undefined);
    throw new HttpsError('internal', 'Could not create the admin. Please try again.');
  }
  await writeAudit({ actorUid: actor, action: 'subadmin.created', entity: 'admins', entityId: user.uid, meta: { role } });
  return { ok: true, uid: user.uid };
});

export const updateSubAdmin = onCall(callableOpts, async (req) => {
  const { uid: actor } = await requireSuperAdmin(req);
  const parsed = z
    .object({
      uid: z.string().min(1), name: z.string().min(1), email: z.string().email().optional(),
      phone: z.string().nullable().optional(), role: RoleSchema, modulePermissions: PermsSchema,
    })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');
  const { uid, name, phone, role, modulePermissions } = parsed.data;

  const ref = db.doc(`admins/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Admin not found.');
  if (snap.get('role') === 'super_admin' && role !== 'super_admin') await assertNotLastSuperAdmin(uid);

  // A demotion or a narrowed permission set has to invalidate the target's
  // session the way a suspension does: custom claims only land in a NEW ID
  // token, so without a revoke the old token keeps saying `super_admin` (which
  // short-circuits every rule and guard) for up to an hour — long enough for
  // the demoted admin to mint themselves a fresh super admin. Name/phone-only
  // edits leave the session alone; there is nothing to invalidate.
  const authzChanged =
    snap.get('role') !== role || !permsEqual(snap.get('modulePermissions') as Perms, modulePermissions);
  const now = FieldValue.serverTimestamp();
  await auth.setCustomUserClaims(uid, { role, status: snap.get('status') ?? 'active' });
  if (authzChanged) await auth.revokeRefreshTokens(uid).catch(() => undefined);
  await ref.update({
    name, phone: phone ?? null, role, modulePermissions,
    tokenRevokedAt: authzChanged ? now : snap.get('tokenRevokedAt') ?? null,
    searchIndex: buildSearchIndex([name, snap.get('email'), role]), updatedAt: now,
  });
  await writeAudit({ actorUid: actor, action: 'subadmin.updated', entity: 'admins', entityId: uid });
  return { ok: true };
});

export const suspendSubAdmin = onCall(callableOpts, async (req) => {
  const { uid: actor } = await requireSuperAdmin(req);
  const parsed = z.object({ uid: z.string().min(1), suspend: z.boolean() }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');
  const { uid, suspend } = parsed.data;
  if (uid === actor) throw new HttpsError('failed-precondition', 'You cannot suspend your own account.');

  const ref = db.doc(`admins/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Admin not found.');
  if (suspend && snap.get('role') === 'super_admin') await assertNotLastSuperAdmin(uid);

  const status = suspend ? 'suspended' : 'active';
  const now = FieldValue.serverTimestamp();
  await auth.setCustomUserClaims(uid, { role: snap.get('role'), status });
  await auth.updateUser(uid, { disabled: suspend }).catch(() => undefined);
  if (suspend) await auth.revokeRefreshTokens(uid).catch(() => undefined);
  await ref.update({
    status, suspendedAt: suspend ? now : null, suspendedByUid: suspend ? actor : null,
    tokenRevokedAt: suspend ? now : snap.get('tokenRevokedAt') ?? null, updatedAt: now,
  });
  await writeAudit({ actorUid: actor, action: suspend ? 'subadmin.suspended' : 'subadmin.reactivated', entity: 'admins', entityId: uid });
  return { ok: true };
});

export const deleteSubAdmin = onCall(callableOpts, async (req) => {
  const { uid: actor } = await requireSuperAdmin(req);
  const parsed = z.object({ uid: z.string().min(1) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');
  const { uid } = parsed.data;
  if (uid === actor) throw new HttpsError('failed-precondition', 'You cannot delete your own account.');

  const ref = db.doc(`admins/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Admin not found.');
  if (snap.get('role') === 'super_admin') await assertNotLastSuperAdmin(uid);

  await auth.deleteUser(uid).catch(() => undefined);
  await ref.delete();
  await writeAudit({ actorUid: actor, action: 'subadmin.deleted', entity: 'admins', entityId: uid });
  return { ok: true };
});
