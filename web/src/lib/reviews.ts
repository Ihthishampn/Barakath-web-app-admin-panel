'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { Review } from '@barkath/shared';
import { db } from '@/lib/firebase';

/** Reviews shown on the dedicated page before "Load more". */
export const REVIEWS_PAGE_SIZE = 10;
/** Reviews shown inline on the product detail page before "See all". */
export const REVIEW_PREVIEW_COUNT = 4;

export interface PaginatedReviews {
  reviews: Review[];
  /** First page still loading. */
  loading: boolean;
  /** A subsequent page (load-more) is loading. */
  loadingMore: boolean;
  hasMore: boolean;
  error: boolean;
  loadMore: () => void;
}

/**
 * Cursor-paginated APPROVED reviews for one product, newest first.
 *
 * Uses `getDocs` + `startAfter` (a fixed-size page walk) instead of the
 * whole-collection `onSnapshot` the product page used before, so a product with
 * thousands of reviews only ever fetches `pageSize` rows at a time. The
 * rating/review COUNT is not derived from this list — it stays on
 * `product.ratingCount` (the admin-maintained aggregate) — so paging the list
 * never changes the displayed count.
 *
 * Ordered by `createdAt desc`, which needs the composite reviews index
 * (productId, status, createdAt) in firebase/firestore.indexes.json.
 */
export function usePaginatedReviews(
  productId: string,
  pageSize = REVIEWS_PAGE_SIZE,
): PaginatedReviews {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(false);
  const cursor = useRef<QueryDocumentSnapshot | null>(null);
  const inFlight = useRef(false);
  const exhausted = useRef(false);

  const fetchPage = useCallback(
    async (first: boolean) => {
      if (inFlight.current) return;
      if (!first && exhausted.current) return;
      inFlight.current = true;
      if (first) setLoading(true);
      else setLoadingMore(true);
      try {
        const snap = await getDocs(
          query(
            collection(db, 'reviews'),
            where('productId', '==', productId),
            where('status', '==', 'approved'),
            orderBy('createdAt', 'desc'),
            ...(first || !cursor.current ? [] : [startAfter(cursor.current)]),
            limit(pageSize),
          ),
        );
        const page = snap.docs.map((d) => d.data() as Review);
        cursor.current = snap.docs[snap.docs.length - 1] ?? cursor.current;
        const more = snap.size === pageSize;
        exhausted.current = !more;
        setReviews((prev) => (first ? page : [...prev, ...page]));
        setHasMore(more);
        setError(false);
      } catch {
        setError(true);
      } finally {
        inFlight.current = false;
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [productId, pageSize],
  );

  // (Re)start from the first page whenever the product changes.
  useEffect(() => {
    cursor.current = null;
    exhausted.current = false;
    setReviews([]);
    setHasMore(true);
    void fetchPage(true);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    void fetchPage(false);
  }, [fetchPage]);

  return { reviews, loading, loadingMore, hasMore, error, loadMore };
}
