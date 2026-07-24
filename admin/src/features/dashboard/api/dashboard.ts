import { useQuery } from '@tanstack/react-query';
import {
  collection,
  getAggregateFromServer,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  sum,
  Timestamp,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import type { Category, CategoryKey, Order, OrderItem, Product } from '@barkath/shared';
import { db } from '@/lib/firebase';
import { useLiveCollection, type CollectionState } from '@/hooks/firestoreCache';
import { useCategories } from '@/features/categories/api/categories';

// ── KPIs ───────────────────────────────────────────────────────────
export interface DashboardKpis {
  todayRevenuePaise: number;
  revenueDeltaPct: number | null;
  totalOrders: number;
  ordersToday: number;
  /** Orders in the last 7 days vs the 7 before that, as a %. Null = no baseline. */
  ordersWeekDeltaPct: number | null;
  pendingOrders: number;
  avgOrderValuePaise: number;
  /** Avg order value over the last 30 days vs the 30 before that, as a %. Null = no baseline. */
  aovMonthDeltaPct: number | null;
}

const ordersCol = () => collection(db, 'orders');
const startOfDay = (offsetDays = 0) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return Timestamp.fromDate(d);
};

const PAGE_SIZE = 500;

/**
 * Which aggregate failures may fall back to a document scan.
 *
 * - unimplemented / not-implemented: aggregations unavailable (older emulator/SDK).
 * - permission-denied: an aggregate cannot be evaluated against a rule that
 *   inspects `resource.data`, so an owner-or-admin rule written in the wrong
 *   order rejects it — while the very same data reads fine document-by-document.
 *   That mismatch blanked every KPI, so we degrade to the scan instead. The rule
 *   itself is fixed (see firestore.rules), this is the belt-and-braces.
 *
 * Anything else must still surface as an error — swallowing it turns a real
 * outage into a confidently-wrong KPI.
 */
function isAggregateUnsupported(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === 'unimplemented' || code === 'not-implemented' || code === 'permission-denied';
}

/**
 * Client-side fallback: walk every matching order in 500-doc pages. The old
 * fallback took a single limit(500)/limit(1000) page, so the sum and the count
 * were truncated at different caps and the derived AOV was silently wrong.
 *
 * Paged DESCENDING on purpose: every declared composite index on `orders` sorts
 * createdAt DESCENDING (firebase/firestore.indexes.json), and Firestore will not
 * serve an ascending sort from a descending index once a second field is
 * filtered — `where('status','in',[…]) + orderBy('createdAt','asc')` fails with
 * FAILED_PRECONDITION in production while the `desc` form runs on the existing
 * (status ASC, createdAt DESC) index. Direction is irrelevant to a sum/count.
 */
async function forEachOrder(
  constraints: QueryConstraint[],
  fn: (o: Order, id: string) => void,
): Promise<void> {
  let cursor: QueryDocumentSnapshot | null = null;
  for (;;) {
    const parts: QueryConstraint[] = [...constraints, orderBy('createdAt', 'desc')];
    if (cursor) parts.push(startAfter(cursor));
    parts.push(limit(PAGE_SIZE));
    const snap: QuerySnapshot = await getDocs(query(ordersCol(), ...parts));
    // The doc id is passed alongside the data because a caller that needs the
    // order's subcollection (legacy line items) can't rely on the `id` field.
    for (const d of snap.docs) fn(d.data() as Order, d.id);
    if (snap.size < PAGE_SIZE) return;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
    if (!cursor) return;
  }
}

async function sumTotalPaise(constraints: QueryConstraint[]): Promise<number> {
  try {
    const snap = await getAggregateFromServer(query(ordersCol(), ...constraints), {
      total: sum('totalPaise'),
    });
    return snap.data().total ?? 0;
  } catch (e) {
    if (!isAggregateUnsupported(e)) throw e;
    let total = 0;
    await forEachOrder(constraints, (o) => {
      total += o.totalPaise ?? 0;
    });
    return total;
  }
}

async function countOrders(constraints: QueryConstraint[]): Promise<number> {
  try {
    const snap = await getCountFromServer(query(ordersCol(), ...constraints));
    return snap.data().count;
  } catch (e) {
    if (!isAggregateUnsupported(e)) throw e;
    let n = 0;
    await forEachOrder(constraints, () => {
      n += 1;
    });
    return n;
  }
}

const cancelledOnly = () => where('status', '==', 'cancelled');

/**
 * Realised revenue/orders = everything minus cancelled — the same definition
 * Reports uses (reports.ts `sumRevenue`), so the two screens can't disagree.
 * Expressed as "all minus cancelled" rather than a `status != 'cancelled'`
 * filter because that would put an inequality on both status and createdAt.
 *
 * NOTE: a Firestore `sum()` needs the summed field inside the index, and an
 * aggregation's implicit sort on the range field is ASCENDING — so these run on
 * the (status ASC, createdAt ASC, totalPaise ASC) / (createdAt ASC, totalPaise
 * ASC) / (status ASC, totalPaise ASC) / (status ASC, createdAt ASC) indexes
 * declared in firebase/firestore.indexes.json, NOT on the createdAt-DESCENDING
 * ones the list screens use. Dropping any of them makes every figure on this
 * page fail with FAILED_PRECONDITION.
 */
async function sumRealisedPaise(constraints: QueryConstraint[]): Promise<number> {
  const [all, cancelled] = await Promise.all([
    sumTotalPaise(constraints),
    sumTotalPaise([...constraints, cancelledOnly()]),
  ]);
  return Math.max(0, all - cancelled);
}

async function countRealisedOrders(constraints: QueryConstraint[]): Promise<number> {
  const [all, cancelled] = await Promise.all([
    countOrders(constraints),
    countOrders([...constraints, cancelledOnly()]),
  ]);
  return Math.max(0, all - cancelled);
}

export function useDashboardKpis() {
  return useQuery<DashboardKpis>({
    queryKey: ['dashboard', 'kpis'],
    queryFn: async () => {
      // Revenue figures are *realised* (cancelled orders excluded); the order
      // counts shown as counts stay raw, but every denominator paired with a
      // realised sum must exclude cancelled too or the AOV is skewed.
      //
      // Every window that feeds a delta is CLOSED at midnight today, so it spans
      // the same number of full days as the baseline it is compared against. The
      // week window used to run to *now* — 7 full days plus however much of today
      // had elapsed — against a baseline of exactly 7, so a perfectly flat shop
      // reported growth that climbed through the day and reset at midnight.
      const [
        totalOrders,
        pendingOrders,
        ordersToday,
        todayRevenuePaise,
        yesterdayRevenue,
        lifetimeRevenue,
        lifetimeRealisedOrders,
        ordersThisWeek,
        ordersPrevWeek,
        revThisMonth,
        ordersThisMonth,
        revPrevMonth,
        ordersPrevMonth,
      ] = await Promise.all([
        countOrders([]),
        countOrders([where('status', 'in', ['accepted', 'packing', 'packed'])]),
        countOrders([where('createdAt', '>=', startOfDay(0))]),
        sumRealisedPaise([where('createdAt', '>=', startOfDay(0))]),
        sumRealisedPaise([where('createdAt', '>=', startOfDay(-1)), where('createdAt', '<', startOfDay(0))]),
        sumRealisedPaise([]),
        countRealisedOrders([]),
        countOrders([where('createdAt', '>=', startOfDay(-7)), where('createdAt', '<', startOfDay(0))]),
        countOrders([where('createdAt', '>=', startOfDay(-14)), where('createdAt', '<', startOfDay(-7))]),
        sumRealisedPaise([where('createdAt', '>=', startOfDay(-30)), where('createdAt', '<', startOfDay(0))]),
        countRealisedOrders([where('createdAt', '>=', startOfDay(-30)), where('createdAt', '<', startOfDay(0))]),
        sumRealisedPaise([where('createdAt', '>=', startOfDay(-60)), where('createdAt', '<', startOfDay(-30))]),
        countRealisedOrders([where('createdAt', '>=', startOfDay(-60)), where('createdAt', '<', startOfDay(-30))]),
      ]);

      /** Percent change to 1dp; null when there's no baseline to compare against. */
      const pctChange = (now: number, before: number): number | null =>
        before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null;

      const aovThisMonth = ordersThisMonth > 0 ? revThisMonth / ordersThisMonth : 0;
      const aovPrevMonth = ordersPrevMonth > 0 ? revPrevMonth / ordersPrevMonth : 0;

      return {
        todayRevenuePaise,
        revenueDeltaPct: pctChange(todayRevenuePaise, yesterdayRevenue),
        totalOrders,
        ordersToday,
        ordersWeekDeltaPct: pctChange(ordersThisWeek, ordersPrevWeek),
        pendingOrders,
        avgOrderValuePaise:
          lifetimeRealisedOrders > 0 ? Math.round(lifetimeRevenue / lifetimeRealisedOrders) : 0,
        aovMonthDeltaPct: pctChange(aovThisMonth, aovPrevMonth),
      };
    },
    staleTime: 30_000,
  });
}

// ── Recent orders (real-time) ──────────────────────────────────────
export function useRecentOrders(n = 5) {
  return useLiveCollection<Order>(`orders:recent:${n}`, () =>
    query(ordersCol(), orderBy('createdAt', 'desc'), limit(n)),
  );
}

// ── Products (real-time) → low stock + category performance ────────
/** How far back the category panel looks when splitting revenue by category. */
const CATEGORY_WINDOW_DAYS = 90;

export interface CategorySources {
  categories: Category[];
  orders: Order[];
}

/**
 * The category panel needs the category catalog (for its labels and tints) and
 * the order line items (for the revenue split) on top of the product list.
 * `categoryPerformance` is a pure function called straight from the dashboard
 * render, so `useProducts` — the hook that panel already depends on — loads both
 * and publishes them here. Passing them explicitly overrides this.
 */
let categorySources: CategorySources = { categories: [], orders: [] };

export interface DashboardProducts extends CollectionState<Product> {
  /**
   * The order read behind the category panel has landed. False while it is in
   * flight and false forever if it failed — `categoryPerformance` returns an
   * empty list in both cases, which is otherwise indistinguishable from "nothing
   * sold in the window".
   */
  categorySourcesReady: boolean;
}

export function useProducts(): DashboardProducts {
  const products = useLiveCollection<Product>('products:published', () =>
    query(collection(db, 'products'), where('status', '==', 'published')),
  );
  // Shares the categories feature's cache key, so this adds no extra listener.
  const categories = useCategories();
  const categoryOrders = useQuery<Order[]>({
    queryKey: ['dashboard', 'categoryOrders', CATEGORY_WINDOW_DAYS],
    queryFn: async () => {
      const out: Order[] = [];
      await forEachOrder([where('createdAt', '>=', startOfDay(-CATEGORY_WINDOW_DAYS))], (o, id) =>
        out.push({ ...o, id }),
      );
      // Orders written before the embedded-items migration keep their lines in
      // orders/{id}/items and the shared `Order` type requires readers to fall
      // back to it. Without this they still count in full towards the revenue
      // KPIs and the trend (both sum `totalPaise` off the order doc) but
      // contribute ₹0 to the category split, so the panels contradict each
      // other. Only orders actually missing the array are fetched.
      await Promise.all(
        out
          .filter((o) => !o.items?.length)
          .map(async (o) => {
            const snap = await getDocs(collection(db, 'orders', o.id, 'items'));
            o.items = snap.docs.map((d) => d.data() as OrderItem);
          }),
      );
      return out;
    },
    staleTime: 60_000,
  });

  categorySources = { categories: categories.data, orders: categoryOrders.data ?? [] };
  return { ...products, categorySourcesReady: categoryOrders.isSuccess };
}

export interface LowStockRow {
  key: string;
  name: string;
  left: number;
}

export function lowStockRows(products: Product[], threshold = 5, max = 5): LowStockRow[] {
  const rows: LowStockRow[] = [];
  for (const p of products) {
    const lim = p.lowStockThreshold || threshold;
    if (p.hasVariants) {
      for (const v of p.variants) {
        if (v.stock > 0 && v.stock <= lim) {
          rows.push({ key: `${p.id}_${v.id}`, name: `${p.name} · ${v.label}`, left: v.stock });
        }
      }
    } else if (p.stock > 0 && p.stock <= lim) {
      rows.push({ key: p.id, name: p.name, left: p.stock });
    }
  }
  return rows.sort((a, b) => a.left - b.left).slice(0, max);
}

export interface CategoryPerfRow {
  key: CategoryKey | string;
  label: string;
  pct: number;
  token: 'brand' | 'gold' | 'info' | 'success';
}

const CATEGORY_TOKENS: CategoryPerfRow['token'][] = ['brand', 'gold', 'info', 'success'];

/** The admin's `categoryTagColor` → the four bar tints this panel can paint. */
const TAG_TOKEN: Record<Category['categoryTagColor'], CategoryPerfRow['token']> = {
  amber: 'gold',
  green: 'success',
  blue: 'info',
  gray: 'brand',
};

/** "dates-gifts" → "Dates Gifts" — categoryIds are admin-authored slugs. */
const labelFromSlug = (slug: string): string =>
  slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

interface CategoryTotal {
  label: string;
  /** Tint the admin chose for this category; null = no matching category doc. */
  token: CategoryPerfRow['token'] | null;
  value: number;
}

/**
 * Revenue share per category over the last 90 days, normalized to the top
 * category = 100%.
 *
 * Labels and tints come from the live `categories` collection — the old
 * hardcoded map showed deleted seed categories and could never label or colour a
 * category the admin created. The split is aggregated from the order line items
 * using their *recorded* `lineTotalPaise`, not from the catalog: the previous
 * `soldCount` roll-up was a lifetime counter attached to today's product docs,
 * so it ignored the selected period entirely, moved whenever a product was
 * re-categorised, and dropped every product that had since been unpublished.
 *
 * There is deliberately no catalog fallback when the window is empty: it used to
 * fall back to `soldCount` whenever the order read was still in flight or had
 * failed, which silently swapped the metric from "90-day revenue" to "lifetime
 * units" behind identical bars. An empty result now means exactly that, and the
 * caller distinguishes "still loading" via `categorySourcesReady`.
 */
export function categoryPerformance(
  maxRows = 4,
  sources: CategorySources = categorySources,
): CategoryPerfRow[] {
  const { categories, orders } = sources;

  // Line items record `category` as the product's categorySlug (and a category
  // doc's id *is* its slug), but seeded orders carry the display name — so index
  // every identifier a category is known by.
  const byKey = new Map<string, Category>();
  for (const c of categories) {
    for (const k of [c.id, c.slug, c.name, c.displayName]) {
      if (k) byKey.set(String(k).toLowerCase(), c);
    }
  }

  const totals = new Map<string, CategoryTotal>();
  const bump = (rawKey: string | undefined, value: number) => {
    if (!rawKey) return;
    const cat = byKey.get(rawKey.toLowerCase());
    const key = cat?.id ?? rawKey;
    const row = totals.get(key) ?? {
      label: cat?.displayName || cat?.name || labelFromSlug(rawKey),
      token: cat ? TAG_TOKEN[cat.categoryTagColor] ?? null : null,
      value: 0,
    };
    row.value += value;
    totals.set(key, row);
  };

  for (const o of orders) {
    if (o.status === 'cancelled') continue; // cancelled orders aren't revenue
    // `lineTotalPaise` is gross of the order-level coupon/spin discount —
    // checkout writes `discountAppliedPaise: 0` on every line and keeps the
    // money off at order level — so a discounted order would credit its category
    // with more than it earned. Spread the discount across the lines by
    // line-total share, the same allocation the returns CF uses
    // (functions/src/returns/requests.ts). `spinRewardPaise` is already part of
    // `discountPaise`, so it must not be subtracted twice.
    const subtotal = o.subtotalPaise ?? 0;
    const discount = o.discountPaise ?? 0;
    for (const it of o.items ?? []) {
      const lineTotal = it.lineTotalPaise ?? (it.quantity ?? 0) * (it.offerPricePaise ?? 0);
      const share = subtotal > 0 ? Math.round((discount * lineTotal) / subtotal) : 0;
      bump(it.category, Math.max(0, lineTotal - share));
    }
  }

  const ranked = [...totals.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, maxRows);
  const max = Math.max(1, ...ranked.map(([, v]) => v.value));

  // Honour each category's own tint, but never paint two bars the same colour —
  // two categories may legitimately share a tag colour.
  const taken = new Set<CategoryPerfRow['token']>();
  const preferred = ranked.map(([, v]) => {
    if (v.token && !taken.has(v.token)) {
      taken.add(v.token);
      return v.token;
    }
    return null;
  });
  const spare = CATEGORY_TOKENS.filter((t) => !taken.has(t));
  let nextSpare = 0;

  return ranked.map(([key, v], i) => ({
    key,
    label: v.label,
    token: preferred[i] ?? spare[nextSpare++] ?? 'brand',
    pct: Math.round((v.value / max) * 100),
  }));
}

// ── Revenue trend (range-aware: 12M monthly · 30D/7D daily) ────────
export type TrendRange = '12M' | '30D' | '7D';

export interface TrendBar {
  label: string;
  paise: number;
  heightPct: number;
}

/** One bar: a half-open [from, to) instant range plus its axis label. */
interface Bucket {
  label: string;
  from: Date;
  to: Date;
}

function planBuckets(range: TrendRange): Bucket[] {
  const buckets: Bucket[] = [];
  if (range === '12M') {
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(1);
    cursor.setMonth(cursor.getMonth() - 11);
    for (let i = 0; i < 12; i++) {
      const to = new Date(cursor);
      to.setMonth(to.getMonth() + 1);
      buckets.push({ label: cursor.toLocaleString('en-IN', { month: 'short' }), from: new Date(cursor), to });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return buckets;
  }
  // Daily buckets for 30D / 7D.
  const days = range === '30D' ? 30 : 7;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const to = new Date(cursor);
    to.setDate(to.getDate() + 1);
    buckets.push({
      label:
        range === '7D'
          ? cursor.toLocaleString('en-IN', { weekday: 'short' })
          : String(cursor.getDate()),
      from: new Date(cursor),
      to,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return buckets;
}

export function useRevenueTrend(range: TrendRange = '12M') {
  return useQuery<TrendBar[]>({
    queryKey: ['dashboard', 'trend', range],
    queryFn: async () => {
      const buckets = planBuckets(range);
      // One server-side aggregate per bar. The previous single query took the
      // window with limit(2000) ordered ASCENDING, so as soon as the window held
      // more than 2000 orders the newest bars — including the current month —
      // silently rendered as ₹0.
      const sums = await Promise.all(
        buckets.map((b) =>
          sumRealisedPaise([
            where('createdAt', '>=', Timestamp.fromDate(b.from)),
            where('createdAt', '<', Timestamp.fromDate(b.to)),
          ]),
        ),
      );
      const max = Math.max(1, ...sums);
      return buckets.map((b, i) => {
        const paise = sums[i] ?? 0;
        return {
          label: b.label,
          paise,
          heightPct: paise > 0 ? Math.max(6, Math.round((paise / max) * 100)) : 2,
        };
      });
    },
    staleTime: 60_000,
  });
}
