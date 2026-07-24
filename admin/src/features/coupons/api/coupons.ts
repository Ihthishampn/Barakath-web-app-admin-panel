import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  buildSearchIndex,
  type Coupon,
  type CouponStatus,
  type CouponTarget,
  type DiscountType,
} from '@barkath/shared';
import { db } from '@/lib/firebase';
import { useLiveCollection } from '@/hooks/firestoreCache';

export const COUPONS_KEY = 'coupons:createdAt-desc';

/**
 * `autoApply` is not on the shared `Coupon` type — the checkout reads it
 * defensively off the raw document (`c.autoApply === false`) and nothing wrote
 * it until this form did. Read it through this view rather than widening the
 * shared type, which is the same pattern products/api uses for the rating parts.
 */
export type CouponDoc = Coupon & { autoApply?: boolean };

/** All coupons (every status) for the admin list, newest first, real-time. */
export function useCouponsList() {
  return useLiveCollection<Coupon>(COUPONS_KEY, () =>
    query(collection(db, 'coupons'), orderBy('createdAt', 'desc')),
  );
}

export type CouponBadgeTone = 'success' | 'gold' | 'error' | 'neutral';

/**
 * Derive the list status badge from active + validity window (prototype logic —
 * Active / Scheduled / Paused / Expired). The stored `status` is refreshed by the
 * scheduled coupon-expiry sweep (a Cloud Function, not built here); deriving live
 * keeps the badge correct between sweeps.
 */
export function deriveCouponStatus(c: Coupon): { label: string; tone: CouponBadgeTone } {
  const now = Date.now();
  if (c.validUntil && c.validUntil.toMillis() < now) return { label: 'Expired', tone: 'error' };
  if (!c.active) return { label: 'Paused', tone: 'neutral' };
  if (c.validFrom && c.validFrom.toMillis() > now) return { label: 'Scheduled', tone: 'gold' };
  return { label: 'Active', tone: 'success' };
}

export async function deleteCoupon(id: string): Promise<void> {
  await deleteDoc(doc(db, 'coupons', id));
}

/** Pause / re-activate a coupon (keeps expired coupons expired at read time). */
export async function setCouponActive(id: string, active: boolean): Promise<void> {
  const status: CouponStatus = active ? 'active' : 'paused';
  await updateDoc(doc(db, 'coupons', id), {
    active,
    status,
    updatedAt: serverTimestamp(),
  });
}

export async function getCoupon(id: string): Promise<CouponDoc | null> {
  const snap = await getDoc(doc(db, 'coupons', id));
  return snap.exists() ? (snap.data() as CouponDoc) : null;
}

/** Reserve a Firestore doc id for a new coupon. */
export function newCouponId(): string {
  return doc(collection(db, 'coupons')).id;
}

export interface CouponFormValues {
  id: string;
  code: string;
  discountType: DiscountType;
  /** Rupees for flat, whole percent for percent, ignored for free_shipping. */
  discountValuePaise: number;
  discountPercent: number;
  discountMaxCapPaise: number | null;
  minCartValuePaise: number;
  maxUsesTotal: number | null;
  /** Blank = fall back to 1. Never stored as null — see saveCoupon. */
  maxUsesPerUser: number | null;
  targetUsers: CouponTarget;
  applicableCategories: string[];
  /** Allowlist of product ids. Empty = every product. */
  applicableProducts: string[];
  /** Denylist of product ids, applied last so it always wins. Empty = none. */
  excludedProducts: string[];
  active: boolean;
  /**
   * When the coupon starts working. Server and both clients enforce it
   * (`validFrom > now` → not yet valid), and the list badge already renders
   * "Scheduled" off it — but nothing ever set it to anything but "now", so a
   * sale could not be prepared in advance.
   */
  validFrom: Date | null;
  /** null = No expiry. */
  validUntil: Date | null;
  /**
   * Whether the checkout may pick this coupon up on its own when the customer
   * entered no code. Stored as written; the server reads it as `autoApply
   * !== false`, so an absent field means "eligible".
   */
  autoApply: boolean;
}

/**
 * Why a coupon will never be auto-applied at checkout, or null if it can be.
 *
 * `autoBestOffer` in functions/src/orders/checkout.ts scans only promotional
 * coupons and skips any that it cannot fully validate inside its synchronous
 * loop. Those skips are unconditional, so an "Auto-apply" toggle on a coupon
 * that trips one of them would be a control that silently does nothing — the
 * form states the reason instead.
 */
export function autoApplyBlocker(v: {
  targetUsers: CouponTarget;
  maxUsesPerUser: number | null;
}): string | null {
  if (v.targetUsers !== 'all') {
    return 'Auto-apply only considers coupons targeted at All users.';
  }
  // The checkout cannot read `customers/{uid}/couponUsage` inside the scan, so
  // it refuses to auto-apply anything carrying a per-customer cap — and this
  // form never stores less than 1 (blank means 1, deliberately: the checkout
  // treats a missing value as "no limit"). So today every coupon trips this.
  // The customer can still enter the code by hand, which validates in full.
  if ((normaliseUsageLimit(v.maxUsesPerUser) ?? 1) > 0) {
    return 'Auto-apply skips any coupon with a per-customer limit — the checkout can’t check that limit while scanning. Customers can still enter the code by hand.';
  }
  return null;
}

/**
 * Blank means unlimited — and so does 0. Every consumer compares
 * `usesCount >= maxUsesTotal` (functions checkout, web offers), so a stored 0 is
 * "already exhausted" and the coupon is dead the moment it is created while the
 * list still shows it Active. The sibling maxUsesPerUser already treats 0 as
 * unlimited, which is exactly why an admin types it. Fractions/negatives typed
 * into the number input are normalised away too.
 */
function normaliseUsageLimit(v: number | null): number | null {
  if (v == null) return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Money/count fields are compared numerically by every consumer (the checkout
 * Cloud Functions, both storefronts' offer engines). A NaN — which is what a
 * half-typed number input produces — makes every one of those comparisons
 * false, so a minimum silently becomes "no minimum" and a cap silently becomes
 * "uncapped". Anything unusable is normalised to a hard zero instead.
 */
function normalisePaise(v: number | null | undefined): number {
  const n = Math.round(Number(v ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Whole percent, 0–100. Anything else would price a discount nobody intended. */
function normalisePercent(v: number | null | undefined): number {
  const n = Math.round(Number(v ?? 0));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, n);
}

/**
 * The stored status.
 *
 * `validFrom` is deliberately NOT folded in here: the checkout and both
 * storefront offer engines query `status == 'active'` and THEN compare
 * `validFrom` against now, so a scheduled coupon must already be 'active' in
 * the document for that comparison to ever run. Storing 'paused' for it would
 * make the coupon invisible to every query and it would never wake up. The
 * admin list derives the "Scheduled" badge separately (deriveCouponStatus).
 */
function computeStatus(active: boolean, validUntil: Date | null): CouponStatus {
  if (validUntil && validUntil.getTime() < Date.now()) return 'expired';
  return active ? 'active' : 'paused';
}

/** Non-empty, de-duplicated product ids. */
function idList(ids: string[] | undefined): string[] {
  return [...new Set((ids ?? []).map((s) => String(s).trim()).filter(Boolean))];
}

/**
 * Create or update a coupon. Admin is a rules-gated writer, so this is a DIRECT
 * client write — no Cloud Function. `searchIndex` is built here on write with
 * buildSearchIndex (mirrors saveProduct), and the derived `status` is stored so
 * lists/queries stay consistent between coupon-expiry sweeps.
 */
/**
 * Reject a code already used by another coupon. Codes are looked up by value at
 * checkout, so a duplicate makes which coupon applies ambiguous.
 */
async function assertCodeAvailable(code: string, selfId: string): Promise<void> {
  const dupe = await getDocs(query(collection(db, 'coupons'), where('code', '==', code), limit(2)));
  if (dupe.docs.some((d) => d.id !== selfId)) {
    throw new Error(`Coupon code ${code} already exists.`);
  }
}

export async function saveCoupon(values: CouponFormValues, isNew: boolean): Promise<string> {
  const code = values.code.trim().toUpperCase();
  await assertCodeAvailable(code, values.id);
  const isPercent = values.discountType === 'percent';
  const isFlat = values.discountType === 'flat';

  const cap = isPercent ? normalisePaise(values.discountMaxCapPaise) : 0;

  const base = {
    code,
    title: code,
    description: '',
    discountType: values.discountType,
    discountValuePaise: isFlat ? normalisePaise(values.discountValuePaise) : 0,
    discountPercent: isPercent ? normalisePercent(values.discountPercent) : 0,
    // A cap of 0 means "uncapped" to every consumer, so store null rather than
    // a zero that reads as no cap at all.
    discountMaxCapPaise: isPercent && cap > 0 ? cap : null,
    minCartValuePaise: normalisePaise(values.minCartValuePaise),
    maxUsesTotal: normaliseUsageLimit(values.maxUsesTotal),
    // How many times ONE customer may redeem this coupon — a different question
    // from maxUsesTotal, which caps redemptions across everybody. This used to
    // be hardcoded to 1, so raising "Usage limit" to 2 let the coupon be
    // redeemed twice overall but still refused any customer their second go.
    //
    // Written on EVERY save, not just on create, and never null: the checkout
    // re-asserts it against `customers/{uid}/couponUsage`, and a coupon whose
    // document is missing the field is treated as "no per-customer limit" — an
    // edit must not be able to leave it that way. Blank therefore means the
    // safe default of 1, not unlimited.
    maxUsesPerUser: normaliseUsageLimit(values.maxUsesPerUser) ?? 1,
    applicableCategories: values.applicableCategories,
    // Product allow/deny lists. The checkout honours both (discountableSubtotal
    // in functions/src/orders/checkout.ts), with the denylist applied last so
    // it always wins. Written on every save so an edit can clear them.
    applicableProducts: idList(values.applicableProducts),
    excludedProducts: idList(values.excludedProducts),
    targetUsers: values.targetUsers,
    firstOrderOnly: values.targetUsers === 'new',
    // Written on EVERY save, not only on create. It used to be stamped with
    // serverTimestamp() in the create branch and never touched again, so every
    // coupon went live the instant it was saved and a sale could not be
    // prepared in advance. Null means "no start date" — the checkout's
    // `validFrom && validFrom > now` guard simply doesn't fire.
    validFrom: values.validFrom ? Timestamp.fromDate(values.validFrom) : null,
    validUntil: values.validUntil ? Timestamp.fromDate(values.validUntil) : null,
    // `autoApply === false` is the only value the checkout acts on; true and
    // absent both mean "eligible". Stored explicitly either way so the form and
    // the document agree.
    autoApply: values.autoApply,
    active: values.active,
    status: computeStatus(values.active, values.validUntil),
    searchIndex: buildSearchIndex([code]),
    updatedAt: serverTimestamp(),
  };

  if (isNew) {
    await setDoc(doc(db, 'coupons', values.id), {
      id: values.id,
      ...base,
      usesCount: 0,
      createdBy: 'admin',
      createdAt: serverTimestamp(),
    });
  } else {
    // `usesCount` is deliberately NOT in `base`: it is the redemption counter,
    // owned by placeOrder/performCancellation, and an edit must never reset it
    // (that would silently hand a spent coupon its whole budget back).
    await updateDoc(doc(db, 'coupons', values.id), base);
  }
  return values.id;
}
