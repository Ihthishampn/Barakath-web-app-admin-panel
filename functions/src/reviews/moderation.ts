/**
 * adminModerateReview — publish / reject (take down) a product review.
 *
 * Reviews from verified purchasers are born `approved` and count immediately
 * (see onReviewWritten + firestore.rules), so this callable's real job is
 * letting a moderator REJECT an abusive review (or re-publish one). It only
 * flips the review's `status` and writes the audit row — it does NOT touch the
 * product's rating aggregate. That is owned solely by the `onReviewWritten`
 * trigger (reviews/aggregate.ts), which recomputes `rating`/`ratingCount` from
 * the approved review set on any review write, so a status change here is
 * picked up automatically and the two writers can never disagree.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, FieldValue, callableOpts } from '../_lib/admin.js';
import { requireAdmin, writeAudit } from '../_lib/guards.js';

/**
 * The reviews module gate. 'approve' is the natural action, but an admin
 * granted plain edit rights on the module is equally entitled to publish or
 * reject — the same pair firestore.rules accepted before the direct write was
 * retired. Suspended sub-admins are rejected on the stored doc, not only on the
 * (cacheable) custom claim.
 */
async function requireReviewModeration(req: CallableRequest): Promise<{ uid: string }> {
  const { uid, claims } = requireAdmin(req);
  if (claims.role === 'super_admin') return { uid };
  const snap = await db.doc(`admins/${uid}`).get();
  if (!snap.exists || snap.get('status') !== 'active') {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }
  const perms = snap.get('modulePermissions') as
    | Record<string, Record<string, boolean>>
    | undefined;
  const p = perms?.reviews;
  if (!p?.approve && !p?.edit) {
    throw new HttpsError('permission-denied', 'Missing reviews.approve permission.');
  }
  return { uid };
}

const Payload = z.object({
  reviewId: z.string().min(1),
  status: z.enum(['approved', 'rejected']),
});

export const adminModerateReview = onCall(callableOpts, async (req) => {
  const { uid: actor } = await requireReviewModeration(req);
  const parsed = Payload.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');
  const { reviewId, status } = parsed.data;
  const rref = db.doc(`reviews/${reviewId}`);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rref);
    if (!snap.exists) throw new HttpsError('not-found', 'Review not found.');
    const r = snap.data() as Record<string, any>;
    // The STORED status decides — a replayed or duplicated click is a no-op.
    if (r.status === status) return { changed: false, productId: r.productId as string };

    // Flip the status only. `onReviewWritten` (reviews/aggregate.ts) sees this
    // write and recomputes the product's rating/ratingCount from the approved
    // set, so nothing here touches the product.
    const now = FieldValue.serverTimestamp();
    tx.update(rref, { status, moderatedBy: actor, moderatedAt: now, updatedAt: now });
    return { changed: true, productId: String(r.productId ?? '') };
  });

  if (out.changed) {
    await writeAudit({
      actorUid: actor,
      action: status === 'approved' ? 'review.approved' : 'review.rejected',
      entity: 'reviews',
      entityId: reviewId,
      meta: { productId: out.productId, status },
    });
  }
  return { ok: true };
});
