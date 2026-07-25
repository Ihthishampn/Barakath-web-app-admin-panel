'use client';
/**
 * Coupons & offers — the web twin of the Flutter app's
 * `app/lib/features/checkout/widgets/coupon_apply.dart` (`CouponRewardBanner` +
 * `CouponRow`, plus the offer list from its coupon screen), rendered on BOTH the
 * Bag and the Checkout exactly as the app renders its widget on both screens, so
 * the two surfaces can never drift apart again.
 *
 * What it surfaces, in the app's order:
 *  1. the gold reward banner for the best qualifying spin reward / coupon when
 *     none is applied, with a one-tap Apply;
 *  2. the applied-coupon chip (code · label · −discount · remove);
 *  3. manual code entry — the app opens a coupon screen for this;
 *  4. every redeemable offer for the current bag, split into the app's two
 *     groups (spin rewards, then promotional coupons), including the ones that
 *     need a bigger bag, which show what is still missing.
 *
 * While a coupon IS applied the offer streams stay alive (the hooks below always
 * run) so the applied discount is re-priced against the LIVE bag: the stored
 * discount is a snapshot taken when Apply was tapped, and editing quantities
 * afterwards would otherwise leave a stale — or no longer valid — discount on
 * screen while `placeOrder` re-derives it from the real cart.
 *
 * Renders nothing for a signed-out visitor, mirroring the app's `uid == null`
 * short-circuit: their offers live under `customers/{uid}` and cannot be read.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { collection, onSnapshot, query, where, type Query } from 'firebase/firestore';
import { toast } from 'sonner';
import { RiArrowDownSLine, RiCheckLine, RiCloseLine, RiGiftLine } from '@remixicon/react';
import { formatMoney2dp, type UserCoupon } from '@barkath/shared';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { db } from '@/lib/firebase';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { callApplyCoupon, useCheckoutDraft } from './checkout';
import {
  bestOfferForCart,
  listAvailableOffers,
  type CustomerOfferFacts,
  type OfferCartLine,
  type OfferOption,
  type PromoCoupon,
} from './offers';

/** How many offers are listed before the "Show all" disclosure. */
const COLLAPSED_OFFERS = 3;

// ── Live bag prices + categories ───────────────────────────────────────────
/**
 * Cart lines cache the price from when they were added; `placeOrder` prices from
 * the product doc. Re-reading them keeps the summary honest AND backfills each
 * line's `categorySlug`, which the offer selection below is scored on.
 *
 * De-duplicated across callers: the Checkout page refreshes on mount and this
 * component refreshes too, and both must not fire the same product reads twice.
 */
let refreshInFlight: Promise<unknown> | null = null;
export function refreshCartPricesOnce(): Promise<unknown> {
  if (refreshInFlight) return refreshInFlight;
  const run = useCart.getState().refreshPrices().catch(() => false);
  refreshInFlight = run;
  void run.finally(() => {
    if (refreshInFlight === run) refreshInFlight = null;
  });
  return run;
}

/**
 * True once {@link refreshCartPricesOnce} has settled. Auto-applying before it
 * lands would judge a category-restricted coupon on stale (or, for a bag written
 * by the app, missing) categories.
 */
function useCartPricesReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void refreshCartPricesOnce().finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

/**
 * The offer streams. Same idea as `useCollection`, with one difference that
 * matters here: it reports `loading` again whenever the query is rebuilt. On the
 * Bag the customer's uid only lands after the first render, and the shared hook
 * keeps its "no query → not loading, no data" verdict until the first snapshot
 * of the NEW query — which would let the auto-apply below run against "this
 * customer has no coupons" and then lock itself out for good.
 *
 * A null query (signed out) simply never settles: nothing is rendered then, and
 * every effect is short-circuited on the uid anyway.
 */
export function useOfferCollection<T>(makeQuery: () => Query | null, deps: unknown[]): { data: T[]; loading: boolean } {
  const [state, setState] = useState<{ data: T[]; loading: boolean }>({ data: [], loading: true });
  useEffect(() => {
    const q = makeQuery();
    if (!q) {
      setState({ data: [], loading: true });
      return;
    }
    setState((s) => ({ data: s.data, loading: true }));
    return onSnapshot(
      q,
      // The DOCUMENT id is carried alongside the data: `customers/{uid}/
      // couponUsage` is keyed by the coupon's doc id, so the per-customer
      // redemption count cannot be matched to a coupon without it.
      (snap) =>
        setState({
          data: snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as T),
          loading: false,
        }),
      // A denied/failed read must not hang the surface: no offers, settled.
      () => setState({ data: [], loading: false }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/**
 * How many times this customer has redeemed each promotional coupon —
 * `customers/{uid}/couponUsage/{couponId}.count`, the very counter
 * `evaluatePromoCoupon` checks `maxUsesPerUser` against.
 *
 * Resolves to `null` while it is loading AND whenever the read is refused
 * (the owner-read rule is not deployed everywhere yet). `null` means "unknown",
 * which the offer engine treats as "do not enforce the per-customer limit" —
 * i.e. exactly the behaviour that existed before this stream, never a state
 * where every limited coupon is wrongly declared spent.
 */
function usePromoUsage(uid: string | undefined): Record<string, number> | null {
  const [usage, setUsage] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (!uid) {
      setUsage(null);
      return;
    }
    return onSnapshot(
      collection(db, 'customers', uid, 'couponUsage'),
      (snap) => {
        const next: Record<string, number> = {};
        for (const d of snap.docs) next[d.id] = Math.max(0, Number(d.data()?.count ?? 0));
        setUsage(next);
      },
      () => setUsage(null),
    );
  }, [uid]);
  return usage;
}

/**
 * "The customer took a coupon off" — module-level so it survives the Bag ⇄
 * Checkout navigation that remounts this component. Without it, removing a
 * coupon on one screen and walking to the other would auto-apply it straight
 * back, which is precisely what `noCoupon` exists to prevent server-side.
 * Cleared once the bag empties, so the next order starts fresh.
 */
const removedByCustomer = { value: false };

export function CouponRewardBanner({
  compact = false,
  className,
  children,
}: {
  /** Tighter padding for the Bag's summary column. */
  compact?: boolean;
  className?: string;
  /** Rendered at the foot of the card (Checkout puts "Friend's code" here). */
  children?: ReactNode;
}) {
  const { customer } = useAuth();
  const uid = customer?.uid;

  const lines = useCart((s) => s.lines);
  const subtotalPaise = useCart((s) => s.subtotalPaise());
  const coupon = useCheckoutDraft((s) => s.coupon);
  const setDraft = useCheckoutDraft((s) => s.set);

  const pricesReady = useCartPricesReady();
  const [code, setCode] = useState('');
  const [applying, setApplying] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // The customer's personal coupons (spin / welcome rewards) + the broadly
  // targeted promotional ones. Both streams stay subscribed while a coupon is
  // applied — see the file header.
  const userCoupons = useOfferCollection<UserCoupon>(
    () => (uid ? query(collection(db, 'customers', uid, 'coupons'), where('status', '==', 'active')) : null),
    [uid],
  );
  // Gated on the uid as well: a signed-out visitor is shown nothing at all (see
  // the early return below), so there is no reason to open the listener.
  const promoCoupons = useOfferCollection<PromoCoupon>(
    () => (uid ? query(collection(db, 'coupons'), where('status', '==', 'active')) : null),
    [uid],
  );
  // The customer-side half of the coupon rules — `targetUsers`, `firstOrderOnly`
  // and `maxUsesPerUser`. Without them the list showed a spent coupon with a
  // live Apply button that `applyCoupon` refused with "You have already used
  // this coupon."
  const promoUsage = usePromoUsage(uid);
  const offerFacts = useMemo<CustomerOfferFacts>(
    () => ({
      ordersCount: Number(customer?.stats?.ordersCount ?? 0),
      affiliateEnabled: customer?.affiliate?.enabled === true,
      promoUsage,
    }),
    [customer?.stats?.ordersCount, customer?.affiliate?.enabled, promoUsage],
  );

  // Lines as the offer engine scores them: a coupon limited to
  // `applicableCategories` may only discount the lines in those categories, so
  // both offer paths need each line's category and value — the same pairing
  // placeOrder's discountableSubtotal works from (PricedLine.category +
  // lineTotalPaise = offerPricePaise × qty).
  const offerLines = useMemo<OfferCartLine[]>(
    () => lines.map((l) => ({ categorySlug: l.categorySlug ?? null, lineTotalPaise: l.pricePaise * l.qty })),
    [lines],
  );

  // Every bag line already carries its category → the price refresh (which only
  // exists to backfill a missing categorySlug for category-restricted coupons)
  // has nothing to settle, so the auto-apply need not wait for it. Web-added
  // lines always have it; only a bag written by the Flutter app can miss it.
  const categoriesKnown = useMemo(() => lines.every((l) => l.categorySlug != null), [lines]);

  // Auto-apply the best offer for display; placeOrder re-derives the real one.
  const autoTried = useRef(false);
  useEffect(() => {
    if (!uid) return;
    if (subtotalPaise <= 0) {
      removedByCustomer.value = false; // a fresh bag deserves a fresh offer
      return;
    }
    if (autoTried.current || removedByCustomer.value) return;
    if (coupon) return; // the customer already has one applied
    if (userCoupons.loading || promoCoupons.loading) return;
    // Wait for the category backfill ONLY when a line is actually missing its
    // category — otherwise a spin reward (no category restriction) and any
    // web-added bag apply the instant the coupons load, with no perceptible lag.
    if (!pricesReady && !categoriesKnown) return;
    autoTried.current = true; // only auto-apply once — respect a manual removal
    const best = bestOfferForCart(
      subtotalPaise,
      userCoupons.data,
      promoCoupons.data,
      offerLines,
      offerFacts,
    );
    if (best) {
      setDraft({
        coupon: {
          code: best.code,
          discountPaise: best.discountPaise,
          label: 'Auto-applied best offer',
          waiveDelivery: best.waiveDelivery,
        },
      });
      toast.success(`Best offer applied · ${best.code}`);
    }
  }, [
    uid,
    coupon,
    setDraft,
    userCoupons.loading,
    promoCoupons.loading,
    userCoupons.data,
    promoCoupons.data,
    subtotalPaise,
    pricesReady,
    categoriesKnown,
    offerLines,
    offerFacts,
  ]);

  // The applied coupon stores a discount computed for the bag it was applied to.
  // Change the bag (quantities, a repriced line) and a percentage coupon — or one
  // whose minimum no longer holds — leaves the summary showing a total the server
  // won't honour. Re-validate against the live bag, server-side.
  const revalidatedKey = useRef<string | null>(null);
  const appliedCode = coupon?.code ?? null;
  useEffect(() => {
    if (!uid || !appliedCode || lines.length === 0 || subtotalPaise <= 0) return;
    const key = `${appliedCode}:${subtotalPaise}`;
    if (revalidatedKey.current === key) return;
    revalidatedKey.current = key;
    let alive = true;
    (async () => {
      try {
        const res = await callApplyCoupon(appliedCode, lines);
        if (!alive) return;
        const cur = useCheckoutDraft.getState().coupon;
        if (cur?.code !== appliedCode) return; // changed under us
        if (cur.discountPaise !== res.discountPaise || !!cur.waiveDelivery !== !!res.waiveDelivery) {
          setDraft({ coupon: { ...cur, discountPaise: res.discountPaise, waiveDelivery: res.waiveDelivery } });
        }
      } catch (e) {
        if (!alive) return;
        // A transport failure must not drop a valid coupon — only a real
        // rejection (minimum not met, expired, already used) clears it.
        const code = (e as { code?: string })?.code ?? '';
        if (code === 'functions/internal' || code === 'functions/unavailable' || code === 'functions/deadline-exceeded') {
          revalidatedKey.current = null; // let a later render retry
          return;
        }
        if (useCheckoutDraft.getState().coupon?.code !== appliedCode) return;
        setDraft({ coupon: null });
        toast.error(errMessage(e, 'That coupon no longer applies to this cart.'));
      }
    })();
    return () => {
      alive = false;
    };
  }, [uid, setDraft, appliedCode, lines, subtotalPaise]);

  // Every redeemable offer for the current bag — the list below.
  const offers = useMemo(
    () => listAvailableOffers(subtotalPaise, userCoupons.data, promoCoupons.data, offerLines, offerFacts),
    [subtotalPaise, userCoupons.data, promoCoupons.data, offerLines, offerFacts],
  );

  // The one the server would auto-apply itself, matched back to its list entry
  // for the banner's copy.
  const best = useMemo(
    () => bestOfferForCart(subtotalPaise, userCoupons.data, promoCoupons.data, offerLines, offerFacts),
    [subtotalPaise, userCoupons.data, promoCoupons.data, offerLines, offerFacts],
  );
  const bestOption = useMemo(
    () => (best ? offers.find((o) => o.code === best.code) ?? null : null),
    [best, offers],
  );

  /**
   * Apply an offer the customer picked from the list (or the banner).
   *
   * Routed through `applyCoupon` rather than trusting the client-side amount:
   * the rules this component CANNOT check — `maxUsesPerUser` against the
   * per-customer counter (`customers/{uid}/couponUsage` is not client readable)
   * and `firstOrderOnly` — are exactly the ones that make a coupon look
   * available and then be refused at checkout. Validating here means a coupon is
   * never shown as applied unless the server agreed to it, and the discount on
   * screen is the server's own number.
   */
  async function applyOffer(o: OfferOption) {
    // `unavailableReason` is a refusal we have already proved (already used /
    // first order only) — the round-trip could only come back as an error.
    if (!o.qualifies || o.unavailableReason || applying) return;
    setApplying(true);
    try {
      const res = await callApplyCoupon(o.code, lines);
      removedByCustomer.value = false;
      setDraft({
        coupon: {
          code: o.code,
          discountPaise: res.discountPaise,
          label: o.source === 'spin' ? 'Spin reward' : 'Coupon',
          // A free-delivery coupon discounts nothing; the summary has to waive
          // the fee instead, exactly as the server's `summarise` does.
          waiveDelivery: res.waiveDelivery,
        },
      });
      revalidatedKey.current = `${o.code}:${subtotalPaise}`; // just validated
      toast.success(`${o.code} applied`);
    } catch (e) {
      toast.error(errMessage(e, "That coupon couldn't be applied."));
    } finally {
      setApplying(false);
    }
  }

  function removeCoupon() {
    // Deliberate: this must keep meaning "no coupon" (placeOrder is told so with
    // `noCoupon`), never "pick the best offer for me".
    removedByCustomer.value = true;
    setDraft({ coupon: null });
  }

  async function applyCode() {
    const trimmed = code.trim();
    if (!trimmed || applying) return;
    setApplying(true);
    try {
      const res = await callApplyCoupon(trimmed, lines);
      removedByCustomer.value = false;
      setDraft({ coupon: { code: trimmed, discountPaise: res.discountPaise, label: res.label, waiveDelivery: res.waiveDelivery } });
      revalidatedKey.current = `${trimmed}:${subtotalPaise}`; // just validated
      toast.success(`Coupon ${trimmed} applied`);
      setCode('');
    } catch (e) {
      toast.error(errMessage(e, "That coupon couldn't be applied."));
    } finally {
      setApplying(false);
    }
  }

  // Mirrors the app's `uid == null` short-circuit — after the hooks, so the hook
  // order never changes between renders.
  if (!uid) return null;

  const spins = offers.filter((o) => o.source === 'spin');
  const promos = offers.filter((o) => o.source === 'promo');
  const loading = userCoupons.loading || promoCoupons.loading;
  const visible = expanded ? offers.length : COLLAPSED_OFFERS;
  const hidden = Math.max(0, offers.length - visible);
  // Keep the collapsed list to the first few overall (they are already sorted
  // best-first) without letting a group render an empty heading.
  const shownSpins = spins.slice(0, visible);
  const shownPromos = promos.slice(0, Math.max(0, visible - shownSpins.length));

  return (
    <section
      className={cn(
        'rounded-2xl border border-border-subtle bg-surface-card',
        compact ? 'p-4' : 'p-[22px]',
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className={cn('font-display font-extrabold text-text-primary', compact ? 'text-[15px]' : 'text-base')}>
          Coupons &amp; offers
        </span>
        {offers.length > 0 && (
          <span className="font-ui text-xs font-bold text-text-tertiary">
            {offers.length} available
          </span>
        )}
      </div>

      {/* Gold reward banner — the best qualifying reward, one tap to apply. */}
      {!coupon && bestOption && (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-brand-gold-border bg-brand-gold-subtle px-4 py-3.5">
          <RiGiftLine size={20} className="flex-none text-brand-gold-strong" />
          <div className="min-w-0 flex-1">
            <div className="font-ui text-[13px] font-extrabold text-text-primary">
              {bestOption.source === 'spin' ? 'You have a spin reward' : 'You have a coupon'}
            </div>
            <div className="mt-0.5 truncate font-ui text-xs font-medium text-text-secondary">
              {bestOption.headline} · {bestOption.sub}
            </div>
          </div>
          {/* "Apply offer", not a bare "Apply": the manual code field below has
              the plain Apply, and the two must stay tellable apart. */}
          <Button theme="gold" size="s" className="flex-none" onClick={() => void applyOffer(bestOption)}>
            Apply offer
          </Button>
        </div>
      )}

      {/* Applied coupon. */}
      {coupon && (
        <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-brand-gold-border bg-brand-gold-subtle px-4 py-3">
          <RiCheckLine size={18} className="flex-none text-brand-gold-strong" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-ui text-[13px] font-extrabold text-text-primary">{coupon.code} applied</div>
            <div className="mt-0.5 truncate font-ui text-xs font-medium text-brand-gold-strong">{coupon.label}</div>
          </div>
          <span className="font-display text-[13px] font-extrabold text-brand-gold-strong">
            −{formatMoney2dp(coupon.discountPaise)}
          </span>
          <button
            type="button"
            onClick={removeCoupon}
            className="inline-flex flex-none items-center gap-1 font-ui text-xs font-bold text-text-tertiary transition-colors hover:text-text-primary"
          >
            <RiCloseLine size={14} /> Remove
          </button>
        </div>
      )}

      {/* Manual code entry — the app's coupon screen has the same field. */}
      <div className="flex items-stretch gap-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-dashed border-border-default bg-surface-app px-3.5">
          <RiGiftLine size={18} className="flex-none text-brand-primary" />
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && applyCode()}
            placeholder="Enter coupon code"
            aria-label="Coupon code"
            className="w-full bg-transparent py-3 font-ui text-sm font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
        </div>
        <Button theme="neutral" size="m" outline className="flex-none" onClick={applyCode} disabled={applying || !code.trim()}>
          {applying ? 'Applying…' : 'Apply'}
        </Button>
      </div>

      {/* Every offer for this bag — the app groups them the same way. */}
      {shownSpins.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <SectionLabel>From your rewards</SectionLabel>
          {shownSpins.map((o) => (
            <OfferCard key={o.code} offer={o} applied={coupon?.code === o.code} onApply={() => void applyOffer(o)} onRemove={removeCoupon} />
          ))}
        </div>
      )}
      {shownPromos.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <SectionLabel>Available for you</SectionLabel>
          {shownPromos.map((o) => (
            <OfferCard key={o.code} offer={o} applied={coupon?.code === o.code} onApply={() => void applyOffer(o)} onRemove={removeCoupon} />
          ))}
        </div>
      )}
      {(hidden > 0 || expanded) && offers.length > COLLAPSED_OFFERS && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 inline-flex items-center gap-1 font-ui text-[13px] font-bold text-brand-primary hover:underline"
        >
          {expanded ? 'Show fewer offers' : `Show all ${offers.length} offers`}
          <RiArrowDownSLine size={16} className={cn('transition-transform', expanded && 'rotate-180')} />
        </button>
      )}
      {!loading && offers.length === 0 && (
        <p className="mt-4 font-ui text-[13px] font-medium text-text-tertiary">
          No coupons available for this bag right now. Spin &amp; Win rewards and offers show up here.
        </p>
      )}

      {children}
    </section>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-ui text-[11px] font-bold uppercase tracking-[0.06em] text-text-tertiary">{children}</div>
  );
}

/**
 * One offer row. Gold for a spin reward (the app's `_spinCard`), plain card for a
 * promotional coupon (`_promoCard`); a coupon the bag is too small for is dimmed
 * and says how much more is needed, and the applied one can be tapped off again.
 */
function OfferCard({
  offer,
  applied,
  onApply,
  onRemove,
}: {
  offer: OfferOption;
  applied: boolean;
  onApply: () => void;
  onRemove: () => void;
}) {
  const gold = offer.source === 'spin';
  // Both states render the SAME dimmed treatment — the only difference is what
  // the row says and that an unavailable one can never become appliable by
  // adding to the bag.
  const locked = !offer.qualifies || !!offer.unavailableReason;
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-3',
        applied
          ? 'border-brand-gold bg-brand-gold-subtle'
          : gold
            ? 'border-brand-gold-border bg-brand-gold-subtle'
            : 'border-border-subtle bg-surface-card',
        locked && !applied && 'opacity-70',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span
            className={cn(
              'font-ui text-[13px] font-extrabold',
              locked ? 'text-text-tertiary' : gold ? 'text-brand-gold-strong' : 'text-text-primary',
            )}
          >
            {offer.code}
          </span>
          <span className="font-ui text-xs font-semibold text-text-secondary">{offer.headline}</span>
        </div>
        <div className={cn('mt-0.5 font-ui text-[11px] font-medium', locked ? 'text-error' : 'text-text-tertiary')}>
          {offer.unavailableReason
            ? `${offer.unavailableReason} · ${offer.sub}`
            : locked
              ? `Add ${formatMoney2dp(offer.shortfallPaise)} more · ${offer.sub}`
              : offer.sub}
        </div>
      </div>
      {applied ? (
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex flex-none items-center gap-1 rounded-pill bg-brand-gold px-3 py-1.5 font-ui text-[12px] font-bold text-white"
        >
          <RiCheckLine size={14} /> Applied
        </button>
      ) : locked ? (
        <span className="flex-none font-ui text-[11px] font-medium text-text-tertiary">
          {offer.unavailableReason ?? 'Not eligible'}
        </span>
      ) : (
        <button
          type="button"
          onClick={onApply}
          className="flex-none font-ui text-[13px] font-bold text-brand-primary hover:underline"
        >
          Apply
        </button>
      )}
    </div>
  );
}

/** Surface the Cloud Function's own error message when present. */
function errMessage(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message;
  return m && !m.startsWith('INTERNAL') ? m : fallback;
}
