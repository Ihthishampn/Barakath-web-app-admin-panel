'use client';
import { useMemo } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { BANNER_PLACEMENTS, type Banner } from '@barkath/shared';
import { db } from './firebase';
import { useCollection } from './useCollection';

/**
 * Live web banners published from the admin (Growth ▸ Banner).
 *
 * The query filters on `placement` only and sorts/filters the rest in memory —
 * combining `where(placement)` with `orderBy(order)` would require a composite
 * index, which we deliberately avoid across the storefront.
 *
 * Returns an empty list when nothing is published, so the caller can fall back
 * to the built-in hero rather than rendering a blank panel.
 */
export function useWebBanners(): { banners: Banner[]; loading: boolean } {
  const { data, loading } = useCollection<Banner>(
    // BANNER_PLACEMENTS is ['app','website'] — this filtered on the literal
    // 'web', which no writer ever stores, so every admin-published banner was
    // invisible on the storefront. Reference the enum so it cannot drift again.
    () => query(collection(db, 'banners'), where('placement', '==', BANNER_PLACEMENTS[1])),
    [],
  );

  const banners = useMemo(
    () =>
      data
        .filter((b) => b.publishLive && !!b.imageUrl)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [data],
  );

  return { banners, loading };
}

/** Where a banner should navigate — its attached product, else the listing. */
export function bannerHref(b: Banner): string {
  return b.attachedProductId ? `/product/${b.attachedProductId}` : '/listing';
}
