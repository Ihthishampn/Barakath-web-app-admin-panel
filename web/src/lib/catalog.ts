'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Timestamp,
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import { type Category, type Product } from '@barkath/shared';
import { db } from './firebase';
import { useCollection } from './useCollection';

/**
 * Visible categories, ordered (nav + home tiles). Index-free: fetch the whole
 * (small) categories collection and filter/sort client-side, so no composite
 * (visibility + order) index is required.
 */
export function useCategories() {
  const state = useCollection<Category>(() => query(collection(db, 'categories')), []);
  const data = state.data
    .filter((c) => c.visibility !== 'hidden')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { ...state, data };
}

// ── Catalogue reads ────────────────────────────────────────────────────────
/**
 * Every storefront product read goes through this file, and every one of them
 * is bounded by a *deterministic* order rather than an arbitrary slice.
 *
 * The listing used to be `where(status == published) + limit(200)` with no
 * `orderBy`, so past 200 published products the storefront silently hid — and
 * un-found — whichever ones Firestore happened not to return. There is also no
 * `status + <sort field>` composite index deployed for `products`, so the only
 * ordering available to a filtered query for free is the document key. That is
 * exactly what a cursor needs, so instead of one truncating page we walk the
 * whole result set key-ordered, page by page, and stop when it is exhausted.
 *
 * Search does NOT go through here: it is answered server-side from the
 * `searchIndex` prefix array (see {@link useProductSearch}), the same way the
 * Flutter app does it, so it never depends on having loaded the catalogue.
 */

/** Docs per cursor page. Large enough that a normal catalogue is one round trip. */
const CATALOG_PAGE_SIZE = 300;

/**
 * Runaway guard, not a product cap: a catalogue this large needs server-side
 * paging in the UI, and stopping here is better than paging for ever. Ten times
 * the ceiling this replaced, and `complete` reports honestly when it bites.
 */
export const CATALOG_MAX_PRODUCTS = 5000;

export interface CatalogState {
  data: Product[];
  loading: boolean;
  error: boolean;
  /** False when the walk stopped at {@link CATALOG_MAX_PRODUCTS} or failed mid-way. */
  complete: boolean;
}

/** A product doc is sellable when it is published and not hidden. */
function isStorefrontVisible(p: Product): boolean {
  return p.status === 'published' && p.visibility !== 'hidden';
}

const toProduct = (d: QueryDocumentSnapshot): Product => ({ ...(d.data() as Product), id: d.id });

/**
 * The published catalogue, walked in full with document-key cursors.
 *
 * The ONE query used for the walk is `where(status == published)` ordered by
 * `documentId()`. That is served by the automatic single-field index on
 * `status` (which always carries `__name__` as its tie-breaker), so it needs no
 * deployed composite index — the whole reason the previous 200-cap could not be
 * lifted with an `orderBy` was that no `status + <sort>` product index exists.
 *
 * `categorySlug` is applied CLIENT-SIDE. Scoping it in the query would mean
 * `status == … AND categorySlug == … ORDER BY __name__`, which DOES require a
 * composite index (the deployed product indexes key on `categoryId`, not
 * `categorySlug`) — and without it the client SDK fails the query outright. A
 * category page therefore walks the same published set and filters it here,
 * exactly as the listing already did with its 200-product dump, only now
 * unbounded. See the deploy note in the task output for the index that would
 * let this be scoped server-side.
 *
 * Pages are published as they arrive, so the grid fills progressively instead
 * of blocking on the whole catalogue; `loading` stays true until the last one.
 */
export function usePublishedCatalog(categorySlug?: string | null): CatalogState {
  const slug = categorySlug ?? null;
  const [state, setState] = useState<CatalogState>({
    data: [],
    loading: true,
    error: false,
    complete: false,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ data: [], loading: true, error: false, complete: false });

    const keep = (p: Product): boolean =>
      isStorefrontVisible(p) && (!slug || p.categorySlug === slug);

    (async () => {
      const acc: Product[] = [];
      let cursor: QueryDocumentSnapshot | null = null;
      // How many documents we have READ (not kept) — the cap and cursor track
      // the scan, so a category deep in key order is still reached.
      let scanned = 0;
      try {
        for (;;) {
          // Explicit annotation: `cursor` is derived from `snap`, so leaving it
          // inferred makes the two reference each other.
          const snap: QuerySnapshot = await getDocs(
            query(
              collection(db, 'products'),
              where('status', '==', 'published'),
              orderBy(documentId()),
              ...(cursor ? [startAfter(cursor)] : []),
              limit(CATALOG_PAGE_SIZE),
            ),
          );
          if (cancelled) return;
          snap.docs.forEach((d) => {
            const p = toProduct(d);
            if (keep(p)) acc.push(p);
          });
          scanned += snap.size;
          cursor = snap.docs[snap.docs.length - 1] ?? null;
          const exhausted = snap.size < CATALOG_PAGE_SIZE;
          const capped = scanned >= CATALOG_MAX_PRODUCTS;
          const done = exhausted || capped;
          setState({ data: acc.slice(), loading: !done, error: false, complete: exhausted });
          if (done) return;
        }
      } catch {
        if (cancelled) return;
        // Partial results are still worth showing; only a completely empty walk
        // is an error the grid should report.
        setState({ data: acc.slice(), loading: false, error: acc.length === 0, complete: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return state;
}

// ── Search ─────────────────────────────────────────────────────────────────

export interface SearchState {
  data: Product[];
  loading: boolean;
  error: boolean;
  /**
   * The usable tokens the query ran with. Now anything non-blank — a single
   * letter included — is usable, so this is empty ONLY for a blank box. Kept on
   * the shape so callers that showed a "keep typing" hint still compile; they
   * simply never hit it now.
   */
  tokens: string[];
}

/** Lower-case fields a product is matched on, joined once. */
function searchHaystack(p: Product): string {
  return [
    p.name,
    p.displayTitle,
    p.categorySlug,
    p.subCategorySlug,
    ...(p.searchKeywords ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Rank for one product against the raw lower-cased query. Lower is better:
 *   0 the name STARTS WITH the query        ("am" → Amber first)
 *   1 a later word in the name starts with it ("oud" → Amber Oud)
 *   2 the name merely contains it
 *   3 matched only on category / keywords
 * Ties broken by popularity (soldCount) so the most-bought match leads.
 */
function searchRank(p: Product, q: string): number {
  const name = (p.name ?? '').toLowerCase();
  if (name.startsWith(q)) return 0;
  if (name.split(/\s+/).some((w) => w.startsWith(q))) return 1;
  if (name.includes(q)) return 2;
  return 3;
}

/**
 * Product search — instant, substring, single-character-reactive.
 *
 * The index-backed version this replaced could only match prefixes of TWO or
 * more characters (keywordsBuilder's MIN_PREFIX_LEN), and dropped one-letter and
 * stop-word tokens before querying — so typing "a" returned nothing while "am"
 * found Amber, which read as broken. A storefront search box is a typeahead, and
 * a typeahead has to react to the first keystroke.
 *
 * So it now filters the SAME whole published catalogue the listing page already
 * loads ({@link usePublishedCatalog}) — every product, cached and shared across
 * the two screens, no per-keystroke round trip. Matching is a plain lower-case
 * substring over name/title/category/keywords, ranked by {@link searchRank} so a
 * name that STARTS WITH the query leads, then popularity. Works for one letter,
 * partial words, and multi-word AND queries alike.
 */
export function useProductSearch(input: string): SearchState {
  const { data: all, loading, error } = usePublishedCatalog();
  const q = input.trim().toLowerCase();
  const terms = useMemo(() => q.split(/\s+/).filter(Boolean), [q]);

  const data = useMemo(() => {
    if (terms.length === 0) return [];
    // AND across terms — every term must appear somewhere in the product's text.
    const hit = all.filter((p) => {
      const hay = searchHaystack(p);
      return terms.every((t) => hay.includes(t));
    });
    // Rank on the first (usually only) term, popularity as the tie-breaker.
    const primary = terms[0]!;
    return hit
      .map((p) => ({ p, r: searchRank(p, primary), sold: p.soldCount ?? 0 }))
      .sort((a, b) => a.r - b.r || b.sold - a.sold)
      .map((x) => x.p);
  }, [all, terms]);

  return { data, loading: loading && data.length === 0, error, tokens: terms };
}

// ── By-id reads (fbt rails, flash-sale campaigns) ──────────────────────────
/**
 * Products by document id, published-only, order preserved.
 *
 * Rails that already know which products they want (frequently-bought-together,
 * an admin's flash-sale line-up) used to find them by scanning a 200-product
 * pool, which quietly dropped anything outside it. Firestore takes 30 ids per
 * `in` query, so this is one round trip for any realistic rail.
 */
export function useProductsByIds(ids: string[] | undefined): { data: Product[]; loading: boolean } {
  const key = (ids ?? []).join(',');
  const [state, setState] = useState<{ data: Product[]; loading: boolean }>({ data: [], loading: false });

  useEffect(() => {
    const wanted = key.split(',').filter(Boolean);
    if (wanted.length === 0) {
      setState({ data: [], loading: false });
      return;
    }
    let cancelled = false;
    setState({ data: [], loading: true });
    const chunks: string[][] = [];
    for (let i = 0; i < wanted.length; i += 30) chunks.push(wanted.slice(i, i + 30));
    Promise.all(
      chunks.map((chunk) =>
        getDocs(query(collection(db, 'products'), where(documentId(), 'in', chunk))).catch(() => null),
      ),
    )
      .then((snaps) => {
        if (cancelled) return;
        const byId = new Map<string, Product>();
        snaps.forEach((s) =>
          s?.docs.forEach((d) => {
            const p = toProduct(d);
            if (isStorefrontVisible(p)) byId.set(p.id, p);
          }),
        );
        // Preserve the caller's order — an admin arranges a flash sale by hand.
        setState({ data: wanted.map((id) => byId.get(id)).filter((p): p is Product => !!p), loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ data: [], loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}

/**
 * A bounded slice of one category — the "you may also like" rail. Two equality
 * clauses need no composite index, so this is scoped in the database rather
 * than filtered out of a catalogue dump.
 */
export function useCategoryProducts(categorySlug: string, max = 24): { data: Product[]; loading: boolean } {
  return useProductQuery(
    () => [where('status', '==', 'published'), where('categorySlug', '==', categorySlug), limit(max)],
    [categorySlug, max],
  );
}

// ── Home rails (each answered by its own bounded query) ────────────────────
/** Small, self-contained one-shot product query. */
function useProductQuery(build: () => QueryConstraint[], deps: unknown[]): { data: Product[]; loading: boolean } {
  const [state, setState] = useState<{ data: Product[]; loading: boolean }>({ data: [], loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ data: [], loading: true });
    getDocs(query(collection(db, 'products'), ...build()))
      .then((snap) => {
        if (cancelled) return;
        setState({ data: snap.docs.map(toProduct).filter(isStorefrontVisible), loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ data: [], loading: false });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/**
 * Best sellers, from the deployed `status + isBestSeller + bestSellerOrder`
 * index. Over-fetched a little and re-sorted so an unranked best seller
 * (`bestSellerOrder: null`, which Firestore sorts FIRST) keeps the storefront's
 * existing "unranked goes last" behaviour.
 */
export function useBestSellers(max = 5): { data: Product[]; loading: boolean } {
  const { data, loading } = useProductQuery(
    () => [
      where('status', '==', 'published'),
      where('isBestSeller', '==', true),
      orderBy('bestSellerOrder', 'asc'),
      limit(Math.max(max * 4, 20)),
    ],
    [max],
  );
  const sorted = useMemo(
    () => [...data].sort((a, b) => (a.bestSellerOrder ?? 1e9) - (b.bestSellerOrder ?? 1e9)).slice(0, max),
    [data, max],
  );
  return { data: sorted, loading };
}

/**
 * Products flagged for the flash-sale rail. Single equality clause, so no
 * composite index — `status`/`visibility` are applied on the (small) result.
 */
export function useFlashSaleFlagged(max = 20): { data: Product[]; loading: boolean } {
  return useProductQuery(() => [where('isFlashSale', '==', true), limit(max)], [max]);
}

/**
 * New arrivals, newest first. A range filter and its `orderBy` on the SAME
 * field need only the automatic single-field index, so this reads just the
 * products published inside the window rather than a slice of the catalogue.
 */
export function useNewArrivalProducts(max = 5): { data: Product[]; loading: boolean } {
  const cutoffMs = useMemo(() => Date.now() - NEW_ARRIVAL_DAYS * 24 * 60 * 60 * 1000, []);
  const { data, loading } = useProductQuery(
    () => [
      where('publishedAt', '>=', Timestamp.fromMillis(cutoffMs)),
      orderBy('publishedAt', 'desc'),
      limit(Math.max(max * 4, 20)),
    ],
    [cutoffMs, max],
  );
  // A product on flash sale belongs to the Flash Sale rail, never both — so it
  // is excluded here even while it is inside the new-arrivals window. The query
  // over-fetches (max*4), so dropping the flash-sale ones still leaves a full
  // rail. Mirrors `newArrivals()` and the app's `newArrivals` getter.
  return {
    data: useMemo(() => data.filter((p) => !p.isFlashSale).slice(0, max), [data, max]),
    loading,
  };
}

/** Selling price helpers — offer falls back to MRP. */
export function sellingPaise(p: Product): number {
  return p.offerPricePaise || p.mrpPaise;
}
export function hasDiscount(p: Product): boolean {
  return p.offerPricePaise > 0 && p.offerPricePaise < p.mrpPaise;
}
export function discountPct(p: Product): number {
  if (!hasDiscount(p)) return 0;
  return Math.round(((p.mrpPaise - p.offerPricePaise) / p.mrpPaise) * 100);
}

/** How recently a product must have gone live to count as a "new arrival". */
export const NEW_ARRIVAL_DAYS = 3;

/** Millis a product first became visible: prefer publishedAt, fall back to createdAt. */
function liveAtMillis(p: Product): number {
  return p.publishedAt?.toMillis?.() ?? p.createdAt?.toMillis?.() ?? 0;
}

/**
 * New arrival = published within the last {@link NEW_ARRIVAL_DAYS} days AND not
 * currently on flash sale. The window part is automatic (no admin flag): a
 * product ages out on its own. The flash-sale exclusion keeps the two rails
 * mutually exclusive — a product an admin flags for Flash Sale shows there, not
 * here, even when it is brand new.
 */
export function isNewArrival(p: Product, now = Date.now()): boolean {
  if (p.isFlashSale) return false;
  const liveAt = liveAtMillis(p);
  if (!liveAt) return false;
  return now - liveAt <= NEW_ARRIVAL_DAYS * 24 * 60 * 60 * 1000;
}

/** Products currently in the new-arrivals window, newest first. */
export function newArrivals(products: Product[], now = Date.now()): Product[] {
  return products
    .filter((p) => isNewArrival(p, now))
    .sort((a, b) => liveAtMillis(b) - liveAtMillis(a));
}
