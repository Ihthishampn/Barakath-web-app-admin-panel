import { collection, orderBy, query } from 'firebase/firestore';
import type { Order, Payment, PaymentMethod, PaymentStatus } from '@barkath/shared';
import { db } from '@/lib/firebase';
import { useLiveCollection } from '@/hooks/firestoreCache';

export const PAYMENTS_KEY = 'payments:createdAt-desc';

/** All payments, newest first, real-time. */
export function usePaymentsList() {
  return useLiveCollection<Payment>(PAYMENTS_KEY, () =>
    query(collection(db, 'payments'), orderBy('createdAt', 'desc')),
  );
}

export type PillTone = 'success' | 'info' | 'gold' | 'error' | 'neutral';

export function paymentStatusPill(status: PaymentStatus): { label: string; tone: PillTone } {
  switch (status) {
    case 'captured':
      return { label: 'Success', tone: 'success' };
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

export function methodLabel(method: PaymentMethod): string {
  return method === 'cod' ? 'COD' : method === 'wallet' ? 'Wallet' : 'Online';
}

/**
 * The payment status as reality has it, not as the document has it.
 *
 * COD cash is handed over on delivery, but the payment row is only settled by
 * the delivery transition — so every COD order delivered before that settlement
 * existed (and every seeded one) sits at 'pending' forever, which keeps real
 * money out of the month total and out of the GST export. The order is the
 * authority here: a delivered COD order has been collected, exactly the rule
 * the server-side refund guard already applies (functions/src/returns/decisions.ts).
 */
export function effectivePaymentStatus(p: Payment, order: Order | undefined): PaymentStatus {
  if (p.status === 'pending' && p.method === 'cod' && order && (order.status === 'delivered' || !!order.deliveredAt)) {
    return 'captured';
  }
  return p.status;
}

/**
 * What the store actually kept on this payment: the captured amount less
 * anything refunded back out of it. `refundedPaise` is written by the return and
 * cancellation paths and is not on the shared Payment type yet, so it is read
 * defensively (same pattern as reports.ts does for order.refundedPaise).
 */
export function netAmountPaise(p: Payment): number {
  const refunded = Number((p as { refundedPaise?: number }).refundedPaise ?? 0);
  return Math.max(0, p.amountPaise - refunded);
}
