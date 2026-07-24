'use client';
/**
 * Review submission — the one implementation of the reviews/{id} create.
 *
 * Writing a review is gated on DELIVERY, not on browsing: firestore.rules
 * requires `customers/{uid}/purchases/{productId}` to exist, and that doc is
 * written by adminChangeOrderStatus when an order is marked delivered. So the
 * only surface that may offer this form is a delivered order — the product page
 * is read-only. The form and its rule contract live here so the order screen
 * (and anything added later) can't drift from what the rules actually accept.
 */
import { useState } from 'react';
import { collection, doc, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { toast } from 'sonner';
import { RiStarFill, RiStarLine } from '@remixicon/react';
import type { Review } from '@barkath/shared';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/useCollection';
import { Button } from '@/components/ui/Button';

/**
 * Every review this customer has written, ANY status — the read rule lets an
 * owner read their own pending review, so a just-submitted one is visible to
 * its author immediately instead of vanishing until an admin approves it. One
 * equality filter, so no composite index.
 */
export function useMyReviews(uid?: string) {
  return useCollection<Review>(
    () => (uid ? query(collection(db, 'reviews'), where('customerId', '==', uid)) : null),
    [uid],
  );
}

/** The same, narrowed to one product (two equality filters — still index-free). */
export function useMyProductReviews(productId: string, uid?: string) {
  return useCollection<Review>(
    () =>
      uid
        ? query(collection(db, 'reviews'), where('productId', '==', productId), where('customerId', '==', uid))
        : null,
    [productId, uid],
  );
}

/** Customer-facing label for a review's moderation state. */
export function reviewStatusLabel(status: Review['status']): string {
  if (status === 'approved') return 'Published';
  if (status === 'rejected') return 'Not approved';
  return 'Pending approval';
}

/** Badge classes matching the moderation state (same tokens on every surface). */
export function reviewStatusClass(status: Review['status']): string {
  if (status === 'approved') return 'bg-success-subtle text-success';
  if (status === 'rejected') return 'bg-error-subtle text-error';
  return 'bg-info-subtle text-info';
}

/**
 * Write-a-review form. Creates reviews/{id} with status 'pending' — the admin's
 * existing moderation queue approves/rejects. Each review is stamped with the
 * signed-in customer's uid (owner) so the security rules accept the create.
 */
export function ReviewForm({
  productId,
  customerId,
  customerName,
  orderId = '',
  onDone,
}: {
  productId: string;
  customerId: string;
  customerName: string;
  /** The delivered order this review came from, for admin context. */
  orderId?: string;
  onDone: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (rating < 1) return toast.error('Please pick a star rating.');
    if (body.trim().length < 10) return toast.error('Please write at least a few words about the product.');
    setBusy(true);
    try {
      // Pre-generate the ref so the document can carry its own `id`. Admin
      // moderation reads reviews via `d.data()` (the doc ID is NOT merged in),
      // so a review without a stored `id` cannot be approved or rejected.
      //
      // The id is DETERMINISTIC — `${uid}_${productId}` — so one customer can
      // hold at most one review per product. Purchase proof is an `exists()`
      // check on a doc that is never consumed, so with auto-ids a single
      // purchase let the same customer post unlimited reviews for that product,
      // each one genuinely moving the rating aggregate on approval. The rules
      // enforce the same shape, so this is a matching client, not the guard.
      const ref = doc(db, 'reviews', `${customerId}_${productId}`);
      // Every field below that the rules assert on (customerId, status,
      // rating 1–5, moderatedBy null, helpfulCount 0) must match exactly or the
      // create is rejected.
      await setDoc(ref, {
        id: ref.id,
        productId,
        customerId,
        customerName,
        orderId,
        rating,
        title: title.trim() || null,
        body: body.trim(),
        photoUrls: [],
        status: 'pending',
        moderatedBy: null,
        moderatedAt: null,
        helpfulCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast.success('Thanks! Your review is pending approval.');
      onDone();
    } catch (e) {
      // A rules rejection is permanent (no purchases/{productId} doc, or the
      // customer already reviewed from another tab) — say so instead of
      // inviting a retry that will fail the same way.
      const code = (e as { code?: string })?.code;
      if (code === 'permission-denied')
        toast.error("We couldn't confirm this product was delivered to you, so the review wasn't saved.");
      else toast.error("Couldn't submit your review. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-card p-5">
      <div className="mb-3 font-display text-[15px] font-extrabold text-text-primary">Write a review</div>

      {/* Star picker */}
      <div className="mb-3 flex items-center gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = (hover || rating) >= n;
          return (
            <button
              key={n}
              type="button"
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              onMouseEnter={() => setHover(n)}
              onClick={() => setRating(n)}
              className="text-brand-gold transition-transform hover:scale-110"
            >
              {on ? <RiStarFill size={26} /> : <RiStarLine size={26} className="text-neutral-300" />}
            </button>
          );
        })}
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={80}
        placeholder="Title (optional)"
        className="mb-2.5 w-full rounded-[10px] border border-border bg-surface-app px-3.5 py-3 font-ui text-sm font-medium text-text-primary outline-none placeholder:text-text-tertiary focus:border-brand-primary"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={1000}
        rows={4}
        placeholder="What did you like or dislike about the product?"
        className="w-full resize-none rounded-[10px] border border-border bg-surface-app px-3.5 py-3 font-ui text-sm font-medium leading-relaxed text-text-primary outline-none placeholder:text-text-tertiary focus:border-brand-primary"
      />

      <div className="mt-3 flex items-center justify-end gap-2.5">
        <Button theme="neutral" size="m" outline onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button theme="primary" size="m" onClick={submit} disabled={busy}>
          {busy ? 'Submitting…' : 'Submit review'}
        </Button>
      </div>
    </div>
  );
}
