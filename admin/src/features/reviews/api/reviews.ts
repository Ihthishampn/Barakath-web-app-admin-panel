import { collection, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { Review, ReviewStatus } from '@barkath/shared';
import { db, functions } from '@/lib/firebase';
import { useLiveCollection } from '@/hooks/firestoreCache';

export const REVIEWS_KEY = 'reviews:createdAt-desc';

/** All product reviews, newest first, real-time. */
export function useReviewsList() {
  return useLiveCollection<Review>(REVIEWS_KEY, () =>
    query(collection(db, 'reviews'), orderBy('createdAt', 'desc')),
  );
}

export type ReviewTab = ReviewStatus; // 'pending' | 'approved' | 'rejected'

export function countReviews(list: Review[]): Record<ReviewTab, number> {
  const c: Record<ReviewTab, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const r of list) c[r.status]++;
  return c;
}

/**
 * Move a review to `next` and keep the product's rating aggregate in step.
 *
 * This runs in the adminModerateReview callable, not here: the aggregate lives
 * on products/{id}, which security rules gate on the PRODUCTS module, so a
 * sub-admin holding only the reviews permission could never complete the write
 * from the client. The callable checks the reviews permission itself and does
 * the review stamp + rating recompute in one server-side transaction.
 */
async function moderateReview(review: Review, next: 'approved' | 'rejected'): Promise<void> {
  const call = httpsCallable<{ reviewId: string; status: 'approved' | 'rejected' }, { ok: boolean }>(
    functions,
    'adminModerateReview',
  );
  await call({ reviewId: review.id, status: next });
}

/** Approve a review: publish it and roll it into the product's rating aggregate. */
export async function approveReview(review: Review): Promise<void> {
  await moderateReview(review, 'approved');
}

/** Reject a review: hide it and take back the rating it contributed, if any. */
export async function rejectReview(review: Review): Promise<void> {
  await moderateReview(review, 'rejected');
}
