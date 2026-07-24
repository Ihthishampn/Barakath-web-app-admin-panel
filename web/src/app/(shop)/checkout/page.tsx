'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  RiBankCardLine,
  RiMapPinLine,
  RiShieldCheckLine,
  RiWalletLine,
} from '@remixicon/react';
import { formatMoney2dp, type CustomerAddress } from '@barkath/shared';
import { orderLimitError, useCart } from '@/lib/cart';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { OrderSummary } from '@/components/checkout/OrderSummary';
import {
  CouponRewardBanner,
  refreshCartPricesOnce,
} from '@/components/checkout/CouponRewardBanner';
import type { CheckoutPaymentMethod } from '@/components/checkout/checkout';
import {
  callPlaceOrder,
  callReserveStock,
  callReleaseStock,
  releaseStockBeacon,
  payForOrder,
  payOutcomeMessage,
  computeSummary,
  useCheckoutDraft,
  useStoreSettings,
} from '@/components/checkout/checkout';

/** Surface the Cloud Function's own error message when present. */
function errMessage(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message;
  return m && !m.startsWith('INTERNAL') ? m : fallback;
}

export default function CheckoutPage() {
  const router = useRouter();
  const { customer, ready } = useAuth();

  const lines = useCart((s) => s.lines);
  const subtotalPaise = useCart((s) => s.subtotalPaise());
  const clear = useCart((s) => s.clear);
  const hydrate = useCart((s) => s.hydrate);

  const { settings } = useStoreSettings();
  const draft = useCheckoutDraft();

  const [mounted, setMounted] = useState(false);
  const [placing, setPlacing] = useState(false);
  const nonceRef = useRef<string | null>(null);

  // ── Stock reservation held for this checkout ─────────────────────────────
  const reservationRef = useRef<{ id: string; expiresAtMillis: number } | null>(null);
  /** Bumped per reserve attempt so only the newest one may claim the ref. */
  const reserveSeqRef = useRef(0);
  /** Guards against re-reserving on every cart/price re-render. */
  const reserveStartedRef = useRef(false);
  /** Once placeOrder succeeds the reservation is consumed — never release it. */
  const orderPlacedRef = useRef(false);

  useEffect(() => {
    hydrate();
    setMounted(true);
    // Cart lines cache the price from when they were added; placeOrder prices
    // from the product doc. Re-read them so the summary and the "Place order"
    // amount match what the server will actually charge. It also refreshes each
    // line's categorySlug, which the offer selection is scored on — the shared
    // coupon component gates its auto-apply on the very same refresh settling
    // (both go through refreshCartPricesOnce, so the reads happen once).
    void refreshCartPricesOnce();
  }, [hydrate]);

  // Hold the stock for this cart the moment checkout opens, so a slow customer
  // cannot lose items to someone else mid-payment. The server releases any
  // earlier active reservation of ours first, and expires this one after 15
  // minutes (stockReservationSweep) if we never come back.
  const linesCount = lines.length;
  useEffect(() => {
    if (!mounted || !ready || !customer || linesCount === 0) return;
    if (reserveStartedRef.current || orderPlacedRef.current) return;
    reserveStartedRef.current = true;
    const seq = ++reserveSeqRef.current;
    (async () => {
      try {
        // Read the freshest cart — refreshPrices()/hydrate() may have re-set it.
        const res = await callReserveStock(useCart.getState().lines);
        if (seq !== reserveSeqRef.current) {
          // A newer reservation superseded this one (the server already
          // released it when it created that one) — releasing again is a no-op.
          void callReleaseStock(res.reservationId).catch(() => {});
          return;
        }
        reservationRef.current = { id: res.reservationId, expiresAtMillis: res.expiresAtMillis };
      } catch (e) {
        if (seq !== reserveSeqRef.current) return;
        const code = (e as { code?: string })?.code ?? '';
        if (code === 'functions/failed-precondition') {
          // Genuinely out of stock — don't strand the customer on a checkout
          // they can't complete; send them back to the bag with the server's
          // own message.
          toast.error(errMessage(e, 'Some items in your bag just went out of stock.'));
          router.replace('/bag');
          return;
        }
        // Anything else (offline, timeout, reserveStock not deployed) must not
        // block checkout: placeOrder still validates and decrements stock
        // itself when no reservation is passed.
        reserveStartedRef.current = false;
      }
    })();
  }, [mounted, ready, customer, linesCount, router]);

  // Release on the way out: SPA unmount…
  useEffect(
    () => () => {
      const held = reservationRef.current;
      reservationRef.current = null;
      reserveSeqRef.current += 1; // invalidate any in-flight reserve
      reserveStartedRef.current = false; // a remount reserves afresh
      if (held && !orderPlacedRef.current) void callReleaseStock(held.id).catch(() => {});
    },
    [],
  );

  // …and a full page unload / tab close (best effort, keepalive request).
  useEffect(() => {
    const onHide = () => {
      const held = reservationRef.current;
      if (!held || orderPlacedRef.current) return;
      reservationRef.current = null;
      releaseStockBeacon(held.id);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  const addresses = useMemo<CustomerAddress[]>(() => customer?.addresses ?? [], [customer]);

  // Preselect default (or first) address once we know the customer.
  //
  // Re-selected whenever the stored id no longer names a saved address, not
  // just when there is none: the draft outlives a trip to /account/addresses,
  // so deleting the address that was selected (or signing in as someone else)
  // left `addressId` pointing at nothing — every row unselected, "Place order"
  // permanently disabled and "Add a delivery address to continue" shown under a
  // list of perfectly good addresses.
  useEffect(() => {
    if (addresses.length === 0) return;
    if (addresses.some((a) => a.id === draft.addressId)) return;
    const def = addresses.find((a) => a.isDefault) ?? addresses[0];
    draft.set({ addressId: def!.id });
  }, [addresses, draft]);

  // The coupon/offer surface — including the auto-apply of the best offer, the
  // live re-pricing of an applied one and the full offer list — lives in
  // <CouponRewardBanner/>, shared verbatim with the Bag (see its file header).

  const walletBalance = customer?.wallet?.balancePaise ?? 0;

  // Payment availability is admin-controlled (Settings ▸ Payment gateway).
  // A missing settings doc means "everything on", so an unconfigured install
  // still checks out.
  const gateway = settings.gateway;
  const onlineEnabled = gateway?.onlinePaymentEnabled ?? true;
  // An empty wallet is as good as a disabled one: toggling it on applies ₹0,
  // so the row was a control that visibly did nothing. Matches the app
  // (checkout_screen.dart: `s.walletEnabled && walletBalance > 0`).
  const walletEnabled = (gateway?.walletEnabled ?? true) && walletBalance > 0;

  // The wallet can also go away underneath us — the admin switching it off, or
  // the balance being spent by an order placed in the app — so an already-on
  // toggle is dropped rather than left applying a balance that isn't there.
  useEffect(() => {
    if (draft.useWallet && !walletEnabled) draft.set({ useWallet: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletEnabled, draft.useWallet]);
  const summary = useMemo(
    () =>
      computeSummary(subtotalPaise, settings, {
        coupon: draft.coupon,
        walletBalancePaise: draft.useWallet ? walletBalance : null,
      }),
    [subtotalPaise, settings, draft.coupon, draft.useWallet, walletBalance],
  );

  // Nothing left to collect (wallet covers it all, or a 100% discount): there is
  // no gateway step, so its availability stops mattering.
  const nothingToPay = summary.payablePaise === 0;
  const fullyWalletPaid = nothingToPay && summary.walletUsedPaise > 0;

  /**
   * The method is derived, never chosen. placeOrder only accepts 'wallet' when
   * the balance covers the WHOLE order (it throws otherwise), and treats
   * 'razorpay' + useWallet as a partial offset — so mirror exactly what the
   * summary above says is left to pay.
   */
  const paymentMethod: CheckoutPaymentMethod = nothingToPay ? 'wallet' : 'razorpay';

  const selectedAddress = addresses.find((a) => a.id === draft.addressId) ?? null;

  async function placeOrder() {
    if (!selectedAddress || placing) return;
    // Order caps, mirrored from the server (see src/lib/cart.ts). Checked on the
    // live cart and the live total right before the call — a bag shared with the
    // app can cross a cap while this page is open, and the prices are re-read on
    // mount. The server stays authoritative; this just refuses in one toast
    // instead of one placeOrder round-trip.
    const limit = orderLimitError(lines, summary.totalPaise);
    if (limit) {
      toast.error(limit);
      return;
    }
    // One nonce per checkout attempt: a network retry reuses it (so the server
    // returns the original order instead of placing a second one), and it is
    // cleared on success so the next genuine order gets a fresh key.
    if (!nonceRef.current) nonceRef.current = crypto.randomUUID();
    setPlacing(true);
    try {
      // 1) Create the order server-side (wallet↓, shortId). The stock is
      //    already held by our reservation, so the server consumes it instead
      //    of decrementing a second time; an expired one is not worth sending
      //    (the server would fall back anyway) — let it validate afresh.
      const held = reservationRef.current;
      const reservationId = held && held.expiresAtMillis > Date.now() ? held.id : null;
      const res = await callPlaceOrder({
        lines,
        addressId: selectedAddress.id,
        paymentMethod,
        couponCode: draft.coupon?.code ?? null,
        // This page picks (and auto-applies) the best offer itself, so "no
        // coupon in the draft" is a deliberate choice — tell the server so, or
        // it auto-applies one the summary above never showed.
        noCoupon: !draft.coupon,
        useWallet: draft.useWallet,
        placementNonce: nonceRef.current,
        reservationId,
      });
      // The order exists now and the reservation is consumed with it: never
      // release it, and never send its id again (a retry replays the nonce).
      orderPlacedRef.current = true;
      reservationRef.current = null;

      // 2) Online payment → open Razorpay for the placed order, then verify.
      //    Every failure below leaves the order standing (stock stays held) and
      //    is recorded with markPaymentFailed so it can be paid from My orders.
      // A 'wallet' order is already captured server-side — there is nothing to
      // hand to the gateway, so skip straight to success.
      if (paymentMethod === 'razorpay' && res.amountPaise > 0) {
        // The gateway sequence (open → pay → verify, recording every failure)
        // is shared verbatim with the "Pay now" retry on order detail.
        const outcome = await payForOrder({
          orderId: res.orderId,
          shortId: res.shortId,
          prefill: { name: customer?.name, email: customer?.email ?? undefined, contact: customer?.phone },
        });
        if (outcome.status !== 'paid') {
          const { tone, text } = payOutcomeMessage(outcome);
          if (tone === 'error') toast.error(text);
          else toast.message(text);
          return;
        }
      }

      // 3) Done. Retire the nonce only now: clearing it right after placeOrder
      // meant a cancelled or failed Razorpay payment followed by a retry got a
      // fresh key, and the server — seeing no replay — placed a SECOND order.
      nonceRef.current = null;
      draft.set({ placed: { shortId: res.shortId, amountPaise: res.amountPaise, arrivesBy: null } });
      clear();
      router.push('/checkout/success');
    } catch (e) {
      toast.error(errMessage(e, 'Something went wrong placing your order. Please try again.'));
    } finally {
      setPlacing(false);
    }
  }

  if (!mounted || !ready) return <CheckoutSkeleton />;

  // Auth gate.
  if (!customer) {
    return (
      <div className="mx-auto flex max-w-page flex-col items-center px-4 py-24 text-center sm:px-10">
        <div className="grid h-20 w-20 place-items-center rounded-full bg-brand-primary-subtle text-brand-primary">
          <RiShieldCheckLine size={36} />
        </div>
        <h1 className="mt-6 font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Sign in to check out</h1>
        <p className="mt-2 max-w-sm font-ui text-[15px] text-text-secondary">
          Your bag is saved. Sign in to pick a delivery address and place your order securely.
        </p>
        <Link href="/signin" className="mt-7">
          <Button theme="primary" size="l">Sign in to continue</Button>
        </Link>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="mx-auto flex max-w-page flex-col items-center px-4 py-24 text-center sm:px-10">
        <h1 className="font-display text-2xl font-extrabold text-text-primary">Nothing to check out</h1>
        <p className="mt-2 font-ui text-[15px] text-text-secondary">Your bag is empty.</p>
        <Link href="/listing" className="mt-7">
          <Button theme="gold" size="l">Start shopping</Button>
        </Link>
      </div>
    );
  }

  const ctaLabel = nothingToPay
    ? 'Place order'
    : `Place order · ${formatMoney2dp(summary.payablePaise)}`;

  return (
    <div className="mx-auto max-w-page px-4 pb-16 pt-7 sm:px-10">
      {/* Breadcrumb */}
      <div className="mb-2 flex items-center gap-1.5 font-ui text-[13px] font-medium text-text-tertiary">
        <Link href="/bag" className="hover:text-text-primary">Bag</Link>
        <span>·</span>
        <span className="font-bold text-text-primary">Checkout</span>
        <span>·</span>
        <span>Payment</span>
      </div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[28px] font-extrabold tracking-[-0.02em] text-text-primary">Checkout</h1>
        <span className="flex items-center gap-1.5 font-ui text-[13px] font-bold text-text-tertiary">
          <RiShieldCheckLine size={16} className="text-success" /> Secure checkout
        </span>
      </div>

      <div className="mt-6 flex flex-col items-start gap-8 lg:flex-row">
        <div className="flex w-full flex-1 flex-col gap-5">
          {/* Delivery address */}
          <section className="rounded-2xl border border-border-subtle bg-surface-card p-[22px]">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display text-base font-extrabold text-text-primary">Delivery address</span>
              {addresses.length > 0 && (
                <Link href="/account/addresses" className="font-ui text-[13px] font-bold text-brand-primary hover:underline">
                  Change
                </Link>
              )}
            </div>
            {addresses.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border-default bg-surface-app p-4">
                <p className="font-ui text-sm text-text-secondary">You don&apos;t have a saved address yet.</p>
                <Link href="/account/addresses">
                  <Button theme="primary" size="s" outline>Add a delivery address</Button>
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {addresses.map((a) => (
                  <AddressOption
                    key={a.id}
                    address={a}
                    selected={a.id === draft.addressId}
                    onSelect={() => draft.set({ addressId: a.id })}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Coupons & offers — the SAME component the bag renders, so the two
              screens (and the app's two screens) show one treatment. */}
          {/* A referral code is now collected once, at sign-up (see
              app/(auth)/register) — never per order. */}
          <CouponRewardBanner />

          {/* Payment method */}
          <section className="rounded-2xl border border-border-subtle bg-surface-card p-[22px]">
            <div className="mb-4 font-display text-base font-extrabold text-text-primary">Payment method</div>
            {nothingToPay ? (
              // Placed as a 'wallet' order — captured outright, no gateway step.
              <div className="flex items-center gap-3 rounded-xl border border-brand-primary/35 bg-brand-primary-subtle px-4 py-3.5">
                <RiWalletLine size={20} className="text-brand-primary" />
                <div>
                  <div className="font-ui text-[13px] font-bold text-text-primary">
                    {fullyWalletPaid ? 'Paid fully from wallet' : 'Nothing to pay'}
                  </div>
                  <div className="mt-0.5 font-ui text-xs font-medium text-text-secondary">
                    Nothing left to pay.
                  </div>
                </div>
              </div>
            ) : onlineEnabled ? (
              // Online payment is the only method left, so this states what will
              // happen rather than offering a one-option radio group to pick it.
              <div className="flex items-center gap-3 rounded-xl border border-brand-primary/35 bg-brand-primary-subtle px-4 py-3.5">
                <RiBankCardLine size={20} className="text-brand-primary" />
                <div>
                  <div className="font-ui text-[13px] font-bold text-text-primary">
                    Razorpay · UPI / Card / Netbanking
                  </div>
                  <div className="mt-0.5 font-ui text-xs font-medium text-text-secondary">
                    Pay securely online when you place the order.
                  </div>
                </div>
              </div>
            ) : (
              <p className="font-ui text-[13px] font-semibold text-error">
                No payment method is available right now. Please try again later.
              </p>
            )}

            {/* Wallet toggle */}
            {walletEnabled && (
            <button
              type="button"
              onClick={() => draft.set({ useWallet: !draft.useWallet })}
              className="mt-4 flex w-full items-center gap-3 rounded-xl border border-border-subtle px-4 py-3.5 text-left"
            >
              <RiWalletLine size={20} className="text-brand-primary" />
              <div className="flex-1">
                <div className="font-ui text-[13px] font-bold text-text-primary">Use Barakath Wallet</div>
                <div className="mt-0.5 font-ui text-xs font-medium text-text-tertiary">
                  Balance {formatMoney2dp(walletBalance)}
                  {draft.useWallet && summary.walletUsedPaise > 0 && ` · applied ${formatMoney2dp(summary.walletUsedPaise)}`}
                </div>
              </div>
              <span
                className={cn(
                  'relative h-[26px] w-11 rounded-pill transition-colors',
                  draft.useWallet ? 'bg-brand-primary' : 'bg-neutral-300',
                )}
              >
                <span
                  className={cn(
                    'absolute top-[3px] h-5 w-5 rounded-full bg-white transition-all',
                    draft.useWallet ? 'right-[3px]' : 'left-[3px]',
                  )}
                />
              </span>
            </button>
            )}
          </section>
        </div>

        {/* Summary */}
        <div className="w-full lg:w-[360px] lg:flex-none">
          <OrderSummary title="Order summary" summary={summary} totalLabel="To pay" couponLabel={draft.coupon?.code ?? 'Coupon'}>
            <Button
              theme="gold"
              size="l"
              block
              onClick={placeOrder}
              // Nothing can be collected without the gateway — unless there is
              // nothing left to collect, which needs no gateway at all.
              disabled={placing || !selectedAddress || (!onlineEnabled && !nothingToPay)}
            >
              {placing ? 'Placing order…' : ctaLabel}
            </Button>
            {!selectedAddress && (
              <p className="mt-2 text-center font-ui text-xs font-medium text-text-tertiary">Add a delivery address to continue.</p>
            )}
          </OrderSummary>
        </div>
      </div>
    </div>
  );
}

function AddressOption({
  address,
  selected,
  onSelect,
}: {
  address: CustomerAddress;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors',
        selected ? 'border-2 border-brand-primary bg-brand-primary-subtle' : 'border border-border-subtle hover:border-border-default',
      )}
    >
      <RiMapPinLine size={20} className="mt-0.5 flex-none text-brand-primary" />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-ui text-sm font-bold text-text-primary">{address.label || address.name}</span>
          {address.isDefault && (
            <span className="rounded-pill bg-brand-primary-subtle px-2 py-0.5 font-ui text-[10px] font-extrabold uppercase tracking-wide text-brand-primary">
              Default
            </span>
          )}
        </div>
        <div className="mt-1 font-ui text-[13px] leading-relaxed text-text-secondary">
          {[address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(', ')}
          {address.phone && ` · ${address.phone}`}
        </div>
      </div>
    </button>
  );
}

function CheckoutSkeleton() {
  return (
    <div className="mx-auto max-w-page px-4 py-10 sm:px-10">
      <div className="h-8 w-40 animate-pulse rounded bg-neutral-200" />
      <div className="mt-6 flex flex-col gap-8 lg:flex-row">
        <div className="flex-1 space-y-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-neutral-200" />
          ))}
        </div>
        <div className="h-64 w-full animate-pulse rounded-2xl bg-neutral-200 lg:w-[360px]" />
      </div>
    </div>
  );
}
