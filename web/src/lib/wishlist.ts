'use client';
/**
 * Wishlist data layer.
 *
 * Placement (per the shared schema, subPaths.customerWishlist):
 *   customers/{uid}/wishlist/{productId}
 * — a subcollection under the owning customer, keyed by product id so existence
 * checks and toggles are O(1). Each doc stores a denormalised snapshot of the
 * product so the wishlist page renders without N extra product reads.
 *
 * Security rules already allow the owner to read/write this subcollection. The
 * whole feature requires a signed-in customer (uid); logged-out callers are
 * bounced to sign in. (Login itself is gated on the deferred MSG91 OTP service.)
 */
import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { formatMoneyInt, type Product, type Ts } from '@barkath/shared';
import { db } from './firebase';
import { useAuth } from './auth';
import { sellingPaise } from './catalog';
import { inStock } from '@/components/catalog/stock';

/** Denormalised product snapshot stored in the wishlist subcollection. */
export interface WishlistItem {
  id: string; // == productId
  productId: string;
  name: string;
  imageUrl: string | null;
  categoryTint: string;
  categorySlug: string;
  subCategorySlug: string;
  sellingPaise: number;
  mrpPaise: number;
  rating: number;
  ratingCount: number;
  addedAt: Ts | null;
}

function snapshotOf(p: Product): Omit<WishlistItem, 'addedAt'> {
  return {
    id: p.id,
    productId: p.id,
    name: p.name,
    imageUrl: p.images?.[0]?.url ?? null,
    categoryTint: p.categoryTint || '#efeeea',
    categorySlug: p.categorySlug ?? '',
    subCategorySlug: p.subCategorySlug ?? '',
    sellingPaise: sellingPaise(p),
    mrpPaise: p.mrpPaise,
    rating: p.rating ?? 0,
    ratingCount: p.ratingCount ?? 0,
  };
}

export const priceLabel = (paise: number): string => formatMoneyInt(paise);

/**
 * A wishlist row after it has been reconciled against the live product doc.
 *
 * The stored snapshot is written once, at "add to wishlist", and never touched
 * again — so a price cut, a rename or a sell-out was invisible here for as long
 * as the item sat in the list, and the "-40%" badge could be advertising a
 * discount that ended months ago.
 */
export interface LiveWishlistItem extends WishlistItem {
  /** False when the product is gone, unpublished or hidden — no longer sold. */
  available: boolean;
  /** False when nothing of it is sellable right now (variant-aware). */
  inStock: boolean;
  /** True until the live product doc behind this row has been read. */
  refreshing: boolean;
}

/** Which denormalised fields are re-read from the product doc. */
type RefreshableFields = Pick<
  WishlistItem,
  'name' | 'imageUrl' | 'categoryTint' | 'categorySlug' | 'subCategorySlug' | 'sellingPaise' | 'mrpPaise' | 'rating' | 'ratingCount'
>;

function liveFields(p: Product): RefreshableFields {
  const snap = snapshotOf(p);
  return {
    name: snap.name,
    imageUrl: snap.imageUrl,
    categoryTint: snap.categoryTint,
    categorySlug: snap.categorySlug,
    subCategorySlug: snap.subCategorySlug,
    sellingPaise: snap.sellingPaise,
    mrpPaise: snap.mrpPaise,
    rating: snap.rating,
    ratingCount: snap.ratingCount,
  };
}

function sameFields(a: RefreshableFields, b: RefreshableFields): boolean {
  return (Object.keys(a) as (keyof RefreshableFields)[]).every((k) => a[k] === b[k]);
}

/** A product that is no longer on sale — the doc is gone, drafted or hidden. */
function isSellable(p: Product | null): p is Product {
  return !!p && p.status === 'published' && p.visibility !== 'hidden';
}

export interface WishlistState {
  items: LiveWishlistItem[];
  ids: Set<string>;
  loading: boolean;
  /**
   * The subscription failed (offline, permissions). Kept separate from an empty
   * list — reporting "Your wishlist is empty" for a failed read told people
   * their saved items were gone.
   */
  error: boolean;
  signedIn: boolean;
}

/**
 * Live wishlist for the signed-in customer (empty + not-loading when logged
 * out), reconciled against the live product documents.
 *
 * The reconciliation mirrors the bag's `refreshPrices()`: read `products/{id}`
 * for every row, render from what it says, and write the fresher values back to
 * the wishlist doc when (and only when) something actually moved — so the app,
 * which shares this exact subcollection, sees the same refreshed snapshot.
 */
export function useWishlist(): WishlistState {
  const uid = useAuth((s) => s.customer?.uid);
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  /** productId → live doc, or null once we know there is no sellable product. */
  const [live, setLive] = useState<Record<string, Product | null>>({});

  useEffect(() => {
    if (!uid) {
      setItems([]);
      setLive({});
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    const q = query(collection(db, 'customers', uid, 'wishlist'), orderBy('addedAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((d) => ({ ...(d.data() as WishlistItem), id: d.id })));
        setLoading(false);
        setError(false);
      },
      () => {
        setItems([]);
        setLoading(false);
        setError(true);
      },
    );
    return unsub;
  }, [uid]);

  // Re-read the products behind the rows. Keyed on the ID SET, so a write-back
  // below (which changes the rows but not which products they are) cannot
  // retrigger it.
  const idKey = items.map((i) => i.productId).sort().join(',');
  useEffect(() => {
    const ids = idKey.split(',').filter(Boolean);
    if (!uid || ids.length === 0) {
      setLive({});
      return;
    }
    let cancelled = false;
    (async () => {
      const snaps = await Promise.all(
        ids.map((id) => getDoc(doc(db, 'products', id)).catch(() => null)),
      );
      if (cancelled) return;
      const next: Record<string, Product | null> = {};
      snaps.forEach((s, i) => {
        const id = ids[i]!;
        // A read that threw is left UNRESOLVED rather than recorded as
        // "unavailable" — a flaky network must not label a live product as
        // discontinued.
        if (!s) return;
        const p = s.exists() ? ({ ...(s.data() as Product), id: s.id }) : null;
        next[id] = isSellable(p) ? p : null;
      });
      setLive(next);

      // Write the fresher snapshot back, exactly like refreshPrices() does for
      // the bag, and only for rows that genuinely changed.
      const stored = new Map(items.map((it) => [it.productId, it]));
      await Promise.all(
        Object.entries(next).map(async ([id, p]) => {
          if (!p) return;
          const row = stored.get(id);
          if (!row) return;
          const fresh = liveFields(p);
          if (sameFields(fresh, row)) return;
          try {
            await updateDoc(doc(db, 'customers', uid, 'wishlist', id), { ...fresh });
          } catch {
            /* best effort — the render already uses the live values */
          }
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, idKey]);

  const merged = useMemo<LiveWishlistItem[]>(
    () =>
      items.map((it) => {
        const resolved = Object.prototype.hasOwnProperty.call(live, it.productId);
        const p = live[it.productId] ?? null;
        if (!resolved) {
          // Still reading: show the stored snapshot rather than flashing an
          // "unavailable" badge onto a perfectly good product.
          return { ...it, available: true, inStock: true, refreshing: true };
        }
        if (!p) return { ...it, available: false, inStock: false, refreshing: false };
        return { ...it, ...liveFields(p), available: true, inStock: inStock(p), refreshing: false };
      }),
    [items, live],
  );

  return {
    items: merged,
    ids: new Set(items.map((i) => i.productId)),
    loading,
    error,
    signedIn: !!uid,
  };
}

/** True if the product is currently wishlisted (single-product live subscription). */
export function useIsWishlisted(productId: string): { wishlisted: boolean; ready: boolean; signedIn: boolean } {
  const uid = useAuth((s) => s.customer?.uid);
  const [wishlisted, setWishlisted] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!uid) {
      setWishlisted(false);
      setReady(true);
      return;
    }
    setReady(false);
    const unsub = onSnapshot(
      doc(db, 'customers', uid, 'wishlist', productId),
      (d) => {
        setWishlisted(d.exists());
        setReady(true);
      },
      () => setReady(true),
    );
    return unsub;
  }, [uid, productId]);

  return { wishlisted, ready, signedIn: !!uid };
}

/**
 * Add/remove a product from the signed-in customer's wishlist.
 * Returns the new state ('added' | 'removed'), or 'unauthed' if not signed in.
 */
export async function toggleWishlist(product: Product): Promise<'added' | 'removed' | 'unauthed'> {
  const uid = useAuth.getState().customer?.uid;
  if (!uid) return 'unauthed';
  const ref = doc(db, 'customers', uid, 'wishlist', product.id);
  // Read-free toggle: try to delete; if it wasn't there, add it.
  // We instead branch on the current snapshot via a get to keep intent clear.
  const { getDoc } = await import('firebase/firestore');
  const existing = await getDoc(ref);
  if (existing.exists()) {
    await deleteDoc(ref);
    return 'removed';
  }
  await setDoc(ref, { ...snapshotOf(product), addedAt: serverTimestamp() });
  return 'added';
}

/** Remove by product id (used from the wishlist page). */
export async function removeFromWishlist(productId: string): Promise<boolean> {
  const uid = useAuth.getState().customer?.uid;
  if (!uid) return false;
  await deleteDoc(doc(db, 'customers', uid, 'wishlist', productId));
  return true;
}
