/**
 * adminModerateReview — publish / reject a product review.
 *
 * Moderation is privileged because it does not only flip the review's status:
 * it also has to move the PRODUCT's rating aggregate, and products/{id} is
 * gated on the products module. Done from the client that meant a sub-admin
 * holding only the reviews permission could never approve anything (the
 * transaction died on the product write). The whole decision therefore lives
 * here: one transaction stamps the review and recomputes the product's
 * rating/ratingCount from the reviews that are actually approved, so the
 * aggregate self-heals instead of drifting on every replay.
 *
 * Rating authority (see the write block below): `rating`/`ratingCount` on the
 * product are DERIVED and owned by nobody. The admin product form owns
 * `seedRating`/`seedRatingCount` — the launch / migrated aggregate that has no
 * review docs behind it — this function owns
 * `reviewRatingSum`/`reviewRatingCount`, and the displayed pair is always the
 * two sides combined. Both writers recompute the pair the same way, so neither
 * can silently destroy the other's numbers.
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
    // ── reads first ──
    const snap = await tx.get(rref);
    if (!snap.exists) throw new HttpsError('not-found', 'Review not found.');
    const r = snap.data() as Record<string, any>;
    // The STORED status decides — a replayed or duplicated click is a no-op and
    // can never double-count the rating.
    if (r.status === status) return { changed: false, productId: r.productId as string };

    const productId = String(r.productId ?? '');
    // Only a decision that adds to or removes from the APPROVED set may touch
    // the aggregate. A pending → rejected review never contributed anything, so
    // recomputing would overwrite a rating the reviews cannot reproduce — every
    // product carries an admin-entered / seeded rating with no review docs
    // behind it, and the recompute would silently zero it.
    const affectsAggregate = r.status === 'approved' || status === 'approved';
    const pref = productId && affectsAggregate ? db.doc(`products/${productId}`) : null;
    const psnap = pref ? await tx.get(pref) : null;

    // Recompute the aggregate from the reviews that are actually approved rather
    // than nudging the stored average — that is what keeps it correct after a
    // deleted product, a hand-edited rating or a lost write.
    let approved: Array<{ id: string; rating: number }> = [];
    if (psnap?.exists) {
      const q = await tx.get(
        db.collection('reviews').where('productId', '==', productId).where('status', '==', 'approved'),
      );
      approved = q.docs.map((d) => ({ id: d.id, rating: Number(d.get('rating') ?? 0) }));
    }

    // ── writes ──
    const now = FieldValue.serverTimestamp();
    tx.update(rref, { status, moderatedBy: actor, moderatedAt: now, updatedAt: now });

    if (psnap?.exists && pref) {
      // Apply this decision to the set the query returned (it cannot see the
      // write above).
      const others = approved.filter((x) => x.id !== reviewId);
      const next =
        status === 'approved' ? [...others, { id: reviewId, rating: Number(r.rating ?? 0) }] : others;
      const reviewCount = next.length;
      const reviewSum = next.reduce((a, x) => a + x.rating, 0);

      // The admin-entered aggregate is a SEED, not a rival value: a product
      // migrated from the old store carries "4.6 from 312 ratings" with no
      // review docs behind it. Writing the review-only average over it (what
      // this used to do) replaced that with "2.0 from 1" on the first approval,
      // unrecoverably. Combine the two instead.
      const storedSeedCount = Number(psnap.get('seedRatingCount'));
      const hasSeedFields = Number.isFinite(storedSeedCount);
      // Back-fill for products saved before the seed fields existed: whatever
      // the stored count holds over the reviews that were ALREADY approved
      // cannot have come from a review, so it is seed. (`approved` is the
      // pre-decision set — precisely what the old recompute would have written,
      // so a product whose aggregate was already review-only infers seed 0.)
      const seedCount = hasSeedFields
        ? Math.max(0, storedSeedCount)
        : Math.max(0, Number(psnap.get('ratingCount') ?? 0) - approved.length);
      const seedRating = Number(psnap.get(hasSeedFields ? 'seedRating' : 'rating') ?? 0);

      const count = seedCount + reviewCount;
      const rating =
        count === 0 ? 0 : Math.round(((seedCount * seedRating + reviewSum) / count) * 10) / 10;
      tx.update(pref, {
        ratingCount: count,
        rating,
        // The review side, stored so the product form can rebuild the same
        // combined figure without reading (and being allowed to read) reviews.
        reviewRatingCount: reviewCount,
        reviewRatingSum: reviewSum,
        // Persist the back-fill so the inference above runs at most once per
        // product; from here the seed is explicit and only the form moves it.
        seedRatingCount: seedCount,
        seedRating,
        updatedAt: now,
      });
    }
    return { changed: true, productId };
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
