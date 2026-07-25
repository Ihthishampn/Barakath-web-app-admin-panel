'use client';
/**
 * Best-offer selection for the cart (client-side, for DISPLAY on checkout).
 *
 * Mirrors the server `autoBestOffer` in functions/src/orders/checkout.ts so the
 * discount shown at checkout matches what `placeOrder` computes. placeOrder
 * re-validates authoritatively, so the server value always wins if they diverge.
 *
 * Scans the customer's personal coupons (spin/welcome rewards) + broadly-targeted
 * promotional coupons, and returns the largest qualifying discount.
 */
import type { UserCoupon } from '@barkath/shared';

export interface AppliedOffer {
  code: string;
  discountPaise: number;
  label: string;
  /** free_shipping coupons discount nothing but waive delivery server-side. */
  waiveDelivery?: boolean;
}

/**
 * Loose shape for a promotional `coupons` doc (admin-authored).
 *
 * Field names MUST match what the admin writes (admin features/coupons/api/
 * coupons.ts) and what placeOrder validates. This previously declared
 * minOrderPaise / maxDiscountPaise / expiresAt / noExpiry — none of which any
 * surface writes — so the storefront ignored every promo constraint and offered
 * coupons that the server then refused.
 */
export interface PromoCoupon {
  /**
   * The coupon DOCUMENT id — not the code. `customers/{uid}/couponUsage` is
   * keyed by it, so the per-customer redemption count can only be matched to a
   * coupon through this. Supplied by the caller from the snapshot's `doc.id`.
   */
  id?: string;
  code: string;
  status?: string;
  active?: boolean;
  targetUsers?: string;
  autoApply?: boolean;
  validFrom?: { toMillis(): number } | null;
  validUntil?: { toMillis(): number } | null;
  minCartValuePaise?: number;
  discountType?: string;
  discountValuePaise?: number | null;
  discountPercent?: number | null;
  discountMaxCapPaise?: number | null;
  maxUsesTotal?: number | null;
  usesCount?: number | null;
  firstOrderOnly?: boolean;
  maxUsesPerUser?: number | null;
  /** Category *slugs* the coupon is limited to; empty/absent = every category. */
  applicableCategories?: string[] | null;
}

/**
 * A cart line for evaluating category-restricted coupons. `categorySlug` is the
 * product's categorySlug — the same value the server matches on (PricedLine.
 * category in functions/src/orders/checkout.ts).
 */
export interface OfferCartLine {
  categorySlug?: string | null;
  lineTotalPaise: number;
}

/**
 * The customer facts a promotional coupon is judged against — the client mirror
 * of `CustomerFacts` + `userCouponUses` in functions/src/orders/checkout.ts.
 *
 * Without these the storefront could not check `targetUsers`, `firstOrderOnly`
 * or `maxUsesPerUser`, which is exactly why a coupon the customer had already
 * spent kept showing a live Apply button that `applyCoupon` then refused with
 * "You have already used this coupon."
 */
export interface CustomerOfferFacts {
  /** customers/{uid}.stats.ordersCount */
  ordersCount: number;
  /** customers/{uid}.affiliate?.enabled === true */
  affiliateEnabled: boolean;
  /**
   * couponId → how many times THIS customer has redeemed it
   * (`customers/{uid}/couponUsage/{couponId}.count`).
   *
   * `null` means the subcollection could not be read at all (the security rule
   * is not deployed yet, or the read failed). Per-customer limits are then
   * simply UNKNOWN and are not enforced client-side — the previous behaviour —
   * rather than every limited coupon being wrongly declared spent.
   */
  promoUsage: Record<string, number> | null;
}

/**
 * Mirrors `assertCouponAudience` in functions/src/orders/checkout.ts.
 *
 * 'new' is NOT an audience the server rejects — it is expressed through
 * `firstOrderOnly`, checked separately — so hiding it (which is what a blanket
 * `targetUsers !== 'all'` did) hid coupons the server would happily accept.
 * 'existing' and 'affiliates' are answerable from the customer document;
 * anything else fails closed, exactly as the server does.
 */
function audienceAllows(targetUsers: unknown, facts: CustomerOfferFacts | null | undefined): boolean {
  const target = String(targetUsers ?? 'all');
  if (target === 'all' || target === 'new') return true;
  // No facts (a caller that cannot supply them) → stay conservative and keep
  // the pre-existing "broadly targeted only" behaviour.
  if (!facts) return false;
  if (target === 'existing') return facts.ordersCount > 0;
  if (target === 'affiliates') return facts.affiliateEnabled;
  return false;
}

/**
 * Why this customer can NEVER redeem this coupon, however big their bag gets —
 * or null when nothing here blocks it.
 *
 * These are the two rules that depend on the customer rather than the cart, and
 * both are hard refusals server-side (`evaluatePromoCoupon`). They are surfaced
 * as a reason instead of hiding the row: the coupon is genuinely theirs to see,
 * it just cannot be applied again, and an Apply button that always fails is
 * worse than a row that says why.
 */
function promoBlockedReason(c: PromoCoupon, facts: CustomerOfferFacts | null | undefined): string | null {
  if (!facts) return null;
  if (c.firstOrderOnly === true && facts.ordersCount > 0) return 'First order only';
  const perUser = Number(c.maxUsesPerUser ?? 0);
  // `promoUsage === null` = unreadable, so the limit is unknown and must not be
  // guessed at — the server still validates it on Apply.
  if (perUser > 0 && facts.promoUsage) {
    const used = Math.max(0, Number(facts.promoUsage[c.id ?? ''] ?? 0));
    if (used >= perUser) return 'Already used';
  }
  return null;
}

/**
 * Cart-independent "My Coupons" status for a promotional coupon — 'active'
 * (redeemable now), 'used' (this customer's personal allowance is spent) or
 * 'expired' (no longer reachable at all: paused, wrong audience, outside its
 * validity window, or globally exhausted). Matches the vocabulary
 * `UserCoupon.status` already uses (@barkath/shared), so
 * `couponDisplayStatus` (components/wallet/actions.ts) needs no changes to
 * display it.
 *
 * Deliberately has no cart/subtotal/category args — the Rewards page lists a
 * coupon regardless of what's in the bag right now; `minCartValuePaise` is
 * shown as informational text there, not a gate, same as a personal coupon's.
 */
export function promoPersonalStatus(
  c: PromoCoupon,
  facts: CustomerOfferFacts | null | undefined,
  now: number,
): 'active' | 'used' | 'expired' {
  const perUser = Number(c.maxUsesPerUser ?? 0);
  const used = Math.max(0, Number(facts?.promoUsage?.[c.id ?? ''] ?? 0));
  if (perUser > 0 && used >= perUser) return 'used';

  if (c.status && c.status !== 'active') return 'expired';
  if (c.active === false) return 'expired';
  if (!audienceAllows(c.targetUsers, facts)) return 'expired';
  const from = c.validFrom?.toMillis?.();
  if (from && from > now) return 'expired';
  const until = c.validUntil?.toMillis?.();
  if (until && until < now) return 'expired';
  const maxTotal = c.maxUsesTotal == null ? null : Number(c.maxUsesTotal);
  if (maxTotal !== null && Math.max(0, Number(c.usesCount ?? 0)) >= maxTotal) return 'expired';
  return 'active';
}

/**
 * Does this promotional coupon belong on the Rewards page at all for this
 * customer — either they can redeem it right now, or they already have (in
 * which case it stays visible as a historical "Used" ticket even after the
 * admin pauses it, it expires, or its audience no longer includes them).
 */
export function promoVisibleToCustomer(
  c: PromoCoupon,
  facts: CustomerOfferFacts | null | undefined,
  now: number,
): boolean {
  const used = Math.max(0, Number(facts?.promoUsage?.[c.id ?? ''] ?? 0));
  if (used > 0) return true;
  return promoPersonalStatus(c, facts, now) === 'active';
}

/**
 * Subtotal of the lines a coupon may actually discount — mirrors
 * `discountableSubtotal` in functions/src/orders/checkout.ts, which restricts
 * both the discount and the coupon's validity to `applicableCategories`.
 *
 * Returns null when the coupon IS restricted but the caller could not supply the
 * cart's categories: the restriction is unverifiable here, and an unverifiable
 * restriction must never be advertised as a qualifying discount (the server
 * would then refuse the code and the coupon is torn back off).
 */
function discountableSubtotal(
  applicableCategories: string[] | null | undefined,
  subtotalPaise: number,
  lines: OfferCartLine[] | undefined,
): number | null {
  const cats = (applicableCategories ?? []).filter(Boolean);
  if (cats.length === 0) return subtotalPaise;
  if (!lines) return null;
  return lines
    .filter((l) => !!l.categorySlug && cats.includes(l.categorySlug))
    .reduce((s, l) => s + l.lineTotalPaise, 0);
}

/**
 * Is this promotional coupon REDEEMABLE AT ALL for this customer + bag?
 *
 * These are the rules the client can verify from the coupon document itself,
 * checked exactly as `computeCouponDiscount` (functions/src/orders/checkout.ts)
 * checks them. A coupon that fails one of them is refused by the server, so it
 * must not be listed as an offer either — a redeemed-out coupon sitting in
 * "Available for you" with an Apply button is the storefront advertising
 * something the checkout will reject.
 *
 * `maxUsesPerUser` and `firstOrderOnly` are NOT part of this gate: they do not
 * make the coupon disappear, they make it un-appliable — see
 * {@link promoBlockedReason}, which turns them into a visible "Already used" /
 * "First order only" state on the row instead.
 */
function promoRedeemable(
  c: PromoCoupon,
  subtotalPaise: number,
  now: number,
  lines?: OfferCartLine[],
  facts?: CustomerOfferFacts | null,
): boolean {
  if (c.status && c.status !== 'active') return false;
  if (c.active === false) return false;
  // Audience, judged exactly as the server judges it — a blanket
  // `targetUsers !== 'all'` also hid every 'new' coupon (which the server
  // accepts for everyone) and every 'existing'/'affiliates' coupon the
  // customer actually qualifies for.
  if (!audienceAllows(c.targetUsers, facts)) return false;

  const from = c.validFrom?.toMillis?.();
  if (from && from > now) return false;
  const until = c.validUntil?.toMillis?.();
  if (until && until < now) return false;

  // Usage limit reached — the server answers "This coupon has reached its usage
  // limit." Nothing on this screen used to check it, so an exhausted coupon
  // stayed on offer to every customer for ever.
  const maxTotal = c.maxUsesTotal == null ? null : Number(c.maxUsesTotal);
  if (maxTotal !== null && Math.max(0, Number(c.usesCount ?? 0)) >= maxTotal) return false;

  // Category restriction: a bag that provably contains no eligible line is
  // refused server-side. `null` = the caller could not supply categories, which
  // is not proof of anything, so the coupon stays listed.
  const eligiblePaise = discountableSubtotal(c.applicableCategories, subtotalPaise, lines);
  if (eligiblePaise === 0) return false;

  return true;
}

/**
 * May this coupon be put on the draft WITHOUT the customer choosing it?
 *
 * Mirrors `autoBestOffer` (functions/src/orders/checkout.ts), including its
 * deliberate refusal to auto-apply a coupon whose per-customer limit it cannot
 * check. Admin stamps `maxUsesPerUser: 1` on every coupon it creates, so
 * auto-applying one anyway gets a returning customer's placeOrder rejected with
 * "You have already used this coupon."
 */
function promoAutoApplicable(
  c: PromoCoupon,
  subtotalPaise: number,
  now: number,
  lines?: OfferCartLine[],
  facts?: CustomerOfferFacts | null,
): boolean {
  if (!promoRedeemable(c, subtotalPaise, now, lines, facts)) return false;
  // A coupon this customer can never redeem must never be auto-applied either —
  // the summary would show a discount `placeOrder` silently drops.
  if (promoBlockedReason(c, facts)) return false;
  // `autoBestOffer` auto-applies BROADLY-TARGETED coupons only. A targeted one
  // may still be listed (the customer can choose it, and the code is then
  // validated server-side), but putting it on the draft unasked would price the
  // order on an audience judgement the server's auto path never makes.
  if (c.targetUsers && c.targetUsers !== 'all') return false;
  if (c.autoApply === false) return false;
  if (subtotalPaise < Number(c.minCartValuePaise ?? 0)) return false;
  if (c.firstOrderOnly === true) return false;
  if (Number(c.maxUsesPerUser ?? 0) > 0) return false;
  // An unverifiable category restriction (null) is not auto-appliable: the
  // server would grant less than the screen promised.
  const eligiblePaise = discountableSubtotal(c.applicableCategories, subtotalPaise, lines);
  return eligiblePaise !== null && eligiblePaise > 0;
}

/** The amount a promotional coupon is worth, term-for-term as `couponAmount`
 *  computes it server-side. 0 when the bag is below the minimum or nothing in it
 *  is eligible. */
function promoDiscount(c: PromoCoupon, subtotalPaise: number, lines?: OfferCartLine[]): number {
  if (subtotalPaise < Number(c.minCartValuePaise ?? 0)) return 0;
  const eligiblePaise = discountableSubtotal(c.applicableCategories, subtotalPaise, lines);
  if (eligiblePaise === null || eligiblePaise <= 0) return 0;
  let d = 0;
  if (c.discountType === 'flat') d = Number(c.discountValuePaise ?? 0);
  else if (c.discountType === 'percent') {
    d = Math.round((eligiblePaise * Number(c.discountPercent ?? 0)) / 100);
    const cap = Number(c.discountMaxCapPaise ?? 0);
    if (cap > 0) d = Math.min(d, cap);
  }
  return Math.min(Math.max(0, d), eligiblePaise);
}

// No category handling for personal coupons on purpose: they carry no
// `applicableCategories` (UserCoupon has no such field, and nothing — spin,
// welcome, admin — ever writes one), so the server's discountableSubtotal
// always returns the whole subtotal for these. Restricting them here would
// under-state a discount the server will happily give.
/**
 * Is a personal (spin/welcome) coupon still redeemable? `usesCount` against
 * `maxUsesPerCoupon` is checked as well as the status: cancellation hands a use
 * back, and the counter is what says whether any are left.
 */
function personalRedeemable(c: UserCoupon, now: number): boolean {
  if (c.status !== 'active') return false;
  const exp = c.expiresAt?.toMillis?.();
  if (exp && exp < now) return false;
  return Math.max(0, Number(c.usesCount ?? 0)) < Math.max(1, Number(c.maxUsesPerCoupon ?? 1));
}

function personalDiscount(c: UserCoupon, subtotalPaise: number): number {
  if (subtotalPaise < Number(c.minCartValuePaise ?? 0)) return 0;
  let d = 0;
  if (c.discountType === 'flat') d = Number(c.discountValuePaise ?? 0);
  else if (c.discountType === 'percent') {
    d = Math.round((subtotalPaise * Number(c.discountPercent ?? 0)) / 100);
    const cap = Number(c.discountMaxCapPaise ?? 0);
    if (cap > 0) d = Math.min(d, cap);
  }
  return Math.min(Math.max(0, d), subtotalPaise);
}

export interface OfferOption {
  code: string;
  headline: string; // "₹30 off" / "10% off"
  sub: string; // "Min cart ₹150" / "Won on Spin & Win"
  discountPaise: number; // for the current cart (0 when not qualifying)
  qualifies: boolean;
  shortfallPaise: number; // how much more cart is needed to qualify
  source: 'spin' | 'promo';
  /** free_shipping coupons discount nothing but waive delivery server-side. */
  waiveDelivery: boolean;
  /**
   * Short label for a refusal the client can already prove — "Already used",
   * "First order only". Non-null means the row must be shown WITHOUT an Apply
   * button: tapping it would only round-trip to `applyCoupon` and come back as
   * an error toast. Unlike {@link qualifies} this can never be fixed by adding
   * more to the bag.
   */
  unavailableReason: string | null;
  /**
   * May this offer be applied without the customer choosing it? Mirrors the
   * app's `OfferOption.autoApplicable` — the server auto-applies an offer only
   * when it passes every rule in `autoBestOffer`, including the redemption
   * limits it deliberately refuses to guess at client-side. An offer that fails
   * only those is still listed: tapping it is a deliberate choice, and it is
   * validated server-side before it is shown as applied.
   */
  autoApplicable: boolean;
}

const rupees = (p: number) => `₹${Math.round(p / 100).toLocaleString('en-IN')}`;

function promoHeadline(c: PromoCoupon): string {
  if (c.discountType === 'flat') return `${rupees(Number(c.discountValuePaise ?? 0))} off`;
  if (c.discountType === 'percent') {
    const base = `${Number(c.discountPercent ?? 0)}% off`;
    return c.discountMaxCapPaise ? `${base} · up to ${rupees(Number(c.discountMaxCapPaise))}` : base;
  }
  return 'Free delivery';
}
function personalHeadline(c: UserCoupon): string {
  if (c.discountType === 'flat') return `${rupees(Number(c.discountValuePaise ?? 0))} off`;
  if (c.discountType === 'percent') {
    const base = `${Number(c.discountPercent ?? 0)}% off`;
    return c.discountMaxCapPaise ? `${base} · up to ${rupees(Number(c.discountMaxCapPaise))}` : base;
  }
  return 'Free delivery';
}

/**
 * All of the customer's redeemable offers for the current cart — for the
 * selectable list on checkout. Qualifying offers first (highest discount), then
 * ones that need a bigger cart.
 */
export function listAvailableOffers(
  subtotalPaise: number,
  userCoupons: UserCoupon[],
  promoCoupons: PromoCoupon[],
  cartLines?: OfferCartLine[],
  facts?: CustomerOfferFacts | null,
): OfferOption[] {
  const now = Date.now();
  const out: OfferOption[] = [];

  for (const c of promoCoupons) {
    // One gate for the whole list: status, active, audience, the validity
    // window, the usage limit and a provably-ineligible bag. Every one of these
    // is refused by `placeOrder`, so listing a coupon that fails them offers the
    // customer something the checkout will take straight back off.
    if (!promoRedeemable(c, subtotalPaise, now, cartLines, facts)) continue;
    const min = Number(c.minCartValuePaise ?? 0);
    const blocked = promoBlockedReason(c, facts);
    // Category-restricted coupons say so in the sub-line instead of the false
    // "On any order".
    const restricted = (c.applicableCategories ?? []).filter(Boolean).length > 0;
    out.push({
      code: c.code,
      headline: promoHeadline(c),
      sub: restricted
        ? min > 0
          ? `Min cart ${rupees(min)} · selected categories`
          : 'Selected categories only'
        : min > 0
          ? `Min cart ${rupees(min)}`
          : 'On any order',
      discountPaise: promoDiscount(c, subtotalPaise, cartLines),
      qualifies: subtotalPaise >= min,
      shortfallPaise: Math.max(0, min - subtotalPaise),
      source: 'promo',
      waiveDelivery: c.discountType === 'free_shipping',
      unavailableReason: blocked,
      autoApplicable: promoAutoApplicable(c, subtotalPaise, now, cartLines, facts),
    });
  }

  for (const c of userCoupons) {
    if (!personalRedeemable(c, now)) continue;
    const min = Number(c.minCartValuePaise ?? 0);
    out.push({
      code: c.code,
      headline: personalHeadline(c),
      sub: c.source === 'spin' ? 'Won on Spin & Win' : min > 0 ? `Min cart ${rupees(min)}` : 'Your reward',
      discountPaise: personalDiscount(c, subtotalPaise),
      qualifies: subtotalPaise >= min,
      shortfallPaise: Math.max(0, min - subtotalPaise),
      source: 'spin',
      waiveDelivery: c.discountType === 'free_shipping',
      // A personal coupon carries no per-customer counter beyond `usesCount`,
      // which `personalRedeemable` has already enforced — nothing left to block.
      unavailableReason: null,
      // `autoBestOffer` checks a personal coupon's status, expiry, uses, the
      // minimum and the eligible subtotal — nothing else.
      autoApplicable: subtotalPaise >= min,
    });
  }

  // Appliable offers first (by discount desc), then ones that need a bigger bag
  // (by smallest shortfall), then the ones this customer can never redeem.
  return out.sort((a, b) => {
    const aBlocked = !!a.unavailableReason;
    const bBlocked = !!b.unavailableReason;
    if (aBlocked !== bBlocked) return aBlocked ? 1 : -1;
    if (a.qualifies !== b.qualifies) return a.qualifies ? -1 : 1;
    return a.qualifies ? b.discountPaise - a.discountPaise : a.shortfallPaise - b.shortfallPaise;
  });
}

/**
 * The single best offer the client may apply on the customer's behalf, or null.
 *
 * Only offers that pass every server-side auto-apply rule are considered, and a
 * free-delivery coupon counts even though it discounts nothing. Mirrors the
 * app's `bestAutoOffer`, which reads the same `autoApplicable` flag.
 */
export function bestOfferForCart(
  subtotalPaise: number,
  userCoupons: UserCoupon[],
  promoCoupons: PromoCoupon[],
  cartLines?: OfferCartLine[],
  facts?: CustomerOfferFacts | null,
): AppliedOffer | null {
  if (subtotalPaise <= 0) return null;
  const candidates = listAvailableOffers(
    subtotalPaise,
    userCoupons,
    promoCoupons,
    cartLines,
    facts,
  ).filter(
    // A coupon that failed ANY rule can never auto-apply — including a
    // free_shipping one. `waiveDelivery` used to be read straight off the coupon
    // doc, so a targeted / expired / below-minimum free-shipping coupon won
    // auto-apply on every cart even though it had been rejected.
    (o) =>
      o.autoApplicable && o.qualifies && !o.unavailableReason && (o.discountPaise > 0 || o.waiveDelivery),
  );
  // The list is already sorted qualifying-first, highest discount first.
  const best = candidates[0];
  return best
    ? { code: best.code, discountPaise: best.discountPaise, label: best.code, waiveDelivery: best.waiveDelivery }
    : null;
}
