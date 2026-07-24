/**
 * The customer-facing copy for every notification the backend emits, in one
 * place so the wording (and the deep link) cannot drift between the two paths
 * that raise the same event — order cancellation, for instance, is reachable
 * from the customer's own `cancelOrder`, from `adminChangeOrderStatus` and from
 * the abandoned-order sweep, all through performCancellation.
 *
 * Every function here is best-effort and never throws (see notify.ts).
 */
import { notifyCustomer, rupees } from './notify.js';

// ── Orders ─────────────────────────────────────────────────────────

interface StatusCopy {
  title: string;
  body: (shortId: string) => string;
  iconType: 'truck' | 'check' | 'gift' | 'wallet' | null;
  iconColor: 'green' | 'amber' | 'blue' | 'red' | 'gray';
}

/**
 * One entry per status the order state machine can reach (orders/status.ts
 * TRANSITIONS + 'accepted', which only placeOrder ever sets). A status with no
 * entry raises nothing rather than an empty notification.
 */
const ORDER_STATUS_COPY: Record<string, StatusCopy> = {
  accepted: {
    title: 'Order placed',
    body: (s) => `We've received your order ${s}. We'll keep you posted as it moves.`,
    iconType: 'check',
    iconColor: 'green',
  },
  packing: {
    title: 'Order being packed',
    body: (s) => `Your order ${s} is being packed.`,
    iconType: 'truck',
    iconColor: 'blue',
  },
  packed: {
    title: 'Order packed',
    body: (s) => `Your order ${s} is packed and ready for dispatch.`,
    iconType: 'truck',
    iconColor: 'blue',
  },
  shipped: {
    title: 'Order shipped',
    body: (s) => `Your order ${s} has been shipped and is on its way.`,
    iconType: 'truck',
    iconColor: 'blue',
  },
  out_for_delivery: {
    title: 'Out for delivery',
    body: (s) => `Your order ${s} is out for delivery today.`,
    iconType: 'truck',
    iconColor: 'amber',
  },
  delivered: {
    title: 'Order delivered',
    body: (s) => `Your order ${s} has been delivered. We hope you love it!`,
    iconType: 'check',
    iconColor: 'green',
  },
  cancelled: {
    title: 'Order cancelled',
    body: (s) => `Your order ${s} has been cancelled.`,
    iconType: null,
    iconColor: 'red',
  },
};

export interface OrderStatusNotification {
  customerId: string;
  orderId: string;
  orderShortId?: string | null;
  status: string;
  /** Appended to the body for a cancellation, so the customer sees the reason. */
  note?: string | null;
}

/**
 * "Your order has …". Idempotent per (order, status): the id is derived from
 * both, so a repeated `delivered → delivered` re-entry — which
 * adminChangeOrderStatus accepts by design to re-run commission clearance —
 * cannot notify a second time.
 */
export async function notifyOrderStatus(input: OrderStatusNotification): Promise<void> {
  const copy = ORDER_STATUS_COPY[input.status];
  if (!copy || !input.customerId || !input.orderId) return;
  const shortId = input.orderShortId || input.orderId;
  const reason = (input.note ?? '').trim();
  await notifyCustomer({
    customerId: input.customerId,
    notificationId: `order_${input.orderId}_${input.status}`,
    channel: 'order',
    category: 'order_status',
    title: copy.title,
    body: input.status === 'cancelled' && reason ? `${copy.body(shortId)} ${reason}` : copy.body(shortId),
    iconType: copy.iconType,
    iconColor: copy.iconColor,
    deepLink: { type: 'order', target: input.orderId },
    related: { orderId: input.orderId, orderShortId: input.orderShortId ?? null },
    pushExtra: { orderStatus: input.status },
  });
}

// ── Wallet ─────────────────────────────────────────────────────────

export interface WalletNotification {
  customerId: string;
  /**
   * Stable per movement — the walletTransactions row id wherever one exists, so
   * the notification and the ledger entry share an identity and a replayed
   * callable cannot notify twice.
   */
  eventId: string;
  direction: 'credit' | 'debit';
  amountPaise: number;
  title: string;
  body: string;
  orderId?: string | null;
  orderShortId?: string | null;
}

/** Money in or out of the spendable wallet. Deep-links to the wallet screen. */
export async function notifyWalletMovement(input: WalletNotification): Promise<void> {
  if (!input.customerId || input.amountPaise <= 0) return;
  await notifyCustomer({
    customerId: input.customerId,
    notificationId: `wallet_${input.eventId}`,
    channel: 'wallet',
    category: 'wallet',
    title: input.title,
    body: input.body,
    iconType: 'wallet',
    iconColor: input.direction === 'credit' ? 'green' : 'gray',
    deepLink: { type: 'wallet', target: null },
    related: { orderId: input.orderId ?? null, orderShortId: input.orderShortId ?? null },
    pushExtra: { amountPaise: input.amountPaise, direction: input.direction },
  });
}

/** Refund credited to the wallet — the wallet half of a return/cancellation. */
export async function notifyRefundCredited(input: {
  customerId: string;
  eventId: string;
  amountPaise: number;
  orderId?: string | null;
  orderShortId?: string | null;
  /** 'return' | 'cancellation' — only changes the wording. */
  cause: 'return' | 'cancellation';
}): Promise<void> {
  const where = input.orderShortId ? ` for order ${input.orderShortId}` : '';
  await notifyWalletMovement({
    customerId: input.customerId,
    eventId: input.eventId,
    direction: 'credit',
    amountPaise: input.amountPaise,
    title: 'Refund credited',
    body:
      input.cause === 'return'
        ? `${rupees(input.amountPaise)} has been credited to your wallet${where}.`
        : `${rupees(input.amountPaise)} has been refunded to your wallet${where}.`,
    orderId: input.orderId ?? null,
    orderShortId: input.orderShortId ?? null,
  });
}

// ── Returns / refunds ──────────────────────────────────────────────

export interface ReturnDecisionNotification {
  customerId: string;
  requestId: string;
  decision: 'approved' | 'rejected';
  orderId?: string | null;
  orderShortId?: string | null;
  /** Approved only — what will be refunded (0 when the payout is manual). */
  refundAmountPaise?: number;
  /** Approved only — whether the money has actually landed in the wallet. */
  creditedToWallet?: boolean;
  /** Rejected only — shown verbatim, the admin wrote it for the customer. */
  reason?: string | null;
}

export async function notifyReturnDecision(input: ReturnDecisionNotification): Promise<void> {
  if (!input.customerId || !input.requestId) return;
  const on = input.orderShortId ? ` on order ${input.orderShortId}` : '';
  const amount = Math.max(0, Number(input.refundAmountPaise ?? 0));

  const body =
    input.decision === 'approved'
      ? amount > 0
        ? input.creditedToWallet
          ? `Your return${on} was approved and ${rupees(amount)} has been credited to your wallet.`
          : `Your return${on} was approved. ${rupees(amount)} will be refunded to your original payment method.`
        : `Your return${on} was approved.`
      : `Your return${on} was not approved.${input.reason ? ` ${input.reason}` : ''}`;

  await notifyCustomer({
    customerId: input.customerId,
    notificationId: `request_${input.requestId}_${input.decision}`,
    channel: 'order',
    category: 'order_status',
    title: input.decision === 'approved' ? 'Return approved' : 'Return declined',
    body,
    iconType: input.decision === 'approved' ? 'check' : null,
    iconColor: input.decision === 'approved' ? 'green' : 'red',
    deepLink: input.orderId ? { type: 'order', target: input.orderId } : { type: 'home', target: null },
    related: { orderId: input.orderId ?? null, orderShortId: input.orderShortId ?? null },
    pushExtra: { requestId: input.requestId, refundAmountPaise: amount },
  });
}

// ── Affiliate ──────────────────────────────────────────────────────

/**
 * Commission accrued on a referred order (still pending until that order is
 * delivered) or cleared into the withdrawable balance.
 *
 * Keyed by order id + phase, so re-accruing (which accrueCommission makes a
 * no-op) or re-confirming a delivery cannot notify twice.
 */
export async function notifyCommission(input: {
  affiliateUid: string;
  orderId: string;
  orderShortId?: string | null;
  amountPaise: number;
  phase: 'pending' | 'confirmed';
}): Promise<void> {
  if (!input.affiliateUid || !input.orderId || input.amountPaise <= 0) return;
  const on = input.orderShortId ? ` on order ${input.orderShortId}` : '';
  await notifyCustomer({
    customerId: input.affiliateUid,
    notificationId: `commission_${input.orderId}_${input.phase}`,
    channel: 'affiliate',
    category: 'affiliate',
    title: input.phase === 'pending' ? 'Commission earned' : 'Commission available',
    body:
      input.phase === 'pending'
        ? `You earned ${rupees(input.amountPaise)}${on}. It clears once the order is delivered.`
        : `${rupees(input.amountPaise)}${on} has cleared and is now available to withdraw.`,
    iconType: 'gift',
    iconColor: input.phase === 'pending' ? 'amber' : 'green',
    deepLink: { type: 'affiliate', target: null },
    related: { orderId: input.orderId, orderShortId: input.orderShortId ?? null },
    pushExtra: { amountPaise: input.amountPaise, commissionPhase: input.phase },
  });
}

/** Withdrawal settled or declined by an admin. */
export async function notifyWithdrawalDecision(input: {
  affiliateUid: string;
  requestId: string;
  shortId?: string | null;
  decision: 'paid' | 'rejected';
  amountPaise: number;
  reason?: string | null;
}): Promise<void> {
  if (!input.affiliateUid || !input.requestId) return;
  const ref = input.shortId ? ` (${input.shortId})` : '';
  await notifyCustomer({
    customerId: input.affiliateUid,
    notificationId: `withdrawal_${input.requestId}_${input.decision}`,
    channel: 'affiliate',
    category: 'affiliate',
    title: input.decision === 'paid' ? 'Withdrawal paid' : 'Withdrawal declined',
    body:
      input.decision === 'paid'
        ? `${rupees(input.amountPaise)} has been transferred to your bank account${ref}.`
        : `Your withdrawal request${ref} was declined.${input.reason ? ` ${input.reason}` : ''}`,
    iconType: input.decision === 'paid' ? 'check' : null,
    iconColor: input.decision === 'paid' ? 'green' : 'red',
    deepLink: { type: 'affiliate', target: null },
    related: { withdrawalId: input.requestId },
    pushExtra: { amountPaise: input.amountPaise },
  });
}
