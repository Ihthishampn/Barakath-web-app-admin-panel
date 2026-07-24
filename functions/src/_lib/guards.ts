/** Auth/permission guards + audit helpers reused by every privileged callable. */
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { db, FieldValue } from './admin.js';

// Local mirrors (no workspace dep in the cloud bundle).
type ModuleKey = string;
type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'approve';

export interface AdminClaims {
  role?: 'super_admin' | 'sub_admin';
  status?: 'active' | 'suspended';
}

/** Require an authenticated admin (super or sub). Returns uid + claims. */
export function requireAdmin(req: CallableRequest): { uid: string; claims: AdminClaims } {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const claims = (req.auth.token ?? {}) as AdminClaims;
  if (claims.role !== 'super_admin' && claims.role !== 'sub_admin') {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }
  if (claims.status === 'suspended') {
    throw new HttpsError('permission-denied', 'Account suspended.');
  }
  return { uid: req.auth.uid, claims };
}

/** Require any authenticated user (customer-facing callables). */
export function requireCustomer(req: CallableRequest): { uid: string } {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Please sign in to continue.');
  return { uid: req.auth.uid };
}

/**
 * Require an authenticated customer who is not blocked.
 *
 * Blocking was a write-only flag: adminBlockUser set `isBlocked`, disabled the
 * Auth user and revoked their tokens, but nothing on any read or write path
 * ever consulted it — so a session that was already open kept ordering, topping
 * up its wallet and requesting withdrawals as if nothing had happened. Use this
 * (not requireCustomer) on anything that moves stock, money or entitlements.
 *
 * A missing customer doc is allowed through: the doc is created on profile
 * completion, and pre-profile callers are not blocked by definition.
 */
export async function requireActiveCustomer(req: CallableRequest): Promise<{ uid: string }> {
  const { uid } = requireCustomer(req);
  const snap = await db.doc(`customers/${uid}`).get();
  if (snap.exists && snap.get('isBlocked') === true) {
    throw new HttpsError(
      'permission-denied',
      'Your account has been blocked. Please contact support.',
    );
  }
  return { uid };
}

/**
 * Load the caller's stored admin doc, rejecting anything but an active admin.
 *
 * Role/status ride in the ID token as custom claims, and a token that was
 * already minted stays valid for up to an hour — revoking refresh tokens does
 * not invalidate it. So a suspended (or demoted) admin keeps a claim that says
 * otherwise for the rest of that window. firestore.rules `can()` and
 * requireReviewModeration already re-read admins/{uid} for exactly this reason;
 * every gate below does the same, and treats the stored doc as the truth.
 */
async function loadActiveAdmin(uid: string) {
  const snap = await db.doc(`admins/${uid}`).get();
  if (!snap.exists || snap.get('status') !== 'active') {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }
  return snap;
}

export async function requireSuperAdmin(req: CallableRequest): Promise<{ uid: string }> {
  const { uid } = requireAdmin(req);
  const snap = await loadActiveAdmin(uid);
  if (snap.get('role') !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Super admin only.');
  }
  return { uid };
}

/** Require a specific module+action permission on the caller's admin doc. */
export async function requireModule(
  req: CallableRequest,
  module: ModuleKey,
  action: PermissionAction,
): Promise<{ uid: string }> {
  const { uid } = requireAdmin(req);
  const snap = await loadActiveAdmin(uid);
  if (snap.get('role') === 'super_admin') return { uid };
  const perms = snap.get('modulePermissions') as
    | Record<string, Record<string, boolean>>
    | undefined;
  if (!perms?.[module]?.[action]) {
    throw new HttpsError('permission-denied', `Missing ${module}.${action} permission.`);
  }
  return { uid };
}

/** Append a compliance/audit entry (money-moving + privileged actions). */
export async function writeAudit(entry: {
  actorUid: string;
  actorName?: string;
  action: string;
  entity: string;
  entityId: string;
  amountPaise?: number | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const ref = db.collection('auditLogs').doc();
  await ref.set({
    id: ref.id,
    actorType: 'admin',
    actorName: entry.actorName ?? 'admin',
    amountPaise: entry.amountPaise ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    meta: entry.meta ?? {},
    actorUid: entry.actorUid,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    createdAt: FieldValue.serverTimestamp(),
  });
}
