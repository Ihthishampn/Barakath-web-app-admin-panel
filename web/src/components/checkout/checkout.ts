'use client';
/**
 * Shared cart → checkout logic: store settings, price summary, the checkout
 * draft that flows Bag → Checkout → Payment → Success, and the customer-facing
 * Cloud Function wrappers.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { app, auth, db, functions, REGION } from '@/lib/firebase';
import type { CartLine } from '@/lib/cart';
import type {
  SettingsDelivery,
  SettingsPaymentGateway,
  SettingsTax,
  PaymentMethod,
} from '@barkath/shared';

// ── Store settings (settings/delivery + settings/tax singletons) ───────────
export interface StoreSettings {
  delivery: SettingsDelivery | null;
  tax: SettingsTax | null;
  /** Which payment methods the admin has enabled (settings/paymentGateway). */
  gateway: SettingsPaymentGateway | null;
}

export function useStoreSettings(): { settings: StoreSettings; loading: boolean; error: string | null } {
  const [settings, setSettings] = useState<StoreSettings>({ delivery: null, tax: null, gateway: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [d, t, g] = await Promise.all([
          getDoc(doc(db, 'settings', 'delivery')),
          getDoc(doc(db, 'settings', 'tax')),
          getDoc(doc(db, 'settings', 'paymentGateway')),
        ]);
        if (!alive) return;
        setSettings({
          delivery: d.exists() ? (d.data() as SettingsDelivery) : null,
          tax: t.exists() ? (t.data() as SettingsTax) : null,
          gateway: g.exists() ? (g.data() as SettingsPaymentGateway) : null,
        });
      } catch {
        if (alive) setError('Could not load delivery pricing right now.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { settings, loading, error };
}

// ── Coupon + price summary ─────────────────────────────────────────────────
export interface AppliedCoupon {
  code: string;
  discountPaise: number;
  label: string;
  /** free_shipping coupons discount nothing but waive delivery (see summarise). */
  waiveDelivery?: boolean;
}

export interface Summary {
  subtotalPaise: number;
  discountPaise: number;
  deliveryPaise: number;
  taxPaise: number;
  /** Grand total before any wallet is applied. */
  totalPaise: number;
  walletUsedPaise: number;
  /** What the customer actually pays now (total − wallet). */
  payablePaise: number;
  freeDelivery: boolean;
}

export function computeSummary(
  subtotalPaise: number,
  settings: StoreSettings,
  opts: {
    coupon?: AppliedCoupon | null;
    /** Pass the wallet balance only when the wallet toggle is ON. */
    walletBalancePaise?: number | null;
  } = {},
): Summary {
  const { delivery, tax } = settings;

  const discountPaise = Math.min(opts.coupon?.discountPaise ?? 0, subtotalPaise);
  const net = Math.max(0, subtotalPaise - discountPaise);

  const threshold = delivery?.freeDeliveryOverPaise ?? 0;
  // Mirrors summarise() in functions/src/orders/checkout.ts exactly — the
  // waiveDelivery term was missing here, so any free-delivery coupon made the
  // displayed total higher than what the server actually charged.
  const freeDelivery =
    !!opts.coupon?.waiveDelivery || subtotalPaise <= 0 || (threshold > 0 && net >= threshold);
  const deliveryPaise = freeDelivery ? 0 : delivery?.standardFeePaise ?? 0;

  let taxPaise = 0;
  if (tax?.gstEnabled && !tax.pricesIncludeTax) {
    taxPaise = Math.round(net * (tax.gstRate ?? 0));
  }

  const totalPaise = net + deliveryPaise + taxPaise;

  const walletUsedPaise =
    opts.walletBalancePaise && opts.walletBalancePaise > 0
      ? Math.min(opts.walletBalancePaise, totalPaise)
      : 0;
  const payablePaise = Math.max(0, totalPaise - walletUsedPaise);

  return {
    subtotalPaise,
    discountPaise,
    deliveryPaise,
    taxPaise,
    totalPaise,
    walletUsedPaise,
    payablePaise,
    freeDelivery,
  };
}

// ── Checkout draft (persists selections across Checkout → Payment → Success) ─
export interface PlacedOrder {
  shortId: string;
  amountPaise: number;
  arrivesBy: string | null;
}

/**
 * No `paymentMethod` here on purpose: with cash on delivery withdrawn there is
 * nothing to choose. The method is DERIVED at placement from what is left to
 * pay ('wallet' when the balance covers the whole order, 'razorpay' otherwise),
 * so a stale stored choice can never disagree with the summary on screen.
 */
interface CheckoutDraft {
  addressId: string | null;
  useWallet: boolean;
  coupon: AppliedCoupon | null;
  placed: PlacedOrder | null;
  set: (patch: Partial<Omit<CheckoutDraft, 'set' | 'reset'>>) => void;
  reset: () => void;
}

export const useCheckoutDraft = create<CheckoutDraft>((set) => ({
  addressId: null,
  useWallet: false,
  coupon: null,
  placed: null,
  set: (patch) => set(patch),
  reset: () => set({ addressId: null, useWallet: false, coupon: null, placed: null }),
}));

// ── Cloud Function wrappers (deployed: applyCoupon / placeOrder /
//    createRazorpayOrder / verifyPayment — asia-south1) ─────────────────────
type LinePayload = { productId: string; variantId: string | null; qty: number };

const toPayload = (lines: CartLine[]): LinePayload[] =>
  lines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty }));

/** settings/tax + settings/delivery drive the authoritative total server-side. */
export async function callApplyCoupon(
  code: string,
  lines: CartLine[],
): Promise<{ discountPaise: number; label: string; waiveDelivery?: boolean }> {
  const fn = httpsCallable<
    { code: string; lines: LinePayload[] },
    { discountPaise: number; label: string; waiveDelivery?: boolean }
  >(functions, 'applyCoupon');
  const res = await fn({ code, lines: toPayload(lines) });
  return res.data;
}

/**
 * The only two methods placeOrder still accepts — it throws failed-precondition
 * for 'cod'. 'wallet' additionally requires the balance to cover the WHOLE
 * order ("Your wallet balance does not cover this order."); a partial offset is
 * 'razorpay' + useWallet.
 */
export type CheckoutPaymentMethod = Extract<PaymentMethod, 'razorpay' | 'wallet'>;

/** Create the order atomically (stock↓, wallet↓, shortId). A razorpay order is
 *  'pending' until verifyPayment; a 'wallet' one has nothing left to collect and
 *  is captured outright. */
export async function callPlaceOrder(args: {
  lines: CartLine[];
  addressId: string;
  paymentMethod: CheckoutPaymentMethod;
  couponCode: string | null;
  /**
   * True when the customer deliberately has NO coupon (e.g. they removed the
   * auto-applied one). Server-side, `couponCode: null` alone means "pick the
   * best offer for me", so without this a removed coupon was re-applied and a
   * one-time spin reward silently burnt.
   */
  noCoupon?: boolean;
  useWallet?: boolean;
  /** Stable per-attempt key so a retry can't place a second order. */
  placementNonce: string;
  /**
   * Reservation taken by reserveStock when the customer entered checkout. When
   * it is still 'active' the server SKIPS the stock decrement (the stock is
   * already held) and marks it consumed; anything else falls back to the
   * normal validate-and-decrement path. Never send a consumed/expired id.
   */
  reservationId?: string | null;
}): Promise<{ orderId: string; shortId: string; amountPaise: number; paymentMethod: PaymentMethod }> {
  const fn = httpsCallable<
    {
      lines: LinePayload[];
      addressId: string;
      paymentMethod: CheckoutPaymentMethod;
      couponCode: string | null;
      noCoupon: boolean;
      useWallet: boolean;
      placementNonce: string;
      reservationId: string | null;
    },
    { orderId: string; shortId: string; amountPaise: number; paymentMethod: PaymentMethod }
  >(functions, 'placeOrder');
  const res = await fn({
    lines: toPayload(args.lines),
    addressId: args.addressId,
    paymentMethod: args.paymentMethod,
    couponCode: args.couponCode,
    noCoupon: !!args.noCoupon,
    useWallet: !!args.useWallet,
    placementNonce: args.placementNonce,
    reservationId: args.reservationId ?? null,
  });
  return res.data;
}

// ── Stock reservation (stockReservations/{id}, CF-only write) ───────────────
/**
 * Hold the cart's stock for 15 minutes while the customer checks out. The
 * server decrements product stock immediately and releases any earlier active
 * reservation of the same customer first, so re-entering checkout never leaks
 * stock. Throws failed-precondition '<name> is out of stock.' when a line
 * cannot be met.
 */
export async function callReserveStock(
  lines: CartLine[],
): Promise<{ reservationId: string; expiresAtMillis: number }> {
  const fn = httpsCallable<{ lines: LinePayload[] }, { reservationId: string; expiresAtMillis: number }>(
    functions,
    'reserveStock',
  );
  const res = await fn({ lines: toPayload(lines) });
  // Cache a fresh ID token so the pagehide beacon below can authenticate
  // without awaiting anything while the page is being torn down.
  void auth.currentUser
    ?.getIdToken()
    .then((t) => {
      cachedIdToken = t;
    })
    .catch(() => {});
  return res.data;
}

/** Idempotent: restores the stock of an 'active' reservation. Any other status is a no-op. */
export async function callReleaseStock(reservationId: string): Promise<{ ok: true }> {
  const fn = httpsCallable<{ reservationId: string }, { ok: true }>(functions, 'releaseStock');
  const res = await fn({ reservationId });
  return res.data;
}

let cachedIdToken: string | null = null;

/** Callable endpoint URL — used only by the unload beacon below. */
function callableUrl(name: string): string {
  const projectId = app.options.projectId ?? '';
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') {
    const host = process.env.NEXT_PUBLIC_EMU_HOST ?? '127.0.0.1';
    return `http://${host}:5001/${projectId}/${REGION}/${name}`;
  }
  return `https://${REGION}-${projectId}.cloudfunctions.net/${name}`;
}

/**
 * Best-effort release from a pagehide/unload handler. The callable SDK's fetch
 * is cancelled when the document goes away, so post the callable envelope
 * directly with `keepalive` (sendBeacon can't carry the Authorization header).
 * Falls back to the normal callable, and — if even that is lost — the
 * stockReservationSweep expires the reservation within 15 minutes.
 */
export function releaseStockBeacon(reservationId: string): void {
  if (typeof window === 'undefined') return;
  const body = JSON.stringify({ data: { reservationId } });
  if (cachedIdToken) {
    try {
      void fetch(callableUrl('releaseStock'), {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cachedIdToken}` },
        body,
      }).catch(() => {});
      return;
    } catch {
      /* fall through to the callable */
    }
  }
  void callReleaseStock(reservationId).catch(() => {});
}

/**
 * Record a failed payment attempt on an order the caller owns. The order and
 * its stock survive — paymentStatus becomes 'failed' so the customer can retry
 * from My orders. Idempotent; a no-op once the payment is captured.
 */
export async function callMarkPaymentFailed(orderId: string, reason?: string | null): Promise<{ ok: true }> {
  const fn = httpsCallable<{ orderId: string; reason: string | null }, { ok: true }>(
    functions,
    'markPaymentFailed',
  );
  const res = await fn({ orderId, reason: reason ?? null });
  return res.data;
}

export async function callCreateRazorpayOrder(orderId: string): Promise<{ razorpayOrderId: string; amountPaise: number; keyId: string }> {
  const fn = httpsCallable<{ orderId: string }, { razorpayOrderId: string; amountPaise: number; keyId: string }>(
    functions,
    'createRazorpayOrder',
  );
  const res = await fn({ orderId });
  return res.data;
}

export async function callVerifyPayment(args: {
  orderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<{ verified: boolean }> {
  const fn = httpsCallable<typeof args, { verified: boolean }>(functions, 'verifyPayment');
  const res = await fn(args);
  return res.data;
}

// ── Razorpay Checkout widget loader ─────────────────────────────────────────
interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

/** Lazy-load the Razorpay checkout.js script once. */
function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false);
    if ((window as unknown as { Razorpay?: unknown }).Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

interface RazorpayFailure {
  error?: { description?: string; reason?: string; code?: string };
}

/**
 * Open the Razorpay modal; resolves with the payment result, or null if the
 * modal closed without a successful payment.
 *
 * `onFailed` fires for every gateway-reported failure (payment.failed). The
 * promise deliberately stays pending then — Razorpay keeps the modal open so
 * the customer can retry another method — so a caller uses the last reported
 * reason only when the final result is null, i.e. they gave up.
 */
export async function openRazorpayCheckout(opts: {
  keyId: string;
  razorpayOrderId: string;
  amountPaise: number;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string; contact?: string };
  onFailed?: (reason: string) => void;
}): Promise<RazorpayResponse | null> {
  const ok = await loadRazorpayScript();
  if (!ok) throw new Error('razorpay-script-failed');
  return new Promise((resolve) => {
    const Rzp = (
      window as unknown as {
        Razorpay: new (o: unknown) => {
          open: () => void;
          on?: (event: string, cb: (e: RazorpayFailure) => void) => void;
        };
      }
    ).Razorpay;
    const rzp = new Rzp({
      key: opts.keyId,
      order_id: opts.razorpayOrderId,
      amount: opts.amountPaise,
      currency: 'INR',
      name: opts.name,
      description: opts.description,
      prefill: opts.prefill ?? {},
      theme: { color: '#0f7a5a' },
      handler: (r: RazorpayResponse) => resolve(r),
      modal: { ondismiss: () => resolve(null) },
    });
    if (opts.onFailed) {
      try {
        rzp.on?.('payment.failed', (e) => {
          const err = e?.error;
          opts.onFailed?.(err?.description || err?.reason || err?.code || 'Payment failed at the gateway.');
        });
      } catch {
        /* older widget builds have no .on — the dismiss path still reports */
      }
    }
    rzp.open();
  });
}

// ── Pay for an already-placed order (checkout + retry from My orders) ──────
/**
 * How a payment attempt ended. `cancelled` is the customer closing the sheet;
 * `failed` is something that went wrong on our side or the gateway's.
 */
export type PayOutcome =
  | { status: 'paid' }
  | { status: 'cancelled'; reason: string | null }
  | { status: 'failed'; stage: 'create' | 'open' | 'verify' | 'signature'; reason: string };

/**
 * Take payment for an order that already exists: open its Razorpay order (the
 * server reuses the one already minted, so a retry can never collect twice),
 * run the checkout sheet, then verify the signature server-side.
 *
 * Every unsuccessful path records the attempt with `markPaymentFailed`, so the
 * order stays standing (stock held) and stays payable. The whole thing is
 * shared by the checkout page and the "Pay now" retry on order detail — there
 * is exactly one implementation of this sequence.
 */
export async function payForOrder(args: {
  orderId: string;
  shortId: string;
  prefill?: { name?: string; email?: string; contact?: string };
}): Promise<PayOutcome> {
  /** Best effort — the order stays payable whether or not this lands. */
  const report = async (reason: string) => {
    try {
      await callMarkPaymentFailed(args.orderId, reason);
    } catch {
      /* nothing more we can do from the client */
    }
  };

  let rzp: Awaited<ReturnType<typeof callCreateRazorpayOrder>>;
  try {
    rzp = await callCreateRazorpayOrder(args.orderId);
  } catch (e) {
    const reason = payErrMessage(e, 'Could not start the payment.');
    await report(reason);
    return { status: 'failed', stage: 'create', reason };
  }

  // Razorpay keeps its modal open after a declined payment so the customer can
  // retry, so remember the last reported reason and use it only if they end up
  // closing without paying.
  const gateway = { failure: null as string | null };
  let pay: Awaited<ReturnType<typeof openRazorpayCheckout>>;
  try {
    pay = await openRazorpayCheckout({
      keyId: rzp.keyId,
      razorpayOrderId: rzp.razorpayOrderId,
      amountPaise: rzp.amountPaise,
      name: 'Barakath',
      description: `Order ${args.shortId}`,
      prefill: args.prefill ?? {},
      onFailed: (reason) => {
        gateway.failure = reason;
      },
    });
  } catch (e) {
    const reason = payErrMessage(e, 'Payment window could not be opened.');
    await report(reason);
    return { status: 'failed', stage: 'open', reason };
  }

  if (!pay) {
    const failure = gateway.failure;
    await report(failure ?? 'Cancelled by customer.');
    return { status: 'cancelled', reason: failure };
  }

  try {
    const v = await callVerifyPayment({
      orderId: args.orderId,
      razorpayOrderId: pay.razorpay_order_id,
      razorpayPaymentId: pay.razorpay_payment_id,
      razorpaySignature: pay.razorpay_signature,
    });
    if (!v.verified) {
      const reason = 'Payment signature could not be verified.';
      await report(reason);
      return { status: 'failed', stage: 'signature', reason };
    }
  } catch (e) {
    // The money may well have left — say so honestly and let the server
    // reconcile; markPaymentFailed is a no-op once it is captured.
    const reason = payErrMessage(e, 'Payment verification failed.');
    await report(reason);
    return { status: 'failed', stage: 'verify', reason };
  }

  return { status: 'paid' };
}

/** Surface a Cloud Function's own error message when it has one. */
function payErrMessage(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message;
  return m && !m.startsWith('INTERNAL') ? m : fallback;
}

/**
 * The one place the copy for a failed/cancelled payment lives, so checkout and
 * the retry on order detail always say the same thing. `tone` maps to the
 * sonner call the caller should make.
 */
export function payOutcomeMessage(
  outcome: Exclude<PayOutcome, { status: 'paid' }>,
): { tone: 'error' | 'message'; text: string } {
  if (outcome.status === 'cancelled') {
    return outcome.reason
      ? { tone: 'error', text: `${outcome.reason} — your order is saved and payable from My orders.` }
      : { tone: 'message', text: 'Payment cancelled — your order is saved as pending under My orders.' };
  }
  switch (outcome.stage) {
    case 'create':
      return { tone: 'error', text: 'We could not start that payment — your order is saved and payable from My orders.' };
    case 'open':
      return { tone: 'error', text: 'We could not open the payment window — your order is saved and payable from My orders.' };
    case 'verify':
      return { tone: 'error', text: 'We could not verify that payment. Please check My orders before trying again.' };
    default:
      return { tone: 'error', text: 'We could not verify that payment. Please try again from My orders.' };
  }
}

/** "Arrives by" copy from delivery day range, e.g. "Tue, 22 Jul". */
export function estimateArrival(delivery: SettingsDelivery | null): string {
  const days = delivery?.deliveryDaysMax ?? delivery?.deliveryDaysMin ?? 4;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
