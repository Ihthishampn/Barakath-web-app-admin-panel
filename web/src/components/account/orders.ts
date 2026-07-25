'use client';
/**
 * Account · orders data layer — Firestore hooks + presentation helpers shared
 * by the account/orders/tracking/invoice/return screens.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { useCollection, type CollectionState } from '@/lib/useCollection';
import { addToCartError, useCart } from '@/lib/cart';
import type { Order, OrderItem, OrderStatus, OrderTimelineEntry, Ts } from '@barkath/shared';

// ── Status → pill/label/banner metadata ───────────────────────────────────
export type StatusTone = 'gold' | 'brand' | 'info' | 'success' | 'error';

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; tone: StatusTone }> = {
  accepted: { label: 'Accepted', tone: 'gold' },
  packing: { label: 'Packing', tone: 'gold' },
  packed: { label: 'Packed', tone: 'gold' },
  shipped: { label: 'Shipped', tone: 'brand' },
  out_for_delivery: { label: 'Out for delivery', tone: 'brand' },
  delivered: { label: 'Delivered', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'error' },
};

/**
 * Metadata for a status, tolerating one this build doesn't know about — a
 * status added server-side would otherwise crash the timeline/pill on lookup.
 * Unknown values render humanised with a neutral tone.
 */
export function statusMeta(status: OrderStatus | string): { label: string; tone: StatusTone } {
  const known = ORDER_STATUS_META[status as OrderStatus];
  if (known) return known;
  const words = String(status ?? '').replace(/_/g, ' ').trim();
  return { label: words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Update', tone: 'info' };
}

const OPEN_STATUSES: OrderStatus[] = ['accepted', 'packing', 'packed', 'shipped', 'out_for_delivery'];
export const isOpen = (s: OrderStatus): boolean => OPEN_STATUSES.includes(s);
export const isCancellable = (s: OrderStatus): boolean =>
  s === 'accepted' || s === 'packing' || s === 'packed';

/**
 * A delayed order: still open (not delivered, not cancelled) and its promised
 * `expectedDeliveryDate` is already behind us. The stamp is never bumped after
 * placement, so this is the only signal a shipment has run late.
 *
 * Compared at day granularity (midnight-truncated, local time) so an ETA of
 * "today" is never prematurely flagged — a shipment is late only once its
 * promised day has fully passed. Mirrors the app's `Order.isDelayed`.
 */
export function isDelayed(order: Order): boolean {
  if (!isOpen(order.status)) return false;
  const eta = order.expectedDeliveryDate?.toDate?.();
  if (!eta) return false;
  const startOfEtaDay = new Date(eta.getFullYear(), eta.getMonth(), eta.getDate()).getTime();
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return startOfEtaDay < startOfToday;
}

/** Full-width status banner copy for the order-detail hero. */
export function statusBanner(order: Order): { tone: StatusTone; text: string } {
  switch (order.status) {
    case 'delivered':
      return { tone: 'success', text: `Delivered${order.deliveredAt ? ` on ${fmtDate(order.deliveredAt)}` : ''}` };
    case 'cancelled':
      return { tone: 'error', text: 'This order was cancelled.' };
  }
  // Open order whose promised date has passed — never show a stale "arriving
  // <past date>"; say it's running late instead, like Amazon/Flipkart do.
  if (isDelayed(order)) {
    return { tone: 'error', text: 'Delivery delayed · your order is taking longer than expected.' };
  }
  switch (order.status) {
    case 'out_for_delivery':
      return { tone: 'info', text: `Out for delivery · arriving ${fmtDate(order.expectedDeliveryDate)}` };
    case 'shipped':
      return { tone: 'info', text: `Shipped · arriving ${fmtDate(order.expectedDeliveryDate)}` };
    default:
      return { tone: 'gold', text: `Being prepared · arriving ${fmtDate(order.expectedDeliveryDate)}` };
  }
}

// ── Date helpers ───────────────────────────────────────────────────────────
export function fmtDate(ts?: Ts | null, opts?: Intl.DateTimeFormatOptions): string {
  if (!ts) return '—';
  return ts.toDate().toLocaleDateString('en-IN', opts ?? { day: 'numeric', month: 'short' });
}
export function fmtDateLong(ts?: Ts | null): string {
  return fmtDate(ts, { weekday: 'short', day: 'numeric', month: 'short' });
}
export function fmtDateTime(ts?: Ts | null): string {
  if (!ts) return '—';
  return ts.toDate().toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ── Collection hooks ───────────────────────────────────────────────────────
export function useOrders(uid?: string) {
  // Index-free: filter by customerId only (no orderBy → no composite index),
  // then sort newest-first on the client.
  const res = useCollection<Order>(
    () => (uid ? query(collection(db, 'orders'), where('customerId', '==', uid)) : null),
    [uid],
  );
  const data = useMemo(
    () => [...res.data].sort((a, b) => (b.placedAt?.toMillis?.() ?? 0) - (a.placedAt?.toMillis?.() ?? 0)),
    [res.data],
  );
  return { ...res, data };
}

/**
 * Live order line items.
 *
 * Line items are now embedded on the order document as an `items` array. When a
 * loaded `order` is passed in and carries a non-empty `items` array we derive
 * from it directly (no extra read). Otherwise we fall back to the legacy
 * `orders/{id}/items` subcollection so orders written before the migration keep
 * working:
 *   • `order` is a loaded doc without an embedded array → subscribe to the
 *     subcollection.
 *   • `order` is `null` (still loading / not found) → stay loading, wait for it.
 *   • `order` omitted (`undefined`) → fetch the order doc, read its embedded
 *     `items`, and fall back to the subcollection when the array is absent/empty.
 */
export function useOrderItems(orderId: string, order?: Order | null): CollectionState<OrderItem> {
  const [state, setState] = useState<CollectionState<OrderItem>>({ data: [], loading: true, error: false });

  useEffect(() => {
    let cancelled = false;

    const subscribeSubcollection = () =>
      onSnapshot(
        query(collection(db, 'orders', orderId, 'items')),
        (snap) => {
          if (!cancelled) setState({ data: snap.docs.map((d) => d.data() as OrderItem), loading: false, error: false });
        },
        () => {
          if (!cancelled) setState({ data: [], loading: false, error: true });
        },
      );

    // Caller passed a loaded order object.
    if (order) {
      const embedded = order.items;
      if (Array.isArray(embedded) && embedded.length > 0) {
        // Embedded items present — use them directly, no extra read.
        setState({ data: embedded, loading: false, error: false });
        return;
      }
      // Old order with no embedded array — live subcollection fallback.
      setState((s) => ({ ...s, loading: true }));
      return subscribeSubcollection();
    }

    // Caller passed `null` — the order is still loading (or not found); wait.
    if (order === null) {
      setState({ data: [], loading: true, error: false });
      return;
    }

    // No order object supplied — fetch the order doc, read its embedded items,
    // and fall back to the subcollection when the array is absent/empty.
    setState((s) => ({ ...s, loading: true }));
    let unsub: (() => void) | undefined;
    getDoc(doc(db, 'orders', orderId))
      .then((snap) => {
        if (cancelled) return;
        const embedded = snap.exists() ? (snap.data() as Order).items : undefined;
        if (Array.isArray(embedded) && embedded.length > 0) {
          setState({ data: embedded, loading: false, error: false });
        } else {
          unsub = subscribeSubcollection();
        }
      })
      .catch(() => {
        if (!cancelled) setState({ data: [], loading: false, error: true });
      });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [orderId, order]);

  return state;
}

export function useTimeline(orderId: string) {
  return useCollection<OrderTimelineEntry>(
    () => query(collection(db, 'orders', orderId, 'timeline'), orderBy('at', 'asc')),
    [orderId],
  );
}

// ── Single order (one-shot getDoc; not-found aware) ────────────────────────
export interface OrderState {
  order: Order | null;
  loading: boolean;
  error: boolean;
  notFound: boolean;
}

export function useOrder(orderId: string): OrderState {
  const [state, setState] = useState<OrderState>({
    order: null,
    loading: true,
    error: false,
    notFound: false,
  });
  useEffect(() => {
    setState({ order: null, loading: true, error: false, notFound: false });
    // Live subscription so an action's new status (cancelled, return-in-progress)
    // reflects immediately and persists across reopens.
    const unsub = onSnapshot(
      doc(db, 'orders', orderId),
      (snap) => {
        if (!snap.exists()) setState({ order: null, loading: false, error: false, notFound: true });
        else setState({ order: { ...(snap.data() as Order), id: snap.id }, loading: false, error: false, notFound: false });
      },
      () => setState({ order: null, loading: false, error: true, notFound: false }),
    );
    return unsub;
  }, [orderId]);
  return state;
}

// ── Customer order actions + derived action state ──────────────────────────
/** Cancel an order (server restores stock + refunds to wallet). */
export async function cancelOrder(orderId: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await httpsCallable(functions, 'cancelOrder')({ orderId });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as { message?: string })?.message };
  }
}

const ACTIVE_RETURN = ['requested', 'under_review', 'approved', 'completed'];

/**
 * What the customer's return request actually settled to.
 *
 * The order ITEM only ever gets `returnStatus: 'approved'` — the refund
 * outcome (whether money moved, and where to) is written on the orderRequest
 * by adminApproveOrderRequest. So the badge cannot be derived from the item
 * alone, which is why it used to claim "refund on the way" even after the
 * wallet had already been credited.
 */
export interface ReturnOutcome {
  /** Non-null only when money genuinely moved. */
  refundedAt?: { toMillis?: () => number } | null;
  refundMethod?: string | null;
}

/**
 * The active return badge for an order, or null if none.
 *
 * `outcome` is the matching orderRequest when one has been loaded. Without it
 * the wording stays deliberately non-committal — better to under-promise than
 * to tell someone their money has arrived when we have not checked.
 */
export function returnBadge(
  items: OrderItem[],
  outcome?: ReturnOutcome | null,
): { label: string; done: boolean } | null {
  const it = items.find((x) => x.returnStatus && ACTIVE_RETURN.includes(x.returnStatus));
  if (!it) return null;
  const s = it.returnStatus;
  const refunded = !!outcome?.refundedAt;
  if (s === 'completed' || refunded) {
    // `refundedAt` is stamped ONLY when the wallet was actually credited; an
    // approval with auto-refund off records refundMethod 'gateway' and leaves
    // it null, and that customer is still waiting on a manual transfer.
    if (refunded && outcome?.refundMethod === 'wallet') {
      return { label: 'Refunded to your wallet', done: true };
    }
    return { label: 'Item returned', done: true };
  }
  if (s === 'approved') {
    if (outcome && outcome.refundMethod === 'gateway') {
      return { label: 'Return approved · refund to your original payment method', done: false };
    }
    return { label: 'Return approved · refund on the way', done: false };
  }
  return { label: 'Return request in progress', done: false };
}

/** True when at least one item is still eligible for a fresh return request. */
export function hasReturnableItem(items: OrderItem[]): boolean {
  return items.some((x) => !x.returnStatus || x.returnStatus === 'none' || x.returnStatus === 'rejected');
}

/** Fallback return window (days) until an admin sets settings/returns. */
export const DEFAULT_RETURN_WINDOW_DAYS = 7;

export interface ReturnWindow {
  open: boolean;
  /** Whole days left, 0 once the window has closed. */
  daysLeft: number;
  windowDays: number;
}

/**
 * Whether an order is still inside the admin-configured return window.
 *
 * Measured from delivery (falling back to the placed date for older orders
 * that predate `deliveredAt`). A window of 0 days disables returns entirely.
 */
export function returnWindow(order: Order, windowDays: number | undefined): ReturnWindow {
  const days = windowDays ?? DEFAULT_RETURN_WINDOW_DAYS;
  const from = order.deliveredAt ?? order.placedAt;
  const fromMs = from?.toMillis?.();
  if (days <= 0 || !fromMs) return { open: false, daysLeft: 0, windowDays: days };

  const elapsedDays = (Date.now() - fromMs) / 86_400_000;
  const daysLeft = Math.max(0, Math.ceil(days - elapsedDays));
  return { open: elapsedDays <= days, daysLeft, windowDays: days };
}

// ── Reorder (client-side: re-add the order's items to the cart) ────────────
export interface ReorderResult {
  /** Units actually added to the bag. */
  added: number;
  /** Lines refused because they would cross a bag/order cap. */
  skipped: number;
}

/**
 * Reads the order's items and adds them to the cart.
 *
 * A past order can be larger than what a single bag may now hold (see the caps
 * in src/lib/cart.ts) — those lines are skipped and counted rather than
 * silently clamped, so the caller can say what happened.
 */
export async function reorder(orderId: string): Promise<ReorderResult> {
  // Prefer the order document's embedded items array; fall back to the legacy
  // subcollection for orders written before the migration.
  const orderSnap = await getDoc(doc(db, 'orders', orderId));
  const embedded = orderSnap.exists() ? (orderSnap.data() as Order).items : undefined;
  const items: OrderItem[] =
    Array.isArray(embedded) && embedded.length > 0
      ? embedded
      : (await getDocs(collection(db, 'orders', orderId, 'items'))).docs.map((d) => d.data() as OrderItem);
  const add = useCart.getState().add;
  let units = 0;
  let skipped = 0;
  items.forEach((it) => {
    const limit = addToCartError(
      useCart.getState().lines,
      it.productId,
      it.variantId,
      it.quantity,
    );
    if (limit) {
      skipped += 1;
      return;
    }
    add(
      {
        productId: it.productId,
        variantId: it.variantId,
        name: it.productName,
        variantLabel: it.variantLabel,
        imageUrl: it.imageUrl || null,
        categoryTint: it.categoryTint || '#e6cfb4',
        // The order line records the product's categorySlug as `category`
        // (placeOrder writes PricedLine.category); items written before that
        // field existed have none, and refreshPrices fills those in.
        categorySlug: it.category || null,
        pricePaise: it.offerPricePaise,
        mrpPaise: it.mrpPaise,
      },
      it.quantity,
    );
    units += it.quantity;
  });
  return { added: units, skipped };
}

// ── Return request (server-only write) ─────────────────────────────────────
export interface ReturnPayload {
  orderId: string;
  itemId: string;
  reasonKey: string;
  note: string;
}

/**
 * Raise a return request.
 *
 * Mirrors `cancelOrder`: the callable's own message is passed back so the
 * caller can show the real, permanent reason (window closed, already
 * requested, not delivered) instead of a generic "try again".
 */
export async function requestReturn(payload: ReturnPayload): Promise<{ ok: boolean; message?: string }> {
  try {
    await httpsCallable(functions, 'requestReturnOrReplacement')(payload);
    return { ok: true };
  } catch (e) {
    const m = (e as { message?: string })?.message;
    return { ok: false, message: m && !m.startsWith('INTERNAL') ? m : undefined };
  }
}
