import { collection, doc, getDoc, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  ORDER_STATUS_TO_ADMIN_TAB,
  ORDER_STATUS_TRANSITIONS,
  type AdminOrderTab,
  type Order,
  type OrderItem,
  type OrderStatus,
  type OrderTimelineEntry,
  type PaymentStatus,
} from '@barkath/shared';
import { db, functions } from '@/lib/firebase';
import { useLiveCollection, useLiveDoc, type CollectionState } from '@/hooks/firestoreCache';

export const ORDERS_KEY = 'orders:placedAt-desc';

/** All orders for the admin list, newest first, real-time. */
export function useOrdersList() {
  return useLiveCollection<Order>(ORDERS_KEY, () =>
    query(collection(db, 'orders'), orderBy('placedAt', 'desc')),
  );
}

export function useOrder(id: string | null) {
  return useLiveDoc<Order>(id ? `orders/${id}` : null);
}

/**
 * Line items for an order. Items now live in an embedded `items` array on the
 * order document, so when that array is present we return it directly — no extra
 * read. Legacy orders written before the move have no embedded array; for those
 * we fall back to the live `orders/{id}/items` subcollection exactly as before.
 * The shape matches the old subcollection result so consumers are unchanged.
 */
export function useOrderItems(order: Order | null): CollectionState<OrderItem> {
  const embedded = order?.items;
  const hasEmbedded = Array.isArray(embedded) && embedded.length > 0;
  const id = order?.id ?? null;
  // Hooks must run unconditionally; the subcollection listener only attaches for
  // legacy orders (query is null when embedded items are present).
  const sub = useLiveCollection<OrderItem>(`orders/${id}/items`, () =>
    id && !hasEmbedded ? query(collection(db, 'orders', id, 'items'), orderBy('createdAt', 'asc')) : null,
  );
  return hasEmbedded ? { data: embedded, loading: false, error: null } : sub;
}

/** Immutable status timeline (orders/{id}/timeline), oldest first, real-time. */
export function useOrderTimeline(id: string | null) {
  return useLiveCollection<OrderTimelineEntry>(`orders/${id}/timeline`, () =>
    id ? query(collection(db, 'orders', id, 'timeline'), orderBy('at', 'asc')) : null,
  );
}

export async function getOrder(id: string): Promise<Order | null> {
  const snap = await getDoc(doc(db, 'orders', id));
  return snap.exists() ? (snap.data() as Order) : null;
}

// ── Payment pill (prototype colours) ───────────────────────────────
export type PillTone = 'success' | 'info' | 'gold' | 'error' | 'neutral';

/**
 * The order's payment status as reality has it.
 *
 * COD is no longer offered at checkout, but historical COD orders are live data
 * and must keep reconciling: cash is handed over on delivery, and the delivery
 * transition settles the order to 'captured'
 * (functions/src/orders/status.ts — `status === 'delivered' && paymentMethod ===
 * 'cod' && paymentStatus === 'pending'`). Orders delivered before that
 * settlement existed (and every seeded one) still sit at 'pending' for ever.
 *
 * The Payments screen already reads them as collected
 * (payments/api/payments.ts `effectivePaymentStatus`) and counts them in the
 * month total and the GST export — so Orders has to apply the same rule or the
 * two screens contradict each other about the same money.
 */
export function effectiveOrderPaymentStatus(o: Order): PaymentStatus {
  if (o.paymentMethod === 'cod' && o.paymentStatus === 'pending' && (o.status === 'delivered' || !!o.deliveredAt)) {
    return 'captured';
  }
  return o.paymentStatus;
}

export function paymentPill(o: Order): { label: string; tone: PillTone } {
  const status = effectiveOrderPaymentStatus(o);
  // An un-settled COD order is money the store is still waiting on, so it reads
  // as "COD" (gold) rather than "Pending" — that is the reconciliation cue.
  if (o.paymentMethod === 'cod' && status !== 'refunded' && status !== 'captured') {
    return { label: 'COD', tone: 'gold' };
  }
  switch (status) {
    case 'captured':
      return { label: 'Paid', tone: 'success' };
    case 'failed':
      return { label: 'Failed', tone: 'error' };
    case 'refunded':
      return { label: 'Refunded', tone: 'neutral' };
    case 'partial_refund':
      return { label: 'Part refund', tone: 'neutral' };
    default:
      return { label: 'Pending', tone: 'gold' };
  }
}

// ── Tabs (6 buckets, §1.6a) ────────────────────────────────────────
export const ORDER_TABS: { key: AdminOrderTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'packed', label: 'Packed' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

export function tabOf(status: OrderStatus): AdminOrderTab {
  return ORDER_STATUS_TO_ADMIN_TAB[status];
}

export function countByTab(orders: Order[]): Record<AdminOrderTab, number> {
  const counts = { all: orders.length, accepted: 0, packed: 0, shipped: 0, delivered: 0, cancelled: 0 } as Record<AdminOrderTab, number>;
  for (const o of orders) counts[tabOf(o.status)]++;
  return counts;
}

/** Valid next statuses for the Update-status menu (state machine, §1.6a). */
export function nextStatuses(status: OrderStatus): OrderStatus[] {
  return ORDER_STATUS_TRANSITIONS[status];
}

// ── Privileged mutations (Cloud Functions — money/atomic/cross-user) ──
interface ChangeStatusInput {
  orderId: string;
  status: OrderStatus;
  note?: string | null;
}

/**
 * Order status transitions run server-side: they touch inventory, refunds on
 * cancel, affiliate commissions and the immutable timeline — exactly the
 * "critical" surface Cloud Functions exist for (tech-arch §6.0). The orders
 * collection is CF-only-write in firestore.rules.
 */
export async function changeOrderStatus(input: ChangeStatusInput): Promise<void> {
  const call = httpsCallable(functions, 'adminChangeOrderStatus');
  await call(input);
}

interface AssignRiderInput {
  orderId: string;
  courier: string | null;
  trackingId: string | null;
  riderName: string | null;
  riderPhone: string | null;
}

/**
 * Shipment assignment is CF-only for the same reason status changes are: the
 * orders collection is not client-writable in firestore.rules. The server folds
 * riderName/riderPhone into the stored `Rider` object (keeping its
 * currentDistanceKm) and rejects a cancelled order with failed-precondition.
 */
export async function assignRider(input: AssignRiderInput): Promise<void> {
  const call = httpsCallable<AssignRiderInput, { ok: boolean }>(functions, 'adminAssignRider');
  await call(input);
}

export async function generateInvoice(orderId: string): Promise<string> {
  const call = httpsCallable<{ orderId: string }, { url: string }>(functions, 'adminGenerateInvoice');
  const res = await call({ orderId });
  return res.data.url;
}
