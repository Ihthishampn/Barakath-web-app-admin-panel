'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { RiArrowLeftLine, RiStarLine } from '@remixicon/react';
import type { Product } from '@barkath/shared';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { usePaginatedReviews, REVIEWS_PAGE_SIZE } from '@/lib/reviews';
import { Button } from '@/components/ui/Button';
import { useMyProductReviews } from '@/components/reviews/ReviewForm';
import { PublicReviewCard, OwnReviewCard } from '@/components/reviews/ReviewCards';

/**
 * Dedicated, incrementally-paginated reviews page (reached via "See all" on the
 * product page). Approved reviews are walked a page at a time with a "Load more"
 * button; the author's own reviews (any status) overlay on top, deduped. The
 * rating/count summary reads product.ratingCount — the same aggregate the rest
 * of the storefront uses — so it stays accurate regardless of paging.
 */
export default function ProductReviewsPage() {
  const params = useParams<{ id: string }>();
  const productId = params.id;
  const customer = useAuth((s) => s.customer);

  const [product, setProduct] = useState<Product | null>(null);
  useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, 'products', productId))
      .then((snap) => {
        if (!cancelled && snap.exists()) setProduct({ ...(snap.data() as Product), id: snap.id });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const { reviews, loading, loadingMore, hasMore, error, loadMore } = usePaginatedReviews(
    productId,
    REVIEWS_PAGE_SIZE,
  );
  const { data: myReviews } = useMyProductReviews(productId, customer?.uid);

  const myIds = new Set(myReviews.map((r) => r.id));
  const othersApproved = reviews.filter((r) => !myIds.has(r.id));

  const rating = product?.rating ?? 0;
  const ratingCount = product?.ratingCount ?? 0;

  return (
    <div className="mx-auto max-w-page px-4 py-8 sm:px-10">
      <Link
        href={`/product/${productId}`}
        className="mb-5 inline-flex items-center gap-1.5 font-ui text-[14px] font-bold text-text-secondary hover:text-text-primary"
      >
        <RiArrowLeftLine size={16} /> Back to product
      </Link>

      <div className="mb-6 flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-[26px] font-extrabold tracking-[-0.02em] text-text-primary">Reviews</h1>
        {ratingCount > 0 && (
          <span className="inline-flex items-center gap-1 font-ui text-[14px] font-bold text-text-secondary">
            <RiStarLine size={15} className="text-brand-gold" />
            {rating.toFixed(1)} · {ratingCount} rating{ratingCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {product?.name && (
        <p className="mb-6 font-ui text-[15px] font-medium text-text-tertiary">{product.name}</p>
      )}

      {/* Author's own reviews first (any status), so a pending review is visible. */}
      {myReviews.length > 0 && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          {myReviews.map((r) => (
            <OwnReviewCard key={r.id} review={r} />
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-neutral-200" />
          ))}
        </div>
      ) : error && othersApproved.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-border-default bg-surface-card py-14 text-center font-ui text-sm text-error">
          Couldn’t load reviews. Please try again.
        </div>
      ) : othersApproved.length === 0 ? (
        myReviews.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border-default bg-surface-card py-14 text-center font-ui text-sm text-text-tertiary">
            No reviews yet. Reviews come from customers who have received this product.
          </div>
        ) : null
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {othersApproved.map((r) => (
              <PublicReviewCard key={r.id} review={r} />
            ))}
          </div>
          {hasMore && (
            <div className="mt-8 flex justify-center">
              <Button theme="gold" size="l" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
