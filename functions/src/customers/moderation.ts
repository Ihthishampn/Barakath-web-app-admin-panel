/**
 * adminBlockUser / adminUnblockUser — privileged customer moderation (cross-user).
 * Flips customers/{uid}.isBlocked, disables the Auth account, and audits.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, auth, FieldValue, callableOpts } from '../_lib/admin.js';
import { requireModule, writeAudit } from '../_lib/guards.js';

const Schema = z.object({ uid: z.string().min(1), reason: z.string().nullable().optional() });

/**
 * Mirror the block onto the Auth account (and kill live sessions when blocking).
 *
 * Every failure here used to be swallowed, so the admin got a green "blocked"
 * toast even when nothing happened — most obviously for seeded/imported
 * customers, which have a Firestore doc but no Auth record at all. A missing
 * Auth user is the one tolerable case (the Firestore flag still applies); any
 * other failure means the block did NOT take and must reach the admin.
 */
async function setAuthDisabled(uid: string, disabled: boolean): Promise<void> {
  try {
    await auth.updateUser(uid, { disabled });
    // Revoking refresh tokens is what closes the ≤1h window in which an
    // already-signed-in session keeps a valid ID token.
    if (disabled) await auth.revokeRefreshTokens(uid);
  } catch (e) {
    if ((e as { code?: string })?.code === 'auth/user-not-found') return;
    throw new HttpsError(
      'internal',
      disabled
        ? 'Marked as blocked, but their sign-in account could not be disabled. Try again.'
        : 'Marked as unblocked, but their sign-in account could not be re-enabled. Try again.',
    );
  }
}

export const adminBlockUser = onCall(callableOpts, async (req) => {
  const { uid: actor } = await requireModule(req, 'customers', 'edit');
  const parsed = Schema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');
  const { uid, reason } = parsed.data;

  const ref = db.doc(`customers/${uid}`);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'Customer not found.');

  await ref.update({
    isBlocked: true,
    blockReason: reason ?? null,
    blockedAt: FieldValue.serverTimestamp(),
    blockedByUid: actor,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await setAuthDisabled(uid, true);
  await writeAudit({ actorUid: actor, action: 'customer.blocked', entity: 'customers', entityId: uid, meta: { reason: reason ?? null } });
  return { ok: true };
});

export const adminUnblockUser = onCall(callableOpts, async (req) => {
  const { uid: actor } = await requireModule(req, 'customers', 'edit');
  const parsed = Schema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');
  const { uid } = parsed.data;

  const ref = db.doc(`customers/${uid}`);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'Customer not found.');

  await ref.update({
    isBlocked: false,
    blockReason: null,
    blockedAt: null,
    blockedByUid: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await setAuthDisabled(uid, false);
  await writeAudit({ actorUid: actor, action: 'customer.unblocked', entity: 'customers', entityId: uid });
  return { ok: true };
});
