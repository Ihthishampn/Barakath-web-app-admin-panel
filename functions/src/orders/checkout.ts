/**
 * Customer checkout — critical, money-moving Cloud Functions.
 *
 *   applyCoupon        — validate a code + compute its discount for a cart.
 *   placeOrder         — create the order atomically (stock ↓, wallet ↓, shortId,
 *                        items + timeline). An order the wallet covers outright
 *                        is settled at placement; razorpay orders are placed
 *                        with paymentStatus 'pending' and finalised by
 *                        verifyPayment. Cash on delivery is no longer offered —
 *                        see the paymentMethod guard in placeOrder.
 *   createRazorpayOrder— open a Razorpay order for a placed order (secret-side).
 *   verifyPayment      — verify the gateway signature and mark the order paid.
 *
 * The `orders` / `customers` / `products` collections are CF-only for these
 * writes (security rules), so all trust/validation happens here, never on the
 * client. Pricing mirrors the web computeSummary exactly.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db, FieldValue, Timestamp, callableOpts } from '../_lib/admin.js';
import { requireActiveCustomer, requireCustomer } from '../_lib/guards.js';
import { performCancellation } from './cancel.js';
import { generateInvoiceForOrder } from './invoice.js';
import {
  RESERVATIONS,
  reservationLines,
  restoreReservedStock,
  mergeRestoreIntoUpdate,
  groupLinesByProduct,
  type ReservationLine,
} from './reservations.js';
import {
  readReferringAffiliate,
  readOrderCommission,
  accrueCommission,
  type CommissionLine,
} from '../affiliate/commissions.js';
import { assertCartLimits, assertOrderTotalLimit } from './limits.js';
import { notifyCommission, notifyOrderStatus } from '../notifications/events.js';

/**
 * Publish the invoice for an order that just became genuinely paid.
 *
 * Awaited rather than truly fired-and-forgotten: a Cloud Run instance may be
 * frozen the moment the handler resolves, so a dangling promise is not
 * guaranteed to finish. Every failure is logged and swallowed — an invoice that
 * could not be rendered must never fail (or roll back) the order, and
 * adminGenerateInvoice remains available as a manual re-run.
 */
async function publishInvoiceQuietly(orderId: string): Promise<void> {
  try {
    await generateInvoiceForOrder(orderId);
  } catch (err) {
    logger.error(`Invoice generation failed for order ${orderId}`, err);
  }
}

const RZP_KEY_ID = defineSecret('RAZORPAY_KEY_ID');
const RZP_KEY_SECRET = defineSecret('RAZORPAY_KEY_SECRET');

// ── Shared payload ─────────────────────────────────────────────────
const Line = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  qty: z.number().int().positive(),
});
type Line = z.infer<typeof Line>;

interface PricedLine {
  productId: string;
  variantId: string | null;
  qty: number;
  name: string;
  displayTitle: string;
  imageUrl: string;
  categoryTint: string;
  category: string;
  variantLabel: string | null;
  mrpPaise: number;
  offerPricePaise: number;
  stock: number;
  lineTotalPaise: number;
  /**
   * Affiliate economics for this exact line, snapshotted at purchase time — the
   * catalogue may be re-priced later, and the affiliate earns what was
   * advertised when the sale happened. Carried onto the order's line items so
   * commission accrual reads the order, never the live catalogue.
   */
  commissionPaise: number | null;
  affiliateCommissionRate: number | null;
  isAffiliateEligible: boolean;
}

/** Read products for the cart lines and resolve per-line pricing + stock. */
async function priceLines(lines: Line[]): Promise<PricedLine[]> {
  const out: PricedLine[] = [];
  for (const l of lines) {
    const snap = await db.doc(`products/${l.productId}`).get();
    if (!snap.exists) throw new HttpsError('failed-precondition', 'A product is no longer available.');
    const p = snap.data() as Record<string, unknown>;
    if (p.status !== 'published') throw new HttpsError('failed-precondition', `${p.name ?? 'A product'} is unavailable.`);

    let mrpPaise = Number(p.mrpPaise ?? 0);
    let offerPricePaise = Number(p.offerPricePaise ?? p.mrpPaise ?? 0);
    let stock = Number(p.stock ?? 0);
    let variantLabel: string | null = null;
    // A variant-less product carries its own referral pair at the top level
    // (admin features/products/api/products.ts nulls these out once variants
    // exist), so this is the right default for a product with no variants.
    let commissionPaise = p.commissionPaise == null ? null : Number(p.commissionPaise);

    if (l.variantId) {
      const variants = (p.variants as Array<Record<string, unknown>>) ?? [];
      const v = variants.find((x) => x.id === l.variantId);
      if (!v) throw new HttpsError('failed-precondition', 'A selected option is unavailable.');
      mrpPaise = Number(v.mrpPaise ?? mrpPaise);
      offerPricePaise = Number(v.offerPricePaise ?? offerPricePaise);
      stock = Number(v.stock ?? 0);
      variantLabel = (v.label as string) ?? null;
      // The ordered VARIANT's commission wins — this is the figure the product
      // page advertises as guaranteed earnings for the selected option.
      if (v.commissionPaise != null) commissionPaise = Number(v.commissionPaise);
    }

    out.push({
      productId: l.productId,
      variantId: l.variantId ?? null,
      qty: l.qty,
      name: (p.name as string) ?? 'Item',
      displayTitle: (p.displayTitle as string) || (p.name as string) || 'Item',
      imageUrl: ((p.images as Array<{ url?: string }>)?.[0]?.url as string) ?? '',
      categoryTint: (p.categoryTint as string) ?? '#e6cfb4',
      category: (p.categorySlug as string) ?? '',
      variantLabel,
      mrpPaise,
      offerPricePaise,
      stock,
      lineTotalPaise: offerPricePaise * l.qty,
      commissionPaise: Number.isFinite(commissionPaise as number) ? commissionPaise : null,
      affiliateCommissionRate:
        p.affiliateCommissionRate == null ? null : Number(p.affiliateCommissionRate),
      // Absent means eligible — only an explicit false opts a product out, so
      // products written before the flag existed keep earning.
      isAffiliateEligible: p.isAffiliateEligible !== false,
    });
  }
  return out;
}

interface CouponResult {
  discountPaise: number;
  label: string;
  couponId: string | null; // promotional coupon doc id
  userCouponId: string | null; // customers/{uid}/coupons doc id (spin/welcome/etc.)
  /** Origin of a personal coupon ('spin' | 'welcome' | …) — drives the wallet
   * "Rewards" tally: only spin/wheel wins accrue there. */
  userCouponSource?: string | null;
  /** free_shipping coupons waive delivery instead of discounting the subtotal. */
  waiveDelivery?: boolean;
}

/** Normalise a coupon's restriction array to a list of non-empty strings. */
function idList(v: unknown): string[] {
  return Array.isArray(v) ? (v as unknown[]).map((x) => String(x)).filter(Boolean) : [];
}

/**
 * Subtotal of the cart lines a coupon may actually discount.
 *
 * Three independent restrictions, all written by the admin coupon form, all
 * meaning "unrestricted" when empty or absent:
 *   · `applicableCategories` — category *slugs*, matching PricedLine.category
 *     (= product.categorySlug);
 *   · `applicableProducts`   — an allowlist of product ids;
 *   · `excludedProducts`     — a denylist, applied last so it always wins.
 *
 * The product terms were previously not read anywhere, so a coupon restricted
 * to one product discounted the WHOLE cart — the same class of bug the category
 * term already had. They are written on every coupon (as `[]` today), so
 * honouring them changes nothing for existing coupons and makes the fields real
 * the moment the admin can set them.
 */
function discountableSubtotal(priced: PricedLine[], coupon: Record<string, unknown>): number {
  const cats = idList(coupon.applicableCategories);
  const only = idList(coupon.applicableProducts);
  const excluded = idList(coupon.excludedProducts);

  const lines = priced.filter(
    (l) =>
      (cats.length === 0 || cats.includes(l.category)) &&
      (only.length === 0 || only.includes(l.productId)) &&
      !excluded.includes(l.productId),
  );
  return lines.reduce((s, l) => s + l.lineTotalPaise, 0);
}

/**
 * The value a coupon is worth for one cart, from the coupon's own pricing
 * fields (`discountType` + `discountValuePaise` / `discountPercent` /
 * `discountMaxCapPaise`). Shared by every path — explicit code, auto-apply and
 * the in-transaction re-assert — so no two of them can ever compute a different
 * amount from the same document.
 *
 * `free_shipping` is worth nothing off the subtotal; it waives delivery in
 * `summarise` instead.
 */
function couponAmount(c: Record<string, unknown>, eligiblePaise: number): { discountPaise: number; waiveDelivery: boolean } {
  if (c.discountType === 'free_shipping') return { discountPaise: 0, waiveDelivery: true };
  let d = 0;
  if (c.discountType === 'flat') {
    d = Number(c.discountValuePaise ?? 0);
  } else if (c.discountType === 'percent') {
    d = Math.round((eligiblePaise * Number(c.discountPercent ?? 0)) / 100);
    const cap = Number(c.discountMaxCapPaise ?? 0);
    if (cap > 0) d = Math.min(d, cap);
  }
  // Never negative (a malformed document), never more than the lines it may
  // actually discount.
  return { discountPaise: Math.min(Math.max(0, Math.round(d)), Math.max(0, eligiblePaise)), waiveDelivery: false };
}

/**
 * How many times this customer has already redeemed a promotional coupon.
 * Tracked as a per-customer counter doc because counting orders would need a
 * composite index and grow unboundedly.
 *
 * Floored at zero: a counter that ever went negative (see the release path in
 * orders/cancel.ts) would otherwise hand the customer extra redemptions on top
 * of `maxUsesPerUser` — which is exactly how a "usage limit 1" coupon becomes
 * usable again and again.
 */
function usageCount(snap: { get(field: string): unknown } | null | undefined): number {
  return Math.max(0, Number(snap?.get('count') ?? 0));
}

async function userCouponUses(uid: string, couponId: string): Promise<number> {
  const snap = await db.doc(`customers/${uid}/couponUsage/${couponId}`).get();
  return snap.exists ? usageCount(snap) : 0;
}

/**
 * The customer facts a coupon is judged against, read ONCE off the customer
 * document. They are passed in rather than fetched per rule so that the very
 * same evaluator can run outside a transaction (applyCoupon, the pre-flight in
 * placeOrder) and again INSIDE the order transaction against transactionally
 * read data — which is what makes the two verdicts impossible to disagree.
 */
interface CustomerFacts {
  ordersCount: number;
  affiliateEnabled: boolean;
}

function customerFacts(data: Record<string, unknown> | undefined): CustomerFacts {
  const stats = (data?.stats as Record<string, unknown> | undefined) ?? {};
  const aff = (data?.affiliate as { enabled?: boolean } | null | undefined) ?? null;
  return {
    // `stats.ordersCount` is the field every other surface reads/writes
    // (packages/shared CustomerStats) — `stats.totalOrders` does not exist.
    ordersCount: Number(stats.ordersCount ?? 0),
    affiliateEnabled: aff?.enabled === true,
  };
}

/**
 * Enforce a promotional coupon's audience.
 *
 * The admin form writes `targetUsers`, and nothing ever read it — a coupon
 * created for affiliates or returning customers was redeemable by anyone. 'new'
 * is expressed as `firstOrderOnly`, which is checked separately; 'segment' has
 * no segment model anywhere in the codebase, so it fails closed rather than
 * silently meaning "everyone".
 */
function assertCouponAudience(targetUsers: unknown, facts: CustomerFacts): void {
  const target = String(targetUsers ?? 'all');
  if (target === 'all' || target === 'new') return;
  if (target === 'existing') {
    if (facts.ordersCount <= 0) {
      throw new HttpsError('failed-precondition', 'This coupon is for returning customers.');
    }
    return;
  }
  if (target === 'affiliates') {
    if (!facts.affiliateEnabled) {
      throw new HttpsError('failed-precondition', 'This coupon is for affiliates only.');
    }
    return;
  }
  throw new HttpsError('failed-precondition', 'This coupon is not available on your account.');
}

/**
 * EVERY rule on a promotional `coupons` document, in one place.
 *
 * Field names must match what the admin writes (admin features/coupons/api/
 * coupons.ts): active, status, validFrom, validUntil, minCartValuePaise,
 * maxUsesTotal + usesCount, maxUsesPerUser + the per-customer counter,
 * firstOrderOnly, targetUsers, applicableCategories and the discount trio.
 *
 * Throws the customer-facing HttpsError for the first rule that fails, and
 * returns the amount the coupon is worth for this exact cart. Called twice per
 * checkout — once on the pre-transaction read, once inside the order
 * transaction on the LOCKED document — so an admin edit (or a competing
 * checkout) landing between the two can never be paid out at the old terms.
 */
function evaluatePromoCoupon(
  c: Record<string, unknown>,
  priced: PricedLine[],
  facts: CustomerFacts,
  perUserUses: number,
  now: number,
): { discountPaise: number; waiveDelivery: boolean } {
  const subtotalPaise = priced.reduce((s, l) => s + l.lineTotalPaise, 0);

  if (c.active === false) throw new HttpsError('failed-precondition', 'This coupon is no longer active.');
  if (c.status && c.status !== 'active') throw new HttpsError('failed-precondition', 'This coupon is no longer active.');

  const validFrom = (c.validFrom as { toMillis?: () => number })?.toMillis?.();
  if (validFrom && validFrom > now) throw new HttpsError('failed-precondition', 'This coupon is not active yet.');
  const validUntil = (c.validUntil as { toMillis?: () => number })?.toMillis?.();
  if (validUntil && validUntil < now) throw new HttpsError('failed-precondition', 'This coupon has expired.');

  if (subtotalPaise < Number(c.minCartValuePaise ?? 0)) {
    throw new HttpsError('failed-precondition', 'Your cart does not meet this coupon’s minimum.');
  }

  // Redemption limits. `usesCount` is floored at zero for the same reason the
  // per-customer counter is: a counter that drifted negative must not read as
  // "budget still available" beyond what the admin configured.
  const maxTotal = c.maxUsesTotal == null ? null : Number(c.maxUsesTotal);
  if (maxTotal !== null && Math.max(0, Number(c.usesCount ?? 0)) >= maxTotal) {
    throw new HttpsError('failed-precondition', 'This coupon has reached its usage limit.');
  }
  const perUser = Number(c.maxUsesPerUser ?? 0);
  if (perUser > 0 && perUserUses >= perUser) {
    throw new HttpsError('failed-precondition', 'You have already used this coupon.');
  }

  assertCouponAudience(c.targetUsers, facts);
  if (c.firstOrderOnly === true && facts.ordersCount > 0) {
    throw new HttpsError('failed-precondition', 'This coupon is for first orders only.');
  }

  // Category restriction: only lines in `applicableCategories` may be
  // discounted. The admin has always written this field; nothing enforced it,
  // so a category-limited coupon discounted the whole cart.
  const eligiblePaise = discountableSubtotal(priced, c);
  if (eligiblePaise <= 0) {
    throw new HttpsError('failed-precondition', 'This coupon does not apply to the items in your bag.');
  }

  return couponAmount(c, eligiblePaise);
}

/**
 * EVERY rule on a personal `customers/{uid}/coupons` document (spin / welcome
 * rewards), same contract as {@link evaluatePromoCoupon}.
 *
 * `maxUsesPerCoupon` is written by executeSpin and was never read anywhere: the
 * only thing standing between a reward and a second redemption was the `status`
 * flip at placement — which the cancellation path resets. Checking the counter
 * as well means a released coupon still cannot be spent past its own limit.
 */
function evaluateUserCoupon(
  c: Record<string, unknown>,
  priced: PricedLine[],
  now: number,
): { discountPaise: number; waiveDelivery: boolean } {
  const subtotalPaise = priced.reduce((s, l) => s + l.lineTotalPaise, 0);

  if (c.status !== 'active') {
    throw new HttpsError('failed-precondition', 'This coupon has already been used or expired.');
  }
  const expiresAt = (c.expiresAt as { toMillis?: () => number })?.toMillis?.();
  if (expiresAt && expiresAt < now) throw new HttpsError('failed-precondition', 'This coupon has expired.');

  // A personal coupon is single-use unless the issuer says otherwise.
  const maxUses = Math.max(1, Number(c.maxUsesPerCoupon ?? 1));
  if (Math.max(0, Number(c.usesCount ?? 0)) >= maxUses) {
    throw new HttpsError('failed-precondition', 'This coupon has already been used.');
  }

  if (subtotalPaise < Number(c.minCartValuePaise ?? 0)) {
    throw new HttpsError('failed-precondition', 'Your cart does not meet this coupon’s minimum.');
  }
  const eligiblePaise = discountableSubtotal(priced, c);
  if (eligiblePaise <= 0) {
    throw new HttpsError('failed-precondition', 'This coupon does not apply to the items in your bag.');
  }

  return couponAmount(c, eligiblePaise);
}

/**
 * Validate a coupon code against a cart → discount in paise. Checks BOTH the
 * promotional `coupons` collection and the customer's personal
 * `customers/{uid}/coupons` (spin/welcome rewards).
 */
async function computeCouponDiscount(code: string | null, priced: PricedLine[], uid: string): Promise<CouponResult> {
  if (!code) return { discountPaise: 0, label: '', couponId: null, userCouponId: null };
  const norm = code.toUpperCase().trim();
  const now = Date.now();

  // 1) Promotional (top-level) coupon.
  const q = await db.collection('coupons').where('code', '==', norm).limit(1).get();
  if (!q.empty) {
    const doc = q.docs[0]!;
    const c = doc.data() as Record<string, unknown>;
    const [custSnap, perUserUses] = await Promise.all([
      db.doc(`customers/${uid}`).get(),
      userCouponUses(uid, doc.id),
    ]);
    const { discountPaise, waiveDelivery } = evaluatePromoCoupon(
      c,
      priced,
      customerFacts(custSnap.data()),
      perUserUses,
      now,
    );
    return { discountPaise, label: (c.code as string) ?? norm, couponId: doc.id, userCouponId: null, waiveDelivery };
  }

  // 2) Customer's personal coupon (won on spin, welcome offer, etc.).
  const uq = await db.collection(`customers/${uid}/coupons`).where('code', '==', norm).limit(1).get();
  if (!uq.empty) {
    const uc = uq.docs[0]!;
    const c = uc.data() as Record<string, unknown>;
    const { discountPaise, waiveDelivery } = evaluateUserCoupon(c, priced, now);
    return {
      discountPaise,
      label: (c.code as string) ?? norm,
      couponId: null,
      userCouponId: uc.id,
      userCouponSource: (c.source as string | undefined) ?? null,
      waiveDelivery,
    };
  }

  throw new HttpsError('not-found', 'That coupon code is not valid.');
}

/**
 * Auto-apply the BEST available offer when the customer didn't enter a code.
 * Scans promotional `coupons` (target 'all') + the customer's personal coupons
 * (spin/welcome rewards) and returns the largest qualifying discount. Never
 * throws — returns a zero result when nothing applies.
 */
async function autoBestOffer(uid: string, priced: PricedLine[]): Promise<CouponResult> {
  const now = Date.now();
  const subtotalPaise = priced.reduce((s, l) => s + l.lineTotalPaise, 0);
  const zero: CouponResult = { discountPaise: 0, label: '', couponId: null, userCouponId: null };
  const candidates: CouponResult[] = [];

  // Promotional coupons (only broadly-targeted ones are auto-applied).
  //
  // Field names MUST match what the admin writes (admin features/coupons/api/
  // coupons.ts): minCartValuePaise, discountMaxCapPaise, validFrom/validUntil.
  // This path previously read minOrderPaise / maxDiscountPaise / expiresAt /
  // noExpiry — none of which any surface writes — so on every auto-applied
  // coupon the minimum cart value, the percent cap and the expiry silently
  // evaluated to "no restriction" and discounted real orders.
  const promos = await db.collection('coupons').where('status', '==', 'active').get();
  promos.forEach((doc) => {
    const c = doc.data() as Record<string, unknown>;
    if (c.targetUsers && c.targetUsers !== 'all') return;
    if (c.autoApply === false) return;
    if (c.active === false) return;

    const validFrom = (c.validFrom as { toMillis?: () => number })?.toMillis?.();
    if (validFrom && validFrom > now) return;
    const validUntil = (c.validUntil as { toMillis?: () => number })?.toMillis?.();
    if (validUntil && validUntil < now) return;

    if (subtotalPaise < Number(c.minCartValuePaise ?? 0)) return;

    const maxTotal = c.maxUsesTotal == null ? null : Number(c.maxUsesTotal);
    if (maxTotal !== null && Math.max(0, Number(c.usesCount ?? 0)) >= maxTotal) return;

    // Per-customer limits need a read we cannot do inside this sync loop. Rather
    // than auto-apply a coupon whose limit we cannot check — there is no second
    // validation after this — such coupons are simply never auto-applied. The
    // customer can still enter the code explicitly, which validates fully.
    if (c.firstOrderOnly === true) return;
    if (Number(c.maxUsesPerUser ?? 0) > 0) return;

    // Category-restricted coupons only discount their own categories' lines.
    const eligiblePaise = discountableSubtotal(priced, c);
    if (eligiblePaise <= 0) return;

    // A free_shipping coupon is worth ₹0 off the subtotal but still worth
    // applying — it waives the delivery fee. Judging candidates on the discount
    // alone silently dropped them here while BOTH clients auto-apply them, so
    // the screen showed free delivery and the server charged it.
    const { discountPaise: d, waiveDelivery } = couponAmount(c, eligiblePaise);
    if (d > 0 || waiveDelivery) {
      candidates.push({ discountPaise: d, label: (c.code as string) ?? '', couponId: doc.id, userCouponId: null, waiveDelivery });
    }
  });

  // Personal coupons (won on spin, welcome offers, etc.).
  const personal = await db.collection(`customers/${uid}/coupons`).where('status', '==', 'active').get();
  personal.forEach((doc) => {
    const c = doc.data() as Record<string, unknown>;
    const expiresAt = (c.expiresAt as { toMillis?: () => number })?.toMillis?.();
    if (expiresAt && expiresAt < now) return;
    // Same per-coupon cap the explicit path enforces — a reward whose uses are
    // spent must not be auto-applied back onto the next order.
    if (Math.max(0, Number(c.usesCount ?? 0)) >= Math.max(1, Number(c.maxUsesPerCoupon ?? 1))) return;
    if (subtotalPaise < Number(c.minCartValuePaise ?? 0)) return;
    const eligiblePaise = discountableSubtotal(priced, c);
    if (eligiblePaise <= 0) return;
    const { discountPaise: d, waiveDelivery } = couponAmount(c, eligiblePaise);
    if (d > 0 || waiveDelivery) {
      candidates.push({
        discountPaise: d,
        label: (c.code as string) ?? '',
        couponId: null,
        userCouponId: doc.id,
        userCouponSource: (c.source as string | undefined) ?? null,
        waiveDelivery,
      });
    }
  });

  // Highest discount wins; a free-delivery coupon (₹0) only wins when nothing
  // else qualifies, which is exactly what `zero` starting the reduce gives us
  // — it can never displace a real discount.
  return candidates.reduce(
    (best, c) => (c.discountPaise > best.discountPaise || (best.discountPaise === 0 && !best.waiveDelivery && (c.discountPaise > 0 || !!c.waiveDelivery)) ? c : best),
    zero,
  );
}

interface Summary {
  subtotalPaise: number;
  discountPaise: number;
  deliveryPaise: number;
  taxPaise: number;
  totalPaise: number;
  walletUsedPaise: number;
  payablePaise: number;
}

/**
 * Server-side mirror of the web computeSummary.
 *
 * No COD surcharge term: cash on delivery is no longer a placeable method, so
 * `settings/delivery.codSurchargePaise` can never apply to a new order. Orders
 * placed while COD existed keep the surcharge they were charged, stored on the
 * order document itself — nothing here recomputes it.
 */
function summarise(
  subtotalPaise: number,
  rawDiscountPaise: number,
  delivery: Record<string, unknown> | undefined,
  tax: Record<string, unknown> | undefined,
  walletBalancePaise: number,
  waiveDelivery = false,
): Summary {
  // Clamp into [0, subtotal] HERE, not just in `net`: this value is stamped on
  // the order (and on `appliedCoupon`), and an over-large flat coupon used to be
  // recorded as a discount bigger than the goods it came off — which then
  // reappeared in the invoice, the affiliate's eligible amount and every report.
  const discountPaise = Math.min(Math.max(0, Math.round(rawDiscountPaise)), Math.max(0, subtotalPaise));
  const net = Math.max(0, subtotalPaise - discountPaise);
  const threshold = Number(delivery?.freeDeliveryOverPaise ?? 0);
  // A free_shipping coupon waives delivery outright — otherwise it would be a
  // coupon that grants nothing at all.
  const freeDelivery = waiveDelivery || subtotalPaise <= 0 || (threshold > 0 && net >= threshold);
  const deliveryPaise = freeDelivery ? 0 : Number(delivery?.standardFeePaise ?? 0);
  let taxPaise = 0;
  if (tax?.gstEnabled && !tax.pricesIncludeTax) taxPaise = Math.round(net * Number(tax.gstRate ?? 0));
  const totalPaise = net + deliveryPaise + taxPaise;
  const walletUsedPaise = walletBalancePaise > 0 ? Math.min(walletBalancePaise, totalPaise) : 0;
  const payablePaise = Math.max(0, totalPaise - walletUsedPaise);
  return { subtotalPaise, discountPaise, deliveryPaise, taxPaise, totalPaise, walletUsedPaise, payablePaise };
}

// ── applyCoupon ────────────────────────────────────────────────────
const ApplyCouponSchema = z.object({ code: z.string().min(1), lines: z.array(Line).min(1) });

export const applyCoupon = onCall(callableOpts, async (req) => {
  const { uid } = requireCustomer(req);
  const parsed = ApplyCouponSchema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const priced = await priceLines(parsed.data.lines);
  const { discountPaise, label, waiveDelivery } = await computeCouponDiscount(parsed.data.code, priced, uid);
  // waiveDelivery must reach the client: a free_shipping coupon carries a zero
  // discount, so without it the storefront total keeps charging delivery while
  // placeOrder waives it, and the two disagree.
  return { discountPaise, label, waiveDelivery: !!waiveDelivery };
});

// ── placeOrder ─────────────────────────────────────────────────────
/** How long a derived (nonce-less) signature blocks a repeat placement. */
const AUTO_NONCE_WINDOW_MS = 2 * 60 * 1000;

/** Short, filename-safe digest so any nonce is a valid document id. */
function hashKey(s: string): string {
  return createHmac('sha256', 'barakath-idempotency').update(s).digest('hex').slice(0, 32);
}

/** Identity of a cart/reservation line: a product + one of its variants. */
function lineKey(productId: string, variantId: string | null): string {
  return `${productId}#${variantId ?? ''}`;
}

const PlaceOrderSchema = z.object({
  lines: z.array(Line).min(1),
  addressId: z.string().min(1),
  /**
   * 'razorpay' — pay the balance online (the wallet may still cover part of it).
   * 'wallet'   — pay the order entirely from the wallet; rejected below when the
   *              balance does not cover the total, so it can never silently
   *              become an unpaid order.
   * 'cod'      — accepted by the SCHEMA only so a stale client build gets the
   *              real "no longer available" message instead of a generic
   *              "Invalid checkout request"; the handler rejects it outright.
   */
  paymentMethod: z.enum(['razorpay', 'wallet', 'cod']),
  couponCode: z.string().nullable().optional(),
  /**
   * Explicit "the customer wants no coupon". `couponCode: null` still means
   * "auto-apply the best offer" (the app relies on that); a client that does its
   * own offer selection — and therefore shows a total with no discount — sends
   * noCoupon: true (or couponCode: '') so removing a coupon really removes it
   * instead of silently burning a one-time spin reward.
   */
  noCoupon: z.boolean().optional(),
  useWallet: z.boolean().optional(),
  customerNote: z.string().max(500).nullable().optional(),
  placementNonce: z.string().optional(),
  /**
   * Stock hold taken by reserveStock when the customer entered checkout. When it
   * is still valid the stock for these lines has ALREADY been decremented, so
   * this order consumes the hold instead of decrementing a second time. An
   * expired/missing/foreign reservation is ignored and the classic
   * validate-and-decrement path runs unchanged.
   */
  reservationId: z.string().nullable().optional(),
});

export const placeOrder = onCall(callableOpts, async (req) => {
  const { uid } = await requireActiveCustomer(req);
  const parsed = PlaceOrderSchema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid checkout request.');
  const { lines, addressId, paymentMethod, couponCode, useWallet, customerNote } = parsed.data;

  // Cash on delivery has been withdrawn. Rejected here rather than by the zod
  // enum so an app/web build still shipping 'cod' gets an explanation it can
  // show the customer; every path that READS an existing COD order (delivery
  // capture, cancellation, refund, invoice) is untouched.
  if (paymentMethod === 'cod') {
    throw new HttpsError(
      'failed-precondition',
      'Cash on delivery is no longer available. Please pay online or from your wallet.',
    );
  }

  // Cart ceilings, BEFORE any product is read: an oversized cart must be
  // refused for free, not after fifty document reads. The clients mirror these
  // limits, but this is the authority — the callable is directly invocable.
  assertCartLimits(lines);

  // Reads (outside the txn): pricing, coupon, settings.
  const priced = await priceLines(lines);
  const subtotalPaise = priced.reduce((s, l) => s + l.lineTotalPaise, 0);

  // Explicit code → validate it. Explicit "none" (noCoupon / empty string) →
  // no discount at all. Absent code (null/undefined) → auto-apply the best offer.
  const explicitlyNoCoupon = parsed.data.noCoupon === true || couponCode === '';
  const noOffer: CouponResult = { discountPaise: 0, label: '', couponId: null, userCouponId: null };
  // This resolves WHICH coupon (and rejects an invalid code with the message the
  // customer sees). The AMOUNT it returns is provisional: the transaction below
  // re-evaluates the very same rules against the locked documents and uses that
  // result, so nothing between this read and the commit can be paid out.
  const { label: couponLabel, couponId, userCouponId, userCouponSource } = couponCode
    ? await computeCouponDiscount(couponCode, priced, uid)
    : explicitlyNoCoupon
      ? noOffer
      : await autoBestOffer(uid, priced);
  const [deliverySnap, taxSnap, gatewaySnap] = await Promise.all([
    db.doc('settings/delivery').get(),
    db.doc('settings/tax').get(),
    db.doc('settings/paymentGateway').get(),
  ]);
  const delivery = deliverySnap.data();
  const tax = taxSnap.data();

  // Payment availability is admin-controlled (Settings ▸ Payment gateway), and
  // until now it was honoured by the clients ALONE — a checkout screen loaded
  // before the toggle changed, or any direct callable invocation, could place an
  // order with a method the admin had switched off, decrementing stock for money
  // the store never agreed to take. A missing settings doc means "everything
  // on", exactly as both clients assume.
  const gateway = gatewaySnap.data() ?? {};
  const walletEnabled = gateway.walletEnabled !== false;
  if (paymentMethod === 'wallet') {
    // Paying from the wallet IS the chosen method here, so a disabled wallet is
    // a hard stop — there is no other tender on this order to fall back to.
    if (!walletEnabled) {
      throw new HttpsError('failed-precondition', 'Wallet payment is currently unavailable.');
    }
  } else if (gateway.onlinePaymentEnabled === false) {
    throw new HttpsError('failed-precondition', 'Online payment is currently unavailable.');
  }
  // For a razorpay order the wallet is a payment aid, not the customer's chosen
  // method — with it switched off the request is fulfilled without the wallet
  // rather than rejected, mirroring both clients (they silently clear
  // `useWallet`). A 'wallet' order always draws on it.
  const walletRequested =
    walletEnabled && (paymentMethod === 'wallet' || useWallet === true);

  // Idempotency key. A client-supplied nonce is authoritative; without one we
  // derive a signature from the cart so an old client's double-submit is still
  // caught. Scoped per customer so nonces can never collide across accounts.
  const nonce =
    parsed.data.placementNonce ??
    `auto:${addressId}:${paymentMethod}:${lines
      .map((l) => `${l.productId}#${l.variantId ?? ''}x${l.qty}`)
      .sort()
      .join('|')}`;
  const idemRef = db.doc(`idempotencyKeys/${uid}__${hashKey(nonce)}`);

  // The order's document id is allocated HERE, before the transaction — it is a
  // pure client-side id with no I/O. Two things need it up front: the commission
  // row is keyed by order id (that is its idempotency key), and a key can only
  // be checked in the read phase if it exists before the first read. A
  // transaction retry therefore reuses the same id and re-sets the same
  // documents, instead of minting a second order id per attempt.
  const orderRef = db.collection('orders').doc();

  // Set on the attempt that actually creates the order (never on a replay), so
  // the post-transaction invoice step knows whether there is anything to do. A
  // transaction retry simply overwrites it; a transaction that never commits
  // throws before this value is ever read.
  let placedFresh: {
    orderId: string;
    paymentMethod: string;
    shortId: string;
    /** Referrer + accrual, for the affiliate's "commission earned" notification. */
    affiliateUid: string | null;
    commissionPaise: number;
  } | null = null;

  const result = await db.runTransaction(async (tx) => {
    placedFresh = null;
    // Replay check must happen before any write in this transaction.
    const idemSnap = await tx.get(idemRef);
    if (idemSnap.exists) {
      const prior = idemSnap.data() as Record<string, unknown>;
      const placedMs = (prior.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
      // An explicit nonce dedupes forever; a derived signature only guards the
      // double-click window, so re-ordering the same cart later still works.
      const withinWindow =
        !!parsed.data.placementNonce || Date.now() - placedMs < AUTO_NONCE_WINDOW_MS;
      if (withinWindow) {
        return {
          orderId: String(prior.orderId ?? ''),
          shortId: String(prior.shortId ?? ''),
          amountPaise: Number(prior.amountPaise ?? 0),
          paymentMethod: String(prior.paymentMethod ?? paymentMethod),
          replayed: true,
        };
      }
    }

    // Customer + address + wallet.
    const custRef = db.doc(`customers/${uid}`);
    const custSnap = await tx.get(custRef);
    if (!custSnap.exists) throw new HttpsError('failed-precondition', 'Complete your profile before ordering.');
    const cust = custSnap.data() as Record<string, unknown>;
    const addresses = (cust.addresses as Array<Record<string, unknown>>) ?? [];
    const address = addresses.find((a) => a.id === addressId);
    if (!address) throw new HttpsError('failed-precondition', 'Choose a delivery address.');
    const walletBalance = Number((cust.wallet as Record<string, unknown>)?.balancePaise ?? 0);
    // The slice of that balance that arrived as CASHBACK (spin prizes) — see
    // Wallet.cashbackBalancePaise. It spends like any other rupee but is never
    // refundable, so it has to be tracked separately from placement onwards.
    // Clamped to the balance and floored at zero: wallets created before the
    // field existed carry nothing (→ 0, fully refundable, deliberately not
    // back-filled), and adminAdjustWallet debits the balance without touching
    // the pool, which can leave a stale pool larger than the balance it
    // describes.
    const cashbackPool = Math.max(
      0,
      Math.min(Number((cust.wallet as Record<string, unknown>)?.cashbackBalancePaise ?? 0), walletBalance),
    );

    // Re-read products inside the txn to check + decrement stock safely.
    // Grouped by product id: a cart can hold two variants of the SAME product
    // (lines are keyed by productId+variantId), and one `tx.update` per line
    // would write the whole `variants` array twice from the same pre-transaction
    // snapshot — the second write silently discarding the first decrement.
    const productIds = [...new Set(priced.map((l) => l.productId))];
    const productSnaps = await Promise.all(productIds.map((id) => tx.get(db.doc(`products/${id}`))));

    // Coupons are resolved outside the transaction (a query cannot run inside
    // one), so their redemption limits were checked against a stale read. Re-read
    // the resolved documents here — inside the transaction's read set — so two
    // concurrent checkouts contend instead of both spending a single-use coupon.
    const promoRef = couponId ? db.doc(`coupons/${couponId}`) : null;
    const promoSnap = promoRef ? await tx.get(promoRef) : null;
    const promoUsageSnap = couponId
      ? await tx.get(db.doc(`customers/${uid}/couponUsage/${couponId}`))
      : null;
    const userCouponRef = userCouponId ? db.doc(`customers/${uid}/coupons/${userCouponId}`) : null;
    const userCouponSnap = userCouponRef ? await tx.get(userCouponRef) : null;

    // Stock reservation taken when the customer entered checkout. This is a
    // READ, so it belongs here in the read phase — before anything is written.
    // A reservation is only honoured when it is active, owned by the caller, not
    // yet expired, and holds at least the quantity of every ordered line; any
    // other case falls through to the classic validate-and-decrement path, which
    // behaves exactly as it did before reservations existed.
    const reservationId = parsed.data.reservationId || null;
    const reservationRef = reservationId ? db.doc(`${RESERVATIONS}/${reservationId}`) : null;
    const reservationSnap = reservationRef ? await tx.get(reservationRef) : null;
    let useReservation = false;
    /**
     * Units the hold covers that this order does NOT buy — the bag was edited
     * after checkout was entered (a line removed, a quantity reduced) on another
     * surface sharing `customers/{uid}.cart`, and the client never re-reserved.
     *
     * They are already out of the catalogue, and consuming the reservation puts
     * it beyond BOTH safety nets — releaseStock returns early and
     * stockReservationSweep only queries `status == 'active'`. So the surplus is
     * unsellable forever unless this transaction hands it back itself.
     */
    const surplusLines: ReservationLine[] = [];
    if (reservationSnap?.exists) {
      const r = reservationSnap.data() as Record<string, unknown>;
      const expiresMs = (r.expiresAt as Timestamp | undefined)?.toMillis?.() ?? 0;
      if (r.customerId === uid && r.status === 'active' && expiresMs > Date.now()) {
        // Keep productId/variantId next to the quantity, not just the key: the
        // surplus must be credited back to the exact variant row it came from.
        const held = new Map<string, ReservationLine>();
        for (const l of reservationLines(r)) {
          const k = lineKey(l.productId, l.variantId);
          const cur = held.get(k);
          if (cur) cur.qty += l.qty;
          else held.set(k, { ...l });
        }
        const wanted = new Map<string, number>();
        for (const l of priced) {
          const k = lineKey(l.productId, l.variantId);
          wanted.set(k, (wanted.get(k) ?? 0) + l.qty);
        }
        useReservation = [...wanted].every(([k, qty]) => (held.get(k)?.qty ?? 0) >= qty);
        if (useReservation) {
          for (const [k, h] of held) {
            const spare = h.qty - (wanted.get(k) ?? 0);
            if (spare > 0) surplusLines.push({ ...h, qty: spare });
          }
        }
      }
    }
    // A dropped line can name a product this order does not touch at all, so its
    // document is absent from `productSnaps`. Read it now — still the read phase,
    // before the first write below.
    const surplusOnlyIds = [...new Set(surplusLines.map((l) => l.productId))].filter(
      (id) => !productIds.includes(id),
    );
    const surplusOnlySnaps = await Promise.all(
      surplusOnlyIds.map((id) => tx.get(db.doc(`products/${id}`))),
    );
    // Grouped per product document for the same reason every stock path here is:
    // two variants of ONE product have to be credited into a single copy of its
    // `variants` array, or one of the two credits is silently discarded.
    const surplusByProduct = groupLinesByProduct(surplusLines);

    // ── Referral attribution (all reads, before any write) ──────────
    //
    // SINGLE SOURCE OF TRUTH: the standing referral on customers/{uid}.referredBy,
    // written once by linkReferral at sign-up and permanent thereafter. There is
    // no per-order referral code any more — attribution is a property of the
    // CUSTOMER, so every eligible order they ever place earns for the same
    // affiliate without the client having to send anything.
    const standing = (cust.referredBy as { affiliateUid?: string; affiliateCode?: string } | null) ?? null;

    // Read the affiliate inside the transaction — the link was made at sign-up
    // and the affiliate may have been disabled since. Null here means "no longer
    // an enabled affiliate": the order is still STAMPED with the link below (so
    // the relationship stays visible), it simply earns nothing. A stale link
    // must never block a checkout that has nothing to do with the affiliate.
    const affiliateSnap = await readReferringAffiliate(tx, standing);
    // Commission is keyed by order id — read it in the read phase so accrual can
    // be skipped if a row somehow already exists for this order (see
    // accrueCommission: this is what makes a duplicate write a no-op rather than
    // a second credit).
    const existingCommission = affiliateSnap ? await readOrderCommission(tx, orderRef.id) : null;

    // ── Re-assert the coupon against the LOCKED documents ────────────
    //
    // This — not the pre-transaction read — is the authoritative evaluation.
    // Every rule the admin can set runs again here (evaluatePromoCoupon /
    // evaluateUserCoupon), against documents inside this transaction's read set,
    // and the amount it returns is the amount the order is priced at. Two
    // concurrent checkouts therefore contend on the coupon document instead of
    // both spending a single-use coupon, and an admin edit landing mid-checkout
    // cannot be paid out at the old terms.
    //
    // An EXPLICIT code that fails here is an error the customer must see (they
    // chose it, and the total on their screen assumed it). An AUTO-APPLIED offer
    // that fails is silently dropped instead — auto-apply is the server's own
    // suggestion and must never be the reason an order cannot be placed.
    const autoApplied = !couponCode;
    let discountPaise = 0;
    let waiveDelivery = false;
    let redeemPromo = false;
    let redeemUserCoupon = false;
    if (couponId) {
      try {
        const c = promoSnap?.data() as Record<string, unknown> | undefined;
        if (!c) throw new HttpsError('failed-precondition', 'This coupon is no longer available.');
        const evaluated = evaluatePromoCoupon(
          c,
          priced,
          customerFacts(cust),
          usageCount(promoUsageSnap),
          Date.now(),
        );
        discountPaise = evaluated.discountPaise;
        waiveDelivery = evaluated.waiveDelivery;
        redeemPromo = true;
      } catch (err) {
        if (!autoApplied) throw err;
        // Auto-apply is the server's own suggestion: the customer never asked
        // for it, and the client already showed a total without it. Log and
        // carry on with no discount rather than failing the checkout.
        logger.warn(`placeOrder: auto-applied offer dropped for ${uid}`, err);
      }
    } else if (userCouponId) {
      try {
        const c = userCouponSnap?.data() as Record<string, unknown> | undefined;
        if (!c) throw new HttpsError('failed-precondition', 'This coupon is no longer available.');
        const evaluated = evaluateUserCoupon(c, priced, Date.now());
        discountPaise = evaluated.discountPaise;
        waiveDelivery = evaluated.waiveDelivery;
        redeemUserCoupon = true;
      } catch (err) {
        if (!autoApplied) throw err;
        // Auto-apply is the server's own suggestion: the customer never asked
        // for it, and the client already showed a total without it. Log and
        // carry on with no discount rather than failing the checkout.
        logger.warn(`placeOrder: auto-applied offer dropped for ${uid}`, err);
      }
    }
    // A coupon that did not survive the re-assert must not be stamped on the
    // order either — the identity recorded below has to describe a redemption
    // that actually happened, or cancellation would release a use nobody took.
    const appliedPromoId = redeemPromo ? couponId : null;
    const appliedUserCouponId = redeemUserCoupon ? userCouponId : null;
    const appliedCouponCode = appliedPromoId || appliedUserCouponId ? couponLabel : null;

    const summary = summarise(
      subtotalPaise,
      discountPaise,
      delivery,
      tax,
      walletRequested ? walletBalance : 0,
      waiveDelivery,
    );

    // Spin/wheel coupon savings realised at checkout feed the wallet "Rewards"
    // tally (a running total of reward value, not a spendable balance credit).
    // Taken from the SUMMARY, so the tally can never claim more saving than the
    // order actually got (summarise clamps the discount to the subtotal).
    const spinRewardPaise =
      appliedUserCouponId && userCouponSource === 'spin' ? summary.discountPaise : 0;

    // Split the wallet payment by what funded it. CASHBACK IS SPENT FIRST:
    // "Refund their amount only. Cashback or discounted amount never returns to
    // wallet." Spending the prize first means the customer keeps the benefit of
    // it immediately, and what is left in the wallet afterwards is the money the
    // store genuinely owes them back. Both halves are stamped on the order below
    // so refunds, cancellation and the admin never have to recompute this from a
    // balance that has moved on since.
    const walletCashbackPaise = Math.min(cashbackPool, summary.walletUsedPaise);
    const walletRealPaise = summary.walletUsedPaise - walletCashbackPaise;

    // Order-value ceiling, applied to the FINAL total — the one the customer is
    // actually charged, after the coupon has been re-asserted against the locked
    // documents and delivery/tax added. Checking a pre-discount figure would
    // refuse orders the store is happy to take.
    assertOrderTotalLimit(summary.totalPaise);

    // A 'wallet' order must be paid IN FULL from the balance — there is no
    // second tender on it, so anything left over would become an order nobody
    // can ever collect on (no gateway order can be opened for it: see
    // createRazorpayOrder, which only serves paymentMethod 'razorpay').
    if (paymentMethod === 'wallet' && summary.payablePaise > 0) {
      throw new HttpsError(
        'failed-precondition',
        'Your wallet balance does not cover this order. Please pay online.',
      );
    }

    // shortId counter.
    const counterRef = db.doc('counters/orders');
    const counterSnap = await tx.get(counterRef);
    const seq = Number(counterSnap.get('seq') ?? 48000) + 1;
    const shortId = `#BRK-${seq}`;

    // Validate + decrement stock — exactly one update per product document, with
    // every line of that product applied to a single copy of its variants array.
    productIds.forEach((productId, i) => {
      const snap = productSnaps[i]!;
      const productLines = priced.filter((l) => l.productId === productId);
      if (!snap.exists) throw new HttpsError('failed-precondition', `${productLines[0]!.name} is unavailable.`);
      if (useReservation) {
        // reserveStock already took this product's units out of the catalogue
        // (top-level counter AND the variants[] rows) — decrementing again here
        // would remove them twice. The lifetime units-sold counter still has to
        // move: a reservation is a hold, this is the sale.
        const upd: Record<string, unknown> = {
          soldCount: FieldValue.increment(productLines.reduce((s, l) => s + l.qty, 0)),
          updatedAt: FieldValue.serverTimestamp(),
        };
        // …and any of this product's held units the order did not buy go back in
        // the SAME update, so the document is still written exactly once. Nothing
        // above staged a `stock` delta, which is what makes the merge safe.
        mergeRestoreIntoUpdate(upd, snap, surplusByProduct.get(productId) ?? []);
        tx.update(snap.ref, upd);
        return;
      }
      const p = snap.data() as Record<string, unknown>;
      const variants = ((p.variants as Array<Record<string, unknown>>) ?? []).map((v) => ({ ...v }));
      let totalQty = 0;
      let plainQty = 0;
      let touchedVariants = false;
      for (const l of productLines) {
        totalQty += l.qty;
        if (l.variantId) {
          const v = variants.find((x) => x.id === l.variantId);
          if (!v || Number(v.stock ?? 0) < l.qty) throw new HttpsError('failed-precondition', `${l.name} is out of stock.`);
          v.stock = Number(v.stock) - l.qty;
          touchedVariants = true;
        } else {
          plainQty += l.qty;
        }
      }
      if (plainQty > 0 && Number(p.stock ?? 0) < plainQty) {
        throw new HttpsError('failed-precondition', `${productLines[0]!.name} is out of stock.`);
      }
      const upd: Record<string, unknown> = {
        // Lifetime units sold — nothing else maintains it, so the storefront
        // "Popularity" sort and the admin category chart read 0 forever.
        soldCount: FieldValue.increment(totalQty),
        updatedAt: FieldValue.serverTimestamp(),
      };
      // ONLY variant-less quantity moves the top-level counter. `products.stock`
      // is not an aggregate over `variants[]`: once a product has variants every
      // other surface stops reading it (admin totalStock/deriveProductStatus,
      // web inStock/lineStock, the Flutter app, adminAdjustStock) and the admin
      // form clears it to 0 on conversion. Decrementing it by variant quantity
      // drove it steadily negative, and a negative base SKU is unrecoverable:
      // adminAdjustStock rejects the whole batch as underflow, and if the
      // product is ever converted back to variant-less it is permanently
      // unsellable.
      if (plainQty > 0) upd.stock = FieldValue.increment(-plainQty);
      if (touchedVariants) upd.variants = variants;
      tx.update(snap.ref, upd);
    });

    // Surplus sitting on products this order does not buy at all (a whole line
    // left the bag while the hold was open). The loop above never touches these
    // documents, so restoring them here still writes each of them exactly once.
    if (surplusOnlyIds.length > 0) {
      restoreReservedStock(
        tx,
        new Map(surplusOnlyIds.map((id, i) => [id, surplusOnlySnaps[i]!])),
        surplusLines.filter((l) => surplusOnlyIds.includes(l.productId)),
      );
    }

    // Debit wallet (if used), accrue the spin-reward tally and bump the lifetime
    // order stats — one write. Nothing else maintains `stats.*` after signup, so
    // without this the firstOrderOnly coupon guard above and the admin Customers
    // list both see 0 orders forever.
    const custUpdate: Record<string, unknown> = {};
    if (summary.walletUsedPaise > 0) {
      custUpdate['wallet.balancePaise'] = FieldValue.increment(-summary.walletUsedPaise);
      custUpdate['wallet.lifetimeDebitsPaise'] = FieldValue.increment(summary.walletUsedPaise);
      // Drain the live cashback pool by the part of this payment it funded.
      // Written as an ABSOLUTE value derived from the clamped read above rather
      // than FieldValue.increment(-x): that both keeps the pool inside
      // [0, balance] on this write and repairs any earlier drift, where a bare
      // decrement would preserve it. `cashbackPool - walletCashbackPaise` is ≥ 0
      // by construction (walletCashbackPaise ≤ cashbackPool) and ≤ the new
      // balance (cashbackPool ≤ walletBalance).
      custUpdate['wallet.cashbackBalancePaise'] = cashbackPool - walletCashbackPaise;
      custUpdate['wallet.lastTransactionAt'] = FieldValue.serverTimestamp();
    }
    if (spinRewardPaise > 0) {
      custUpdate['wallet.breakdown.rewardsPaise'] = FieldValue.increment(spinRewardPaise);
      custUpdate['wallet.lastTransactionAt'] = FieldValue.serverTimestamp();
    }
    custUpdate['stats.ordersCount'] = FieldValue.increment(1);
    custUpdate['stats.totalSpentPaise'] = FieldValue.increment(summary.totalPaise);
    custUpdate['stats.lastOrderAt'] = FieldValue.serverTimestamp();
    if (!(cust.stats as Record<string, unknown> | undefined)?.firstOrderAt) {
      custUpdate['stats.firstOrderAt'] = FieldValue.serverTimestamp();
    }
    custUpdate['updatedAt'] = FieldValue.serverTimestamp();
    tx.update(custRef, custUpdate);

    // Order doc.
    const now = FieldValue.serverTimestamp();
    const days = Number(delivery?.deliveryDaysMax ?? 5);
    const expected = Timestamp.fromMillis(Date.now() + days * 86400_000);
    // Nothing left to collect — the wallet covered the order outright, or the
    // discount took it to zero. With COD gone there is no "collect it later"
    // tender at all, so such an order must be recorded as a settled wallet
    // payment; leaving it 'pending' would strand it (createRazorpayOrder refuses
    // an order with nothing to pay, and nothing else ever settles one).
    const fullyWalletPaid = summary.payablePaise === 0;
    const effectivePaymentMethod = fullyWalletPaid ? 'wallet' : paymentMethod;
    const paymentStatus = fullyWalletPaid ? 'captured' : 'pending';

    // Full line items embedded on the order document (single-document model).
    // Each carries a stable `id` (used by the returns flow to address one line).
    // Firestore forbids serverTimestamp inside array elements, so there is no
    // per-item createdAt — array order preserves the cart order.
    const items = priced.map((l, i) => ({
      id: `${orderRef.id}_${i}`,
      productId: l.productId, productName: l.name, productDisplayTitle: l.displayTitle,
      imageUrl: l.imageUrl, categoryTint: l.categoryTint, category: l.category,
      variantId: l.variantId, variantLabel: l.variantLabel, quantity: l.qty,
      mrpPaise: l.mrpPaise, offerPricePaise: l.offerPricePaise, lineTotalPaise: l.lineTotalPaise,
      discountAppliedPaise: 0, taxPaise: 0, hsnCode: null, weight: 0,
      returnStatus: 'none', returnRequestId: null, reviewSubmitted: false, reviewId: null,
      // Affiliate economics as advertised at purchase time. Commission accrues
      // from THESE values, not from the live catalogue, so re-pricing a product
      // later never changes what an affiliate already earned — and the number on
      // the order always explains the number in the commission row.
      commissionPaise: l.commissionPaise,
      affiliateCommissionRate: l.affiliateCommissionRate,
      isAffiliateEligible: l.isAffiliateEligible,
    }));

    const order: Record<string, unknown> = {
      id: orderRef.id,
      shortId,
      customerId: uid,
      customerName: (cust.name as string) || 'Customer',
      customerPhone: (cust.phone as string) || '',
      status: 'accepted',
      itemsCount: priced.reduce((s, l) => s + l.qty, 0),
      itemsSummary: priced.slice(0, 4).map((l) => ({
        productId: l.productId, productName: l.name, imageUrl: l.imageUrl, categoryTint: l.categoryTint, quantity: l.qty,
      })),
      items,
      subtotalPaise: summary.subtotalPaise,
      discountPaise: summary.discountPaise,
      spinRewardPaise,
      walletUsedPaise: summary.walletUsedPaise,
      // How the wallet payment was funded (they sum to walletUsedPaise).
      // walletRealPaise is the ONLY wallet money a refund may return; the
      // cashback half was a prize, not a payment, and stays with the store.
      walletCashbackPaise,
      walletRealPaise,
      deliveryPaise: summary.deliveryPaise,
      // Always 0 now that COD cannot be chosen. The field is still written (not
      // dropped) because every reader — admin order detail, both storefronts,
      // the invoice renderer — expects it on the Order shape, and orders placed
      // while COD existed still carry a non-zero value here.
      codSurchargePaise: 0,
      taxPaise: summary.taxPaise,
      totalPaise: summary.totalPaise,
      amountPaidPaise: summary.walletUsedPaise,
      paymentMethod: effectivePaymentMethod,
      paymentStatus,
      razorpayOrderId: null,
      razorpayPaymentId: null,
      razorpaySignature: null,
      appliedCoupon:
        appliedPromoId || appliedUserCouponId
          ? {
              code: couponLabel,
              couponId: appliedPromoId,
              userCouponId: appliedUserCouponId,
              discountPaise: summary.discountPaise,
              source: appliedUserCouponId ? 'spin' : 'promotional',
            }
          : null,
      // The same identity, flat on the order document.
      //
      // `appliedCoupon` is a nested object, which makes it invisible to every
      // `where('couponId', '==', …)` query and to anyone reading the order in
      // the console — an audit of "who redeemed this coupon" had to open and
      // parse each order by hand. These three fields are the queryable mirror;
      // they are written from exactly the same values, so they can never
      // disagree with the nested copy or with the counters incremented below.
      couponId: appliedPromoId,
      userCouponId: appliedUserCouponId,
      couponCode: appliedCouponCode,
      /** Set by performCancellation when it hands the redemption back, so the
       *  release can never run twice on one order. */
      couponReleasedAt: null,
      deliveryAddress: address,
      courier: null, trackingId: null, rider: null,
      shippedAt: null, outForDeliveryAt: null, deliveredAt: null,
      expectedDeliveryDate: expected,
      cancelledAt: null, cancellationReason: null, cancelledByUid: null,
      // The referrer is stamped on the order (not re-derived later), so
      // commission accrual, reversal and every admin/affiliate screen agree on
      // who this order belongs to even if the customer's link changes after.
      referredByAffiliateUid: standing?.affiliateUid ?? null,
      referralCode: standing?.affiliateCode ?? null,
      /** Always 'standing' now — customers/{uid}.referredBy is the only source.
       * ('order_code' survives on orders placed while checkout accepted a code.) */
      referralSource: standing?.affiliateUid ? 'standing' : null,
      affiliateCommissionPaise: 0,
      affiliateCommissionStatus: null,
      placementNonce: parsed.data.placementNonce ?? orderRef.id,
      customerNote: customerNote ?? null,
      adminNote: null,
      invoiceUrl: null, invoiceGeneratedAt: null,
      searchIndex: [shortId.toLowerCase(), ((cust.name as string) || '').toLowerCase(), (cust.phone as string) || ''].filter(Boolean),
      placedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    // Carried out of the transaction for the affiliate notification below.
    let accruedCommissionPaise = 0;
    // Accrue the referrer's commission on merchandise value (post-discount,
    // excluding delivery and tax) and stamp it on the order. This runs on EVERY
    // order the customer places, because the link is standing — nothing about
    // this checkout has to carry the affiliate for them to be paid.
    if (affiliateSnap) {
      const eligiblePaise = Math.max(0, subtotalPaise - summary.discountPaise);
      // Per-line inputs come from the items we just embedded on the order — the
      // catalogue is never re-read for money. The order-level discount is
      // allocated across lines in proportion to line value so a rate-based line
      // earns on what the customer actually paid for it; a flat per-unit
      // commission ignores the allocation by design (see lineAccrual).
      const commissionLines: CommissionLine[] = items.map((it) => ({
        productId: it.productId,
        variantId: it.variantId,
        qty: it.quantity,
        eligiblePaise:
          subtotalPaise > 0
            ? Math.max(0, Math.floor((it.lineTotalPaise * eligiblePaise) / subtotalPaise))
            : 0,
        commissionPaise: it.commissionPaise,
        productCommissionRate: it.affiliateCommissionRate,
        affiliateEligible: it.isAffiliateEligible,
      }));
      const commissionPaise = accrueCommission(tx, {
        affiliateSnap,
        orderId: orderRef.id,
        orderShortId: shortId,
        eligiblePaise,
        orderTotalPaise: summary.totalPaise,
        referredCustomerUid: uid,
        referredCustomerFirstName: String((cust.name as string) ?? '').split(' ')[0] ?? '',
        lines: commissionLines,
        existingCommission,
      });
      if (commissionPaise > 0) {
        order.affiliateCommissionPaise = commissionPaise;
        order.affiliateCommissionStatus = 'pending';
        accruedCommissionPaise = commissionPaise;
      }
    }

    tx.set(orderRef, order);

    // Consume the stock hold in the SAME transaction that creates the order: the
    // held units now belong to this order, so the sweep (and releaseStock) must
    // never hand them back. Marking it here also makes the hold single-use — a
    // second order can never claim the same reservation.
    // Safe precisely because the write phase above already returned the surplus
    // (`surplusLines`): once this flips to 'consumed' nothing else ever will.
    if (useReservation && reservationRef) {
      tx.update(reservationRef, { status: 'consumed', orderId: orderRef.id, updatedAt: now });
    }

    // Payment record. The `payments` collection had no writer at all, so the
    // admin Payments page and the GST invoice export were permanently empty.
    // Keyed by order id (one payment per order, as the seed data is), which also
    // makes the write idempotent — a replay lands on the same document.
    // amountPaise is what actually moves through this method: the collectable
    // amount, or the wallet debit when the wallet covers the order outright.
    const paymentRef = db.doc(`payments/${orderRef.id}`);
    tx.set(paymentRef, {
      id: paymentRef.id,
      orderId: orderRef.id,
      orderShortId: shortId,
      customerId: uid,
      method: effectivePaymentMethod,
      gateway: effectivePaymentMethod === 'razorpay' ? 'razorpay' : null,
      // A razorpay order is collected by verifyPayment, so it starts pending; a
      // wallet-covered order is money that has already moved.
      status: paymentStatus,
      amountPaise: summary.payablePaise > 0 ? summary.payablePaise : summary.walletUsedPaise,
      gatewayRef: null,
      createdAt: now,
      updatedAt: now,
    });

    // Claim the idempotency key in the same transaction as the order, so a
    // retry can never produce a second order with a second stock/wallet hit.
    tx.set(idemRef, {
      id: idemRef.id,
      customerId: uid,
      orderId: orderRef.id,
      shortId,
      // The fresh path returns payablePaise (what is still to be collected), so
      // a replay must return the same number — storing totalPaise made a
      // recovered order overstate the amount due by the wallet amount.
      amountPaise: summary.payablePaise,
      paymentMethod: effectivePaymentMethod,
      createdAt: now,
    });

    // Line items are embedded on the order document above (single-document
    // model) — no per-item subcollection is written.

    // Timeline.
    const tlRef = db.collection(`orders/${orderRef.id}/timeline`).doc();
    tx.set(tlRef, { id: tlRef.id, status: 'accepted', at: now, byUid: 'system', note: 'Order placed', createdAt: now });

    // Mark a personal (spin/welcome) coupon as used.
    //
    // `maxUsesPerCoupon` (written by executeSpin) is honoured: the status only
    // flips to 'used' once the coupon's uses are actually spent, so a
    // multi-use reward is not destroyed by its first redemption. The counter is
    // written as an ABSOLUTE value derived from the snapshot read inside this
    // transaction rather than FieldValue.increment(1) — that keeps it in step
    // with the status flip decided from the same number, and repairs any drift
    // rather than carrying it forward.
    if (appliedUserCouponId && userCouponRef) {
      const uc = (userCouponSnap?.data() as Record<string, unknown> | undefined) ?? {};
      const maxUses = Math.max(1, Number(uc.maxUsesPerCoupon ?? 1));
      const usesAfter = Math.max(0, Number(uc.usesCount ?? 0)) + 1;
      tx.update(userCouponRef, {
        status: usesAfter >= maxUses ? 'used' : 'active',
        usedAt: now, usedOnOrderId: orderRef.id, usedOnOrderShortId: shortId,
        usesCount: usesAfter, isNew: false, updatedAt: now,
      });
    }

    // Wallet spend on this order — log a debit ledger row so it shows in the
    // wallet history as "Used on order …" (−amount). Mirrors the balance debit
    // written above; without this the spend never appears in the transaction list.
    if (summary.walletUsedPaise > 0) {
      const spendRef = db.collection(`customers/${uid}/walletTransactions`).doc();
      tx.set(spendRef, {
        id: spendRef.id, type: 'debit', source: 'order_payment', amountPaise: summary.walletUsedPaise,
        balanceAfterPaise: Math.max(0, walletBalance - summary.walletUsedPaise),
        title: `Used on order ${shortId}`, description: null,
        orderId: orderRef.id, orderShortId: shortId, refType: 'order', refId: orderRef.id,
        createdAt: now,
      });
    }

    // Spin/wheel reward realised — log a ledger row so it shows in wallet
    // history. It records reward *value* earned, not a balance movement, so
    // balanceAfterPaise is the balance after this order (unchanged by the reward).
    if (spinRewardPaise > 0) {
      const rewardRef = db.collection(`customers/${uid}/walletTransactions`).doc();
      tx.set(rewardRef, {
        id: rewardRef.id, type: 'credit', source: 'spin_reward', amountPaise: spinRewardPaise,
        balanceAfterPaise: Math.max(0, walletBalance - summary.walletUsedPaise),
        title: `Spin reward · saved on ${shortId}`, description: couponLabel || null,
        orderId: orderRef.id, orderShortId: shortId, refType: 'coupon', refId: appliedUserCouponId,
        createdAt: now,
      });
    }

    // Promotional coupon redemption — without these counters the maxUsesTotal
    // and maxUsesPerUser limits validated above could never actually trip.
    //
    // Both are written as ABSOLUTE values derived from the snapshots read inside
    // this transaction (and floored at zero), not as blind increments: that is
    // what stops a counter which drifted negative — see the release path in
    // orders/cancel.ts — from silently granting redemptions beyond the limit,
    // and it repairs the drift on the next legitimate use instead of preserving
    // it. Correctness is unaffected by the choice: both documents are in this
    // transaction's read set, so a concurrent checkout retries rather than
    // interleaves.
    if (appliedPromoId && promoRef) {
      const c = (promoSnap?.data() as Record<string, unknown> | undefined) ?? {};
      tx.update(promoRef, {
        usesCount: Math.max(0, Number(c.usesCount ?? 0)) + 1,
        updatedAt: now,
      });
      tx.set(
        db.doc(`customers/${uid}/couponUsage/${appliedPromoId}`),
        {
          id: appliedPromoId,
          customerId: uid,
          count: usageCount(promoUsageSnap) + 1,
          lastUsedAt: now,
          lastOrderId: orderRef.id,
        },
        { merge: true },
      );
    }

    // Counter.
    tx.set(counterRef, { seq }, { merge: true });

    placedFresh = {
      orderId: orderRef.id,
      paymentMethod: effectivePaymentMethod,
      shortId,
      affiliateUid: affiliateSnap?.id ?? null,
      commissionPaise: accruedCommissionPaise,
    };
    return { orderId: orderRef.id, shortId, amountPaise: summary.payablePaise, paymentMethod: effectivePaymentMethod };
  });

  // Invoice, server-side and automatic. A wallet-settled order is paid the
  // moment it is placed, so its invoice is published now; a razorpay order waits
  // for verifyPayment. Never on a replay — the original
  // placement already published it — and never fatal: publishInvoiceQuietly
  // logs and swallows, so the order stands even if Storage is unhappy.
  const fresh = placedFresh as {
    orderId: string;
    paymentMethod: string;
    shortId: string;
    affiliateUid: string | null;
    commissionPaise: number;
  } | null;
  if (fresh && fresh.paymentMethod !== 'razorpay') {
    await publishInvoiceQuietly(fresh.orderId);
  }

  // Notifications — never on a replay, always after the commit, never fatal.
  // 'accepted' is the one order status adminChangeOrderStatus can never emit
  // (nothing transitions INTO it), so placement is the only place it can come
  // from; the id is keyed by order + status, so a retry cannot repeat it.
  if (fresh) {
    await notifyOrderStatus({
      customerId: uid,
      orderId: fresh.orderId,
      orderShortId: fresh.shortId,
      status: 'accepted',
    });
    // The referrer earns the moment the order is placed (it clears on delivery —
    // see settleDeliveryCommissions, which announces that separately).
    if (fresh.affiliateUid && fresh.commissionPaise > 0) {
      await notifyCommission({
        affiliateUid: fresh.affiliateUid,
        orderId: fresh.orderId,
        orderShortId: fresh.shortId,
        amountPaise: fresh.commissionPaise,
        phase: 'pending',
      });
    }
  }

  return result;
});

// ── markPaymentFailed ──────────────────────────────────────────────
const MarkPaymentFailedSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().max(500).nullable().optional(),
});

/**
 * Record that an online payment attempt failed (gateway dismissed, card
 * declined, app backgrounded out of the sheet…).
 *
 * Deliberately leaves `order.status` alone: the order still exists, its stock is
 * still held, and the customer can retry payment from My Orders. Only the
 * payment side is marked — on the order and on the `payments/{orderId}` row the
 * admin Payments module reads, so the two never disagree.
 *
 * Idempotent, and a no-op once the payment is captured (a late "the sheet
 * closed" callback must never undo a successful capture) or refunded.
 */
export const markPaymentFailed = onCall(callableOpts, async (req) => {
  const { uid } = requireCustomer(req);
  const parsed = MarkPaymentFailedSchema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { orderId } = parsed.data;
  const reason = parsed.data.reason ?? null;

  await db.runTransaction(async (tx) => {
    const orderRef = db.doc(`orders/${orderId}`);
    const paymentRef = db.doc(`payments/${orderId}`);

    // ── reads ──
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) throw new HttpsError('not-found', 'Order not found.');
    const o = orderSnap.data() as Record<string, unknown>;
    if (o.customerId !== uid) throw new HttpsError('permission-denied', 'Not your order.');
    // Money that already moved wins over a failure report.
    if (o.paymentStatus === 'captured' || o.paymentStatus === 'refunded') return;
    const paymentSnap = await tx.get(paymentRef);

    // ── writes ──
    const now = FieldValue.serverTimestamp();
    tx.update(orderRef, {
      paymentStatus: 'failed',
      paymentFailureReason: reason,
      paymentFailedAt: now,
      updatedAt: now,
    });
    // Only settle an existing payment row — an order placed before placeOrder
    // started writing one should not gain a payment record from a failure.
    if (paymentSnap.exists) {
      tx.update(paymentRef, { status: 'failed', failureReason: reason, updatedAt: now });
    }
  });

  return { ok: true };
});

// ── cancelOrder (customer) ─────────────────────────────────────────
const CancelSchema = z.object({ orderId: z.string().min(1) });
/**
 * What a CUSTOMER may cancel — deliberately NARROWER than the admin transition
 * graph, which now also permits cancelling from 'shipped' / 'out_for_delivery'
 * so a parcel lost in transit can be refunded and restocked. A customer whose
 * parcel is already with the courier must go through returns instead, so this
 * list must never simply track ORDER_STATUS_TRANSITIONS.
 *
 * Kept in sync with CANCELLABLE_STATUSES in packages/shared/src/enums.ts, which
 * is what both storefronts hide the Cancel button on.
 */
const CANCELLABLE = ['accepted', 'packing', 'packed'];

/**
 * Customer-initiated cancel (only while the order is still cancellable).
 * Atomic: restores stock, refunds whatever was paid to the wallet, flips the
 * order to 'cancelled', and appends a timeline entry. Re-cancelling is rejected.
 */
export const cancelOrder = onCall(callableOpts, async (req) => {
  const { uid } = requireCustomer(req);
  const parsed = CancelSchema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const orderId = parsed.data.orderId;

  await performCancellation({
    orderId,
    actorUid: uid,
    reason: 'Cancelled by customer',
    requireOwnerUid: uid,
    allowedStatuses: CANCELLABLE,
  });

  return { ok: true };
});

// ── createRazorpayOrder ────────────────────────────────────────────
const CreateRzpSchema = z.object({ orderId: z.string().min(1) });

export const createRazorpayOrder = onCall(
  { ...callableOpts, secrets: [RZP_KEY_ID, RZP_KEY_SECRET] },
  async (req) => {
    const { uid } = await requireActiveCustomer(req);
    const parsed = CreateRzpSchema.safeParse(req.data);
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

    const ref = db.doc(`orders/${parsed.data.orderId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
    const o = snap.data() as Record<string, unknown>;
    if (o.customerId !== uid) throw new HttpsError('permission-denied', 'Not your order.');
    // Never open a gateway order for something that can no longer be fulfilled
    // or has already been settled — the customer would be charged for a
    // cancelled order, or charged a second time.
    if (o.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'This order has been cancelled.');
    }
    if (o.paymentStatus === 'captured' || o.paymentStatus === 'refunded') {
      throw new HttpsError('failed-precondition', 'This order has already been paid.');
    }
    // Only an order that was PLACED as an online payment may be paid online.
    // Without this, a legacy COD order (they still exist and are still being
    // delivered) could be pushed through the gateway: the customer would pay
    // twice — once here and again to the rider on delivery — because
    // adminChangeOrderStatus still settles COD as captured on delivery. A
    // 'wallet' order is already fully paid and has nothing due.
    if (o.paymentMethod !== 'razorpay') {
      throw new HttpsError('failed-precondition', 'This order is not payable online.');
    }
    const amount = Number(o.totalPaise ?? 0) - Number(o.walletUsedPaise ?? 0);
    if (amount <= 0) throw new HttpsError('failed-precondition', 'Nothing to pay for this order.');

    // Reuse the order's existing Razorpay order instead of minting a second one:
    // a Razorpay order accepts a single payment, so reuse is what stops a retry
    // (or a second checkout sheet) from collecting the amount twice.
    if (typeof o.razorpayOrderId === 'string' && o.razorpayOrderId) {
      return { razorpayOrderId: o.razorpayOrderId, keyId: RZP_KEY_ID.value(), amountPaise: amount };
    }

    const auth = Buffer.from(`${RZP_KEY_ID.value()}:${RZP_KEY_SECRET.value()}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency: 'INR', receipt: (o.shortId as string) ?? parsed.data.orderId, notes: { orderId: parsed.data.orderId } }),
    });
    if (!res.ok) {
      throw new HttpsError('internal', 'Could not start the payment. Please try again.');
    }
    const rzp = (await res.json()) as { id: string };
    // Claim the gateway order id only while the order still has none. The reuse
    // check above is a plain read, so two checkout sheets opened at once (web +
    // app, or a double tap) both got past it and both minted a Razorpay order —
    // and the second `update` silently replaced the first id. verifyPayment
    // binds the signature to `order.razorpayOrderId`, so a payment made against
    // the displaced id is rejected for ever: the customer is charged and the
    // order stays unpaid. Claiming transactionally means the loser hands back
    // the winner's id (its own unpaid gateway order simply expires) and both
    // sheets collect against the same one.
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      const existing = fresh.get('razorpayOrderId');
      if (typeof existing === 'string' && existing) return existing;
      tx.update(ref, { razorpayOrderId: rzp.id, updatedAt: FieldValue.serverTimestamp() });
      return rzp.id;
    });
    return { razorpayOrderId: claimed, keyId: RZP_KEY_ID.value(), amountPaise: amount };
  },
);

// ── verifyPayment ──────────────────────────────────────────────────
const VerifySchema = z.object({
  orderId: z.string().min(1),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

export const verifyPayment = onCall(
  { ...callableOpts, secrets: [RZP_KEY_SECRET] },
  async (req) => {
    const { uid } = requireCustomer(req);
    const parsed = VerifySchema.safeParse(req.data);
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payment payload.');
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = parsed.data;

    const ref = db.doc(`orders/${orderId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
    const o = snap.data() as Record<string, unknown>;
    if (o.customerId !== uid) throw new HttpsError('permission-denied', 'Not your order.');

    // The signature must belong to THIS order's Razorpay order. Without this
    // binding, any valid triple the customer holds — e.g. from a ₹1 wallet
    // top-up — could be replayed here to mark an expensive order paid.
    if (!o.razorpayOrderId || o.razorpayOrderId !== razorpayOrderId) {
      throw new HttpsError('failed-precondition', 'That payment does not belong to this order.');
    }
    // A cancelled order can still have a gateway sheet open from before the
    // cancellation. Capturing against it would take money for an order that will
    // never ship, and performCancellation refuses to run twice — so there would
    // be no path back to the customer. Refuse the capture instead.
    if (o.status === 'cancelled' || o.paymentStatus === 'refunded') {
      throw new HttpsError('failed-precondition', 'This order was cancelled — the payment was not applied.');
    }
    // Replay guard: a captured order must never be re-captured.
    if (o.paymentStatus === 'captured') return { verified: true };

    const expected = createHmac('sha256', RZP_KEY_SECRET.value())
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');
    // timingSafeEqual needs equal lengths; the digest is fixed-width hex.
    const sigBuf = Buffer.from(razorpaySignature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return { verified: false };
    }

    // Apply the capture inside a transaction, re-asserting the state guards
    // above against the LOCKED order. The checks so far ran on a plain read, so
    // a cancellation committing between them and this write captured money for
    // an order that will never ship — and performCancellation refuses to run
    // twice, so nothing would ever refund it. Contending on the order document
    // makes the two outcomes mutually exclusive: either the cancel lands first
    // and the capture is refused (the gateway payment is then refundable by
    // hand), or the capture lands first and the cancel refunds it.
    const payRef = db.doc(`payments/${orderId}`);
    await db.runTransaction(async (tx) => {
      // ── reads ──
      const fresh = await tx.get(ref);
      const paySnap = await tx.get(payRef);
      if (!fresh.exists) throw new HttpsError('not-found', 'Order not found.');
      const f = fresh.data() as Record<string, unknown>;
      if (f.status === 'cancelled' || f.paymentStatus === 'refunded') {
        throw new HttpsError(
          'failed-precondition',
          'This order was cancelled — the payment was not applied.',
        );
      }
      // Already captured by a concurrent (or replayed) call — nothing to do.
      if (f.paymentStatus === 'captured') return;

      // ── writes ──
      const now = FieldValue.serverTimestamp();
      tx.update(ref, {
        paymentStatus: 'captured',
        razorpayPaymentId,
        razorpaySignature,
        amountPaidPaise: Number(f.totalPaise ?? 0),
        // A successful capture clears any earlier failed attempt on this order —
        // the customer retried from My Orders and it went through.
        paymentFailureReason: null,
        updatedAt: now,
      });

      // Settle the payment row (admin Payments page + GST export). Keyed by
      // order id and merge-set, so a replayed verifyPayment updates the same
      // document instead of creating a second one; a merge also repairs orders
      // placed before placeOrder started writing this record.
      const payment: Record<string, unknown> = {
        id: orderId,
        orderId,
        orderShortId: (f.shortId as string) ?? null,
        customerId: uid,
        method: 'razorpay',
        gateway: 'razorpay',
        status: 'captured',
        amountPaise: Math.max(0, Number(f.totalPaise ?? 0) - Number(f.walletUsedPaise ?? 0)),
        gatewayRef: razorpayPaymentId,
        capturedAt: now,
        updatedAt: now,
      };
      // Keep the placement timestamp — the admin list is ordered by createdAt.
      if (!paySnap.exists) payment.createdAt = now;
      tx.set(payRef, payment, { merge: true });
    });

    // The order is genuinely paid now — publish its invoice. Errors are logged
    // and swallowed: a failed render must never make a captured payment look
    // unverified to the client (the money has already moved).
    await publishInvoiceQuietly(orderId);

    return { verified: true };
  },
);
