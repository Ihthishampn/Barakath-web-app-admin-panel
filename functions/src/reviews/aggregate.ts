/**
 * onReviewWritten — the single authority for a product's rating aggregate.
 *
 * A product's `rating`/`ratingCount` are DERIVED, never entered: they are the
 * mean and count of that product's APPROVED reviews. This trigger is the only
 * writer. It fires on every create/update/delete under `reviews/{id}` and
 * recomputes the referenced product from the review docs themselves, so the
 * aggregate self-heals rather than drifting on a nudge.
 *
 * Because a verified purchaser's review is born `approved` (firestore.rules),
 * this makes a real review move the storefront number instantly — no admin
 * approval step — while an admin rejecting an abusive one drops it right back.
 *
 * Baseline: a product with zero approved reviews reads `rating: 1.0,
 * ratingCount: 0` — the initial state every new product starts in and every
 * surface displays as "1.0 ★ · 0 Reviews".
 *
 * Runs with the Admin SDK, so it bypasses the products rating lock in
 * firestore.rules (no client — admin included — may write the pair directly).
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, FieldValue, REGION } from '../_lib/admin.js';

/** Zero-review baseline shown as "1.0 ★ · 0 Reviews". */
const BASELINE_RATING = 1;

export const onReviewWritten = onDocumentWritten(
  { document: 'reviews/{id}', region: REGION },
  async (event) => {
    const before = event.data?.before.exists ? event.data.before.data() : null;
    const after = event.data?.after.exists ? event.data.after.data() : null;

    // The product this review belongs to. A review id is `${uid}_${productId}`
    // and productId is immutable, so before/after agree; a delete carries only
    // `before`.
    const productId = String((after?.productId ?? before?.productId) ?? '');
    if (!productId) return;

    // Skip writes that cannot change the approved set: a field-only edit that
    // leaves status unchanged and non-approved (there is no such client path
    // today — reviews are create-only to clients and CF-updated on moderation —
    // but this keeps the trigger from doing redundant product writes).
    const wasApproved = before?.status === 'approved';
    const isApproved = after?.status === 'approved';
    if (!wasApproved && !isApproved) return;

    const pref = db.doc(`products/${productId}`);
    const psnap = await pref.get();
    // The product may have been deleted; nothing to aggregate onto.
    if (!psnap.exists) return;

    const q = await db
      .collection('reviews')
      .where('productId', '==', productId)
      .where('status', '==', 'approved')
      .get();

    const ratingCount = q.size;
    const sum = q.docs.reduce((a, d) => a + Number(d.get('rating') ?? 0), 0);
    const rating =
      ratingCount > 0 ? Math.round((sum / ratingCount) * 10) / 10 : BASELINE_RATING;

    await pref.update({
      rating,
      ratingCount,
      // Retire the old manual-seed provenance fields the moment this product is
      // recomputed — the aggregate is review-only now, nothing blends a seed.
      seedRating: FieldValue.delete(),
      seedRatingCount: FieldValue.delete(),
      reviewRatingSum: FieldValue.delete(),
      reviewRatingCount: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  },
);
