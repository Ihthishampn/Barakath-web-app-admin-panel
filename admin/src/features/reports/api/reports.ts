import { useCallback, useRef, useSyncExternalStore } from 'react';
import {
  collection,
  getDocs,
  orderBy,
  query,
  Timestamp,
  where,
  type FirestoreError,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore';
import {
  formatMoneyCompact,
  formatMoneyInt,
  type Customer,
  type Order,
  type OrderItem,
  type OrderRequest,
  type Product,
} from '@barkath/shared';
import { db } from '@/lib/firebase';
import { downloadText } from '@/lib/exportCsv';
import type { CollectionState } from '@/hooks/firestoreCache';

// ── Date-range presets ─────────────────────────────────────────────
export type ReportRange = '12M' | '30D' | '7D';
export const REPORT_RANGES: ReportRange[] = ['12M', '30D', '7D'];

const toDate = (ts: unknown): Date => {
  const d = (ts as Timestamp | undefined)?.toDate?.();
  return d ?? new Date(0);
};

/** Inclusive start of the active window (00:00 local). */
function rangeStart(range: ReportRange): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === '12M') {
    d.setDate(1);
    d.setMonth(d.getMonth() - 11);
  } else {
    d.setDate(d.getDate() - (range === '30D' ? 29 : 6));
  }
  return d;
}

/**
 * Human label for the header subtitle, e.g. "1 Jan – 16 Jul 2026".
 *
 * The year is repeated on the start date whenever the window straddles a year
 * boundary (every 12M preset except in December): printing only the end year
 * captioned a window that began "1 Aug 2025" as "1 Aug – 23 Jul 2026", which
 * reads as a range starting in the future — and that string is also the CSV's
 * only statement of the period it covers.
 */
export function rangeLabel(range: ReportRange): string {
  const from = rangeStart(range);
  const to = new Date();
  const day = (x: Date) => x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const fromYear = from.getFullYear() === to.getFullYear() ? '' : ` ${from.getFullYear()}`;
  return `${day(from)}${fromYear} – ${day(to)} ${to.getFullYear()}`;
}

/**
 * Oldest instant a preset can need: its own window plus the equal-length
 * comparison window immediately before it (computeKpis' `prevFrom`). Floored to
 * midnight and given a day of slack so an order sitting on the boundary can't
 * fall outside the fetch just because `Date.now()` moved between the query and
 * the render that consumes it.
 */
function queryWindowStart(range: ReportRange): Date {
  const from = rangeStart(range);
  const d = new Date(from.getTime() - (Date.now() - from.getTime()));
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return d;
}

// ── One-shot, cached reads over the reportable window ───────────────
/**
 * Reports is a read-only analytics screen: it needs a consistent snapshot, not
 * a live feed. It used to hold four `onSnapshot` listeners open — orders,
 * products, customers and orderRequests — three of them over the *entire*
 * collection with no limit and no date filter. Every write anywhere in the shop
 * pushed a new array identity through all four `compute*` passes and re-rendered
 * the whole page, and the resident payload grew without bound.
 *
 * These are plain `getDocs` fetches instead, cached per key so the snapshot
 * survives navigation. Re-entering the screen shows the cached data instantly
 * and revalidates in the background (no loading flash, no listeners).
 */
interface FetchEntry {
  snapshot: CollectionState<unknown>;
  listeners: Set<() => void>;
  refs: number;
  /** A fetch has already been issued for the current mount generation. */
  started: boolean;
  inflight: boolean;
}

const fetchCache = new Map<string, FetchEntry>();

function ensureEntry(key: string): FetchEntry {
  let e = fetchCache.get(key);
  if (!e) {
    e = {
      snapshot: { data: [], loading: true, error: null },
      listeners: new Set(),
      refs: 0,
      started: false,
      inflight: false,
    };
    fetchCache.set(key, e);
  }
  return e;
}

/**
 * How a settled snapshot becomes the cached array. Defaults to the doc data, but
 * a reader may need an extra round trip (see `withLineItems`).
 */
type DocsReader = (snap: QuerySnapshot) => unknown[] | Promise<unknown[]>;

const readDocData: DocsReader = (snap) => snap.docs.map((d) => d.data());

function startFetch(key: string, makeQuery: () => Query, readDocs: DocsReader): void {
  const e = ensureEntry(key);
  // `inflight` also absorbs StrictMode's mount → unmount → mount, which would
  // otherwise fire the same query twice.
  if (e.started || e.inflight) return;
  e.started = true;
  e.inflight = true;
  getDocs(makeQuery())
    .then(async (snap) => {
      e.snapshot = { data: await readDocs(snap), loading: false, error: null };
    })
    .catch((error: FirestoreError) => {
      // Keep whatever was already cached; surface the error alongside it.
      e.snapshot = { data: e.snapshot.data, loading: false, error };
    })
    .finally(() => {
      e.inflight = false;
      for (const l of e.listeners) l();
    });
}

/** Cached one-shot collection read. Same `{ data, loading, error }` shape as the live hook. */
function useFetchCollection<T>(
  key: string,
  makeQuery: () => Query,
  readDocs: DocsReader = readDocData,
): CollectionState<T> {
  const makeRef = useRef(makeQuery);
  makeRef.current = makeQuery;
  const readRef = useRef(readDocs);
  readRef.current = readDocs;

  const subscribe = useCallback((cb: () => void) => {
    const e = ensureEntry(key);
    e.listeners.add(cb);
    e.refs++;
    startFetch(key, () => makeRef.current(), (snap) => readRef.current(snap));
    return () => {
      e.listeners.delete(cb);
      e.refs--;
      // Last subscriber gone: keep the snapshot as a stale cache but allow the
      // next mount to revalidate it.
      if (e.refs <= 0) {
        e.refs = 0;
        e.started = false;
      }
    };
  }, [key]);

  const getSnapshot = useCallback(() => ensureEntry(key).snapshot as CollectionState<T>, [key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Each hook takes the active preset and reads only that window (plus its
 * comparison window). The default is the widest preset, so a caller that does
 * not pass a range still gets full coverage for every preset.
 */
/**
 * Orders written before the embedded-items migration keep their lines in the
 * `orders/{id}/items` subcollection, and the shared `Order` type requires
 * readers to fall back to it. Skipping that fallback let such an order count in
 * full towards Total revenue and the trend bars (both read `totalPaise` off the
 * order doc) while contributing ₹0 to Top products, so two panels on the same
 * screen disagreed and a product that only ever sold on legacy orders could
 * never rank. Only orders actually missing the array cost an extra read.
 */
async function withLineItems(snap: QuerySnapshot): Promise<Order[]> {
  const orders = snap.docs.map((d) => ({ ...(d.data() as Order), id: d.id }));
  await Promise.all(
    orders
      .filter((o) => !o.items?.length)
      .map(async (o) => {
        const items = await getDocs(collection(db, 'orders', o.id, 'items'));
        o.items = items.docs.map((d) => d.data() as OrderItem);
      }),
  );
  return orders;
}

export function useReportOrders(range: ReportRange = '12M') {
  return useFetchCollection<Order>(
    `orders:reports:${range}`,
    () =>
      query(
        collection(db, 'orders'),
        where('createdAt', '>=', Timestamp.fromDate(queryWindowStart(range))),
        orderBy('createdAt', 'desc'),
      ),
    withLineItems,
  );
}

/**
 * Products are only a display-name fallback for line items that predate
 * `productName`, so there is no date field to scope by — but it is a one-shot
 * read now rather than a permanent listener on the whole catalog.
 */
export function useReportProducts() {
  return useFetchCollection<Product>('products:reports', () => query(collection(db, 'products')));
}

export function useReportCustomers(range: ReportRange = '12M') {
  return useFetchCollection<Customer>(`customers:reports:${range}`, () =>
    query(
      collection(db, 'customers'),
      where('createdAt', '>=', Timestamp.fromDate(queryWindowStart(range))),
      orderBy('createdAt', 'desc'),
    ),
  );
}

/**
 * Return/refund requests — the real refund signal (approved → money moved).
 * A request is always created after the order it points at, so scoping to the
 * same window cannot hide a request for an in-window order.
 */
export function useReportOrderRequests(range: ReportRange = '12M') {
  return useFetchCollection<OrderRequest>(`orderRequests:reports:${range}`, () =>
    query(
      collection(db, 'orderRequests'),
      where('createdAt', '>=', Timestamp.fromDate(queryWindowStart(range))),
    ),
  );
}

/**
 * One-slot argument-identity memo — a `useMemo` that lives with the derivation
 * instead of at the call site. The cached arrays above only get a new identity
 * when a fetch settles, so an unrelated re-render no longer re-walks every order
 * three times.
 */
function memoize<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let last: { args: A; out: R } | null = null;
  return (...args: A): R => {
    if (last && last.args.length === args.length && last.args.every((v, i) => Object.is(v, args[i]))) {
      return last.out;
    }
    const out = fn(...args);
    last = { args, out };
    return out;
  };
}

const inWindow = (ts: unknown, from: Date, to: Date): boolean => {
  const t = toDate(ts).getTime();
  return t >= from.getTime() && t < to.getTime();
};

const REFUND_STATUSES: ReadonlyArray<string> = ['refunded', 'partial_refund'];
const REFUNDED_REQUEST_STATUSES: ReadonlyArray<string> = ['approved', 'completed'];

/** Order ids that had money refunded via an approved/completed return request. */
function refundedOrderIds(requests: OrderRequest[]): Set<string> {
  const ids = new Set<string>();
  for (const r of requests) {
    if (REFUNDED_REQUEST_STATUSES.includes(r.status) && (r.refundAmountPaise ?? 0) > 0 && r.orderId) {
      ids.add(r.orderId);
    }
  }
  return ids;
}

/**
 * An order counts as refunded if ANY refund signal is present: a refunded
 * payment status, a non-zero `refundedPaise` (partial return), or an approved
 * return request pointing at it. Checking only `paymentStatus` missed every
 * return refund, which is why the rate read 0%.
 */
const isRefunded = (o: Order, refundedIds: Set<string>): boolean =>
  REFUND_STATUSES.includes(o.paymentStatus) ||
  Number((o as { refundedPaise?: number }).refundedPaise ?? 0) > 0 ||
  refundedIds.has(o.id);

/** Cancelled orders never realised revenue, so they're excluded from the total. */
const sumRevenue = (list: Order[]): number =>
  list.filter((o) => o.status !== 'cancelled').reduce((acc, o) => acc + (o.totalPaise ?? 0), 0);

const pctDelta = (curr: number, prev: number): number | null =>
  prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : null;

// ── KPIs (current window vs. the immediately-preceding window) ──────
export interface ReportKpis {
  totalRevenuePaise: number;
  orders: number;
  newCustomers: number;
  refundRatePct: number;
  revenueDeltaPct: number | null;
  ordersDeltaPct: number | null;
  customersDeltaPct: number | null;
  /** Change in refund rate, percentage points. Negative = improvement. */
  refundRateDeltaPp: number | null;
}

export const computeKpis = memoize(function computeKpis(
  orders: Order[],
  customers: Customer[],
  requests: OrderRequest[],
  range: ReportRange,
): ReportKpis {
  const now = new Date();
  const from = rangeStart(range);
  const spanMs = now.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - spanMs);

  const curr = orders.filter((o) => inWindow(o.createdAt, from, now));
  const prev = orders.filter((o) => inWindow(o.createdAt, prevFrom, from));

  const currRevenue = sumRevenue(curr);
  const prevRevenue = sumRevenue(prev);

  const newCustomers = customers.filter((c) => inWindow(c.createdAt, from, now)).length;
  const prevCustomers = customers.filter((c) => inWindow(c.createdAt, prevFrom, from)).length;

  const refundedIds = refundedOrderIds(requests);
  const currRate = curr.length > 0 ? (curr.filter((o) => isRefunded(o, refundedIds)).length / curr.length) * 100 : 0;
  const prevRate = prev.length > 0 ? (prev.filter((o) => isRefunded(o, refundedIds)).length / prev.length) * 100 : 0;

  return {
    totalRevenuePaise: currRevenue,
    orders: curr.length,
    newCustomers,
    refundRatePct: Math.round(currRate * 10) / 10,
    revenueDeltaPct: pctDelta(currRevenue, prevRevenue),
    ordersDeltaPct: pctDelta(curr.length, prev.length),
    customersDeltaPct: pctDelta(newCustomers, prevCustomers),
    refundRateDeltaPp: prev.length > 0 ? Math.round((currRate - prevRate) * 10) / 10 : null,
  };
});

// ── Revenue trend (12M monthly · 30D/7D daily) ─────────────────────
export interface TrendBar {
  label: string;
  paise: number;
  heightPct: number;
}

export const computeTrend = memoize(function computeTrend(orders: Order[], range: ReportRange): TrendBar[] {
  const from = rangeStart(range);
  const buckets: { label: string; key: string; paise: number }[] = [];
  let keyOf: (d: Date) => string;

  if (range === '12M') {
    const cursor = new Date(from);
    for (let i = 0; i < 12; i++) {
      buckets.push({
        label: cursor.toLocaleString('en-IN', { month: 'short' }),
        key: `${cursor.getFullYear()}-${cursor.getMonth()}`,
        paise: 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    keyOf = (d) => `${d.getFullYear()}-${d.getMonth()}`;
  } else {
    const days = range === '30D' ? 30 : 7;
    const cursor = new Date(from);
    for (let i = 0; i < days; i++) {
      buckets.push({
        label: range === '7D' ? cursor.toLocaleString('en-IN', { weekday: 'short' }) : String(cursor.getDate()),
        key: `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`,
        paise: 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    keyOf = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const o of orders) {
    if (o.status === 'cancelled') continue; // cancelled orders aren't revenue
    const b = byKey.get(keyOf(toDate(o.createdAt)));
    if (b) b.paise += o.totalPaise ?? 0;
  }

  const max = Math.max(1, ...buckets.map((b) => b.paise));
  return buckets.map((b) => ({
    label: b.label,
    paise: b.paise,
    heightPct: b.paise > 0 ? Math.max(6, Math.round((b.paise / max) * 100)) : 2,
  }));
});

// ── Top products by revenue over the window ────────────────────────
export interface TopProductRow {
  rank: number;
  productId: string;
  name: string;
  revenuePaise: number;
}

export const computeTopProducts = memoize(function computeTopProducts(
  orders: Order[],
  products: Product[],
  range: ReportRange,
  n: number = 5,
): TopProductRow[] {
  const from = rangeStart(range);
  const now = new Date();
  // Products are only needed for a display name; the money comes off the order.
  const nameOf = new Map(products.map((p) => [p.id, p.name]));

  const acc = new Map<string, { name: string; paise: number }>();
  for (const o of orders) {
    if (!inWindow(o.createdAt, from, now)) continue;
    if (o.status === 'cancelled') continue; // cancelled orders aren't revenue
    // `items` is the canonical line-item array. `itemsSummary` is the capped
    // 4-item thumbnail strip checkout writes for the list UI — using it dropped
    // every product past the 4th on an order. Legacy orders that predate the
    // embedded array are hydrated from the orders/{id}/items subcollection by
    // `withLineItems` before they reach this pure function.
    //
    // `lineTotalPaise` is gross of the order-level coupon/spin discount —
    // checkout writes `discountAppliedPaise: 0` on every line — so summing it
    // raw produced a column that could exceed the net "Total revenue" KPI sitting
    // on the same screen and in the same CSV. The discount is spread across the
    // lines by line-total share, the same allocation the returns CF uses
    // (functions/src/returns/requests.ts). `spinRewardPaise` is already part of
    // `discountPaise`, so it must not be subtracted twice.
    const subtotal = o.subtotalPaise ?? 0;
    const discount = o.discountPaise ?? 0;
    for (const item of o.items ?? []) {
      // Realised money for the line, not today's catalog price: the catalog
      // price is variant-row-0 only, ignores discounts, and rewrites history
      // whenever an admin edits a price.
      const lineTotal = item.lineTotalPaise ?? (item.quantity ?? 0) * (item.offerPricePaise ?? 0);
      const share = subtotal > 0 ? Math.round((discount * lineTotal) / subtotal) : 0;
      const revenue = Math.max(0, lineTotal - share);
      const row = acc.get(item.productId) ?? {
        name: item.productName || nameOf.get(item.productId) || item.productId,
        paise: 0,
      };
      row.paise += revenue;
      acc.set(item.productId, row);
    }
  }

  return [...acc.entries()]
    .map(([productId, v]) => ({ productId, name: v.name, revenuePaise: v.paise }))
    .sort((a, b) => b.revenuePaise - a.revenuePaise)
    .slice(0, n)
    .map((r, i) => ({ rank: i + 1, ...r }));
});

// ── Client-side report export (CSV — no Cloud Function) ────────────
export function downloadReportCsv(
  range: ReportRange,
  kpis: ReportKpis,
  trend: TrendBar[],
  top: TopProductRow[],
): void {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Money goes out as a plain number of rupees (2dp) so the sheet can sum and
  // chart it; the formatted string is a separate, clearly-labelled column.
  // ₹-prefixed / compacted text ("₹12.3L") is not a number and silently lost
  // precision when it was the only value exported.
  const rupees = (paise: number) => (paise / 100).toFixed(2);

  const lines: string[] = [];
  lines.push(`Barakath — Reports & Analytics`);
  lines.push(`Range,${range} (${rangeLabel(range)})`);
  lines.push('');
  lines.push('Metric,Value (INR),Display');
  lines.push(
    `Total revenue,${rupees(kpis.totalRevenuePaise)},${esc(formatMoneyCompact(kpis.totalRevenuePaise))}`,
  );
  lines.push(`Orders,${kpis.orders},`);
  lines.push(`New customers,${kpis.newCustomers},`);
  lines.push(`Refund rate,${kpis.refundRatePct},${kpis.refundRatePct}%`);
  lines.push('');
  lines.push('Period,Revenue (INR),Display');
  for (const b of trend) lines.push(`${esc(b.label)},${rupees(b.paise)},${esc(formatMoneyInt(b.paise))}`);
  lines.push('');
  lines.push('Rank,Product,Revenue (INR),Display');
  for (const r of top) {
    lines.push(`${r.rank},${esc(r.name)},${rupees(r.revenuePaise)},${esc(formatMoneyCompact(r.revenuePaise))}`);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  downloadText(`barakath-report-${range}-${stamp}.csv`, lines.join('\n'));
}
