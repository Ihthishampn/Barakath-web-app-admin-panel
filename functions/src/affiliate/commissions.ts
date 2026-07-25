/**
 * Affiliate commission engine — accrual, clearance and reversal.
 *
 * Lifecycle (no document triggers, per the architecture rule — every step hangs
 * off an existing callable):
 *   placeOrder              → accrue  'pending'   (+ pendingBalancePaise)
 *   adminChangeOrderStatus  → confirm 'confirmed' (pending → confirmed,
 *                             delivered           + lifetimeEarningsPaise)
 *   cancel (either path)    → reverse 'cancelled' (− pendingBalancePaise)
 *
 * Commission clears at delivery rather than after `commissionClearanceDays`,
 * because holding it longer would need a scheduled sweep and we run callables
 * only. Returns are handled by the return flow, which is the case the
 * clearance delay was protecting against.
 */
import type { Transaction, DocumentSnapshot } from 'firebase-admin/firestore';
import { db, FieldValue } from '../_lib/admin.js';

export interface ReferredBy {
  affiliateUid?: string;
  affiliateCode?: string;
}

/** Rate is stored as a fraction (0.05); tolerate a percent (5) defensively. */
function normaliseRate(raw: unknown): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1 ? n / 100 : n;
}

/**
 * The commission row for an order — keyed BY THE ORDER ID.
 *
 * This is the idempotency key for the whole accrual path: one order can pay at
 * most one referrer, so `commissions/{orderId}` is unique by construction. Any
 * repeat of the accrual (a transaction retry, a replayed idempotency key, a
 * double-submitted checkout that somehow reaches the same order, a future
 * backfill) addresses the SAME document, so the worst case is an overwrite with
 * identical values — never a second row, and never a second balance credit.
 * `orderId` is still stored as a field, so the existing
 * `where('orderId','==',…)` queries in cancel.ts / returns / confirmation keep
 * working unchanged.
 */
export function commissionRefForOrder(orderId: string) {
  return db.doc(`commissions/${orderId}`);
}

/**
 * Read-phase companion to {@link accrueCommission}: fetches the order's
 * commission row (if any) inside the caller's transaction, so accrual can be
 * skipped when it has already happened. MUST be called before any write.
 */
export async function readOrderCommission(
  tx: Transaction,
  orderId: string,
): Promise<DocumentSnapshot> {
  return tx.get(commissionRefForOrder(orderId));
}

/**
 * One ordered line, reduced to everything commission depends on. Built by
 * checkout from the line items it embeds on the order document, so accrual and
 * the order's stored items can never disagree.
 */
export interface CommissionLine {
  productId: string;
  variantId: string | null;
  qty: number;
  /** Post-discount merchandise value of this line, in paise. */
  eligiblePaise: number;
  /**
   * The product's fixed per-unit commission (paise), or null when the product is
   * configured with a percentage instead. This is the number the storefront
   * advertises as guaranteed earnings.
   */
  commissionPaise: number | null;
  /** The product's percentage commission (`affiliateCommissionRate`), fraction. */
  productCommissionRate: number | null;
  /** `isAffiliateEligible` — an explicit false excludes the line entirely. */
  affiliateEligible: boolean;
}

type CommissionBasis = 'per_unit' | 'product_rate' | 'none';

interface LineAccrual {
  productId: string;
  variantId: string | null;
  qty: number;
  basis: CommissionBasis;
  commissionPaise: number;
}

/**
 * Commission for a single line, from the PRODUCT's own configuration only (the
 * per-affiliate rate has been removed):
 *
 *   1. the product's fixed `commissionPaise`, charged per unit — the storefront
 *      prints "you earn ₹X per sale" from exactly this field, so honouring
 *      anything else makes the product page a lie. Deliberately NOT scaled by
 *      the order discount: it is a promise per sale (the total is still capped
 *      against the order's post-discount merchandise value by the caller).
 *   2. else the product's `affiliateCommissionRate` (percentage), applied to the
 *      line's post-discount value.
 *   3. else nothing.
 *
 * A product always has exactly one of the two configured (the admin form + the
 * backfill guarantee it), so line 3 only covers an affiliate-ineligible line.
 */
function lineAccrual(l: CommissionLine): LineAccrual {
  const base = { productId: l.productId, variantId: l.variantId, qty: l.qty };
  if (!l.affiliateEligible) {
    return { ...base, basis: 'none', commissionPaise: 0 };
  }
  // `null` means "not the fixed-amount path" → fall through to the percentage;
  // any NUMBER the admin stored is authoritative — including 0, the only way to
  // say "this product pays nothing". Treating 0 as "unset" would silently pay
  // the percentage on a product configured to pay none.
  const perUnit = l.commissionPaise == null ? NaN : Number(l.commissionPaise);
  if (Number.isFinite(perUnit) && perUnit >= 0) {
    return { ...base, basis: 'per_unit', commissionPaise: Math.max(0, Math.floor(perUnit * l.qty)) };
  }
  const productRate = normaliseRate(l.productCommissionRate);
  return {
    ...base,
    basis: productRate > 0 ? 'product_rate' : 'none',
    commissionPaise: Math.max(0, Math.floor(l.eligiblePaise * productRate)),
  };
}

/**
 * Reads the referring affiliate's customer doc, or null when the order has no
 * referrer / the referrer is no longer an enabled affiliate. MUST be called
 * before any write in the caller's transaction.
 */
export async function readReferringAffiliate(
  tx: Transaction,
  referredBy: ReferredBy | null | undefined,
): Promise<DocumentSnapshot | null> {
  const affiliateUid = referredBy?.affiliateUid;
  if (!affiliateUid) return null;
  const snap = await tx.get(db.doc(`customers/${affiliateUid}`));
  if (!snap.exists) return null;
  const aff = snap.get('affiliate') as { enabled?: boolean } | undefined;
  return aff?.enabled ? snap : null;
}

export interface AccrualParams {
  affiliateSnap: DocumentSnapshot;
  orderId: string;
  orderShortId: string;
  /**
   * Commission is charged on merchandise value, not delivery or tax. Doubles as
   * the ceiling for the per-line total: a generous flat `commissionPaise` on a
   * heavily discounted cart must never pay out more than the order was worth.
   */
  eligiblePaise: number;
  orderTotalPaise: number;
  referredCustomerUid: string;
  referredCustomerFirstName: string;
  /** Per-line commission inputs, built from the order's embedded line items. */
  lines?: CommissionLine[];
  /**
   * `commissions/{orderId}` as read in the caller's read phase (see
   * {@link readOrderCommission}). When it already exists the accrual is a no-op:
   * the row and the balance credit happened on an earlier attempt.
   *
   * REQUIRED (nullable, not optional) on purpose: this is the only thing
   * standing between a transaction retry and a second balance credit, and an
   * optional field lets a future caller omit it by accident. Passing null is a
   * deliberate statement that no row can exist yet.
   */
  existingCommission: DocumentSnapshot | null;
}

/**
 * Writes the pending commission row and credits the affiliate's pending
 * balance. Returns the accrued amount so the caller can stamp the order.
 *
 * Exactly-once by construction:
 *  - the row is keyed by order id (see {@link commissionRefForOrder}), so a
 *    duplicate write lands on the same document instead of creating a second row;
 *  - `existingCommission` short-circuits before the balance increment, so the
 *    affiliate can never be credited twice for one order;
 *  - a self-referral (the affiliate ordering with their own attribution) accrues
 *    nothing at all.
 */
export function accrueCommission(tx: Transaction, p: AccrualParams): number {
  const affiliateUid = p.affiliateSnap.id;

  // Self-referral: no commission, ever. linkReferral refuses to create the link
  // and placeOrder refuses the code, but this is the single choke point every
  // accrual passes through, so the invariant is enforced here too.
  if (affiliateUid === p.referredCustomerUid) return 0;

  // Already accrued for this order — return what was accrued so the caller can
  // still stamp the order, but do not write anything a second time.
  if (p.existingCommission?.exists) {
    return Number(p.existingCommission.get('commissionPaise') ?? 0);
  }

  // Per-line accrual from each product's own commission config is the only path
  // now. A caller with no line breakdown (a legacy/repair path) can no longer
  // derive a commission — there is no per-affiliate rate to fall back on — so it
  // accrues nothing rather than guessing.
  const lines = p.lines ?? [];
  const breakdown = lines.map((l) => lineAccrual(l));
  const rawPaise = breakdown.reduce((s, b) => s + b.commissionPaise, 0);
  const commissionPaise = Math.max(0, Math.min(rawPaise, Math.max(0, p.eligiblePaise)));
  if (commissionPaise <= 0) return 0;

  // Effective blended rate this order earned (fraction), for any generic "X%"
  // reader — the per-product configuration means there is no single input rate,
  // so the ledger records what the money actually worked out to.
  const effectiveRate = p.eligiblePaise > 0 ? commissionPaise / Math.max(1, p.eligiblePaise) : 0;

  const now = FieldValue.serverTimestamp();
  const ref = commissionRefForOrder(p.orderId);
  tx.set(ref, {
    id: ref.id,
    affiliateUid,
    referredCustomerUid: p.referredCustomerUid,
    referredCustomerFirstName: p.referredCustomerFirstName,
    orderId: p.orderId,
    orderShortId: p.orderShortId,
    orderTotalPaise: p.orderTotalPaise,
    /** Merchandise value the commission was charged against (post-discount). */
    eligiblePaise: Math.max(0, p.eligiblePaise),
    // The effective blended rate this order earned (per-product config means no
    // single input rate). Kept for back-compat readers; the per-line breakdown
    // alongside is the real explanation.
    commissionRate: effectiveRate,
    commissionPaise,
    /** How each line earned — lets the admin/affiliate explain the number. */
    lineBreakdown: breakdown,
    status: 'pending',
    accruedAt: now,
    confirmedAt: null,
    paidAt: null,
    withdrawalRequestId: null,
    cancellationReason: null,
    createdAt: now,
    updatedAt: now,
  });

  tx.update(p.affiliateSnap.ref, {
    'affiliate.pendingBalancePaise': FieldValue.increment(commissionPaise),
    'affiliate.lastCommissionAt': now,
    updatedAt: now,
  });

  return commissionPaise;
}

/**
 * Reverses (part of) an order's commission when money goes back to the customer.
 *
 * Commission clears at delivery, but a return can only be requested AFTER
 * delivery — so by the time a refund is approved the commission is already
 * 'confirmed' and withdrawable. Without this, a referrer earns real money on a
 * fully refunded order, repeatably.
 *
 * Two-phase because Firestore transactions forbid reads after writes: await this
 * to take every read, then call the returned closure once the caller is ready to
 * write. Reversal is proportional to the refunded share of the MERCHANDISE value
 * the commission was charged on, and `reversedPaise` accumulates so several
 * partial returns can never claw back more than was earned.
 */
export async function prepareCommissionReversal(
  tx: Transaction,
  orderId: string,
  refundPaise: number,
): Promise<() => void> {
  const noop = () => {};
  if (!orderId || refundPaise <= 0) return noop;

  const snap = await tx.get(db.collection('commissions').where('orderId', '==', orderId));
  // 'paid' rows are included on purpose. They are precisely the case the
  // shortfall accounting below exists for — the affiliate has already been paid
  // this money — and dropping them (as this used to) meant a return after a
  // payout clawed back nothing and recorded nothing. 'cancelled' rows are
  // already fully reversed, so only these three states can owe anything.
  const rows = snap.docs.filter((d) => {
    const s = (d.data() as { status?: string }).status;
    return s === 'confirmed' || s === 'pending' || s === 'paid';
  });
  if (rows.length === 0) return noop;

  const affSnaps = await Promise.all(
    rows.map((d) => tx.get(db.doc(`customers/${(d.data() as { affiliateUid: string }).affiliateUid}`))),
  );

  return () => {
    const now = FieldValue.serverTimestamp();
    // Balance writes below are ABSOLUTE (current − recovered), so two rows that
    // name the same affiliate — a legacy auto-id row alongside the order-keyed
    // one — would clobber each other if both read the same snapshot value. Carry
    // the running balance forward instead, keyed by affiliate + balance field.
    const running = new Map<string, number>();
    rows.forEach((d, i) => {
      const c = d.data() as Record<string, any>;
      const earned = Number(c.commissionPaise ?? 0);
      const already = Number(c.reversedPaise ?? 0);
      // Fully reversed already — the only guard against double-reversal, so it
      // stays ahead of every write below.
      if (earned <= 0 || already >= earned) return;

      // Proportion against the base the commission was CHARGED on, because that
      // is the base the refund is MEASURED in: returns refund merchandise value
      // only (returns/requests.ts — delivery, COD surcharge and tax are
      // order-level and never given back per item), while `orderTotalPaise`
      // carries all of those on top. Dividing by the grand total under-clawed
      // every return by the non-merchandise share (~6.5% with the seeded ₹49
      // delivery + ₹20 COD, ~15% once GST is charged) and left a residual that
      // kept a fully refunded order's commission 'confirmed' and withdrawable.
      // `eligiblePaise` is exactly the post-discount merchandise value accrual
      // used; rows written before that field existed keep the old denominator
      // rather than have us guess a base for them.
      const base = Number(c.eligiblePaise ?? c.orderTotalPaise ?? 0);

      // Reverse against the CUMULATIVE refund rather than this refund alone.
      // Flooring each partial return in isolation loses up to a paise per
      // return, so an order returned item-by-item would stop just short of
      // `earned` and never flip to 'cancelled'; deriving the target from the
      // running refund total makes the final return land exactly on the full
      // commission. `refundedPaise` is additive-only — no existing reader
      // depends on it.
      const refundedBefore = Number(c.refundedPaise ?? 0);
      const applied =
        base > 0 ? Math.min(refundPaise, Math.max(0, base - refundedBefore)) : refundPaise;
      const refundedTotal = refundedBefore + applied;
      const target = base > 0 ? Math.floor((earned * Math.min(refundedTotal, base)) / base) : earned;
      const claw = Math.min(Math.max(0, target - already), earned - already);

      if (claw <= 0) {
        // A refund too small to move the (floored) reversal by a whole paise
        // still has to be remembered, or the next return re-computes its share
        // from a stale total and the order can never reverse in full.
        if (applied > 0) tx.update(d.ref, { refundedPaise: refundedTotal, updatedAt: now });
        return;
      }

      // Where the money to claw back actually sits. A 'paid' row's commission
      // has already left confirmedBalancePaise for withdrawnBalancePaise, so
      // there is nothing of its own to take back — recover against whatever
      // confirmed balance the affiliate holds now (earnings on other orders) and
      // let the remainder fall through to unrecoveredPaise below.
      const status = String(c.status ?? '');
      const fromConfirmed = status === 'confirmed' || status === 'paid';
      const balanceKey = fromConfirmed ? 'confirmedBalancePaise' : 'pendingBalancePaise';
      const aff = affSnaps[i]!;
      const key = `${aff.id}|${balanceKey}`;
      const current =
        running.get(key) ??
        Number((aff.get('affiliate') as Record<string, any> | undefined)?.[balanceKey] ?? 0);

      // The affiliate may already have withdrawn this money. Never drive a
      // balance negative — bank what we can and record the shortfall so it is
      // visible rather than silently absorbed.
      const recovered = Math.min(claw, Math.max(0, current));
      const unrecovered = claw - recovered;
      const reversedTotal = already + claw;
      running.set(key, Math.max(0, current - recovered));

      tx.update(d.ref, {
        refundedPaise: refundedTotal,
        reversedPaise: reversedTotal,
        unrecoveredPaise: Number(c.unrecoveredPaise ?? 0) + unrecovered,
        // A fully reversed row is cancelled — except a 'paid' one, whose status
        // is the record that money really did leave the business. That row keeps
        // 'paid' and carries the debt in unrecoveredPaise instead; it is already
        // excluded from the withdrawal settlement query, so nothing stays
        // withdrawable either way.
        ...(reversedTotal >= earned && status !== 'paid' ? { status: 'cancelled', cancelledAt: now } : {}),
        updatedAt: now,
      });

      if (aff.exists && recovered > 0) {
        const update: Record<string, unknown> = { updatedAt: now };
        update[`affiliate.${balanceKey}`] = current - recovered;
        // Lifetime earnings only ever counted commission that reached the
        // confirmed balance (pending money has not been earned yet), so only a
        // confirmed/paid claw-back reduces it.
        if (fromConfirmed) {
          update['affiliate.lifetimeEarningsPaise'] = FieldValue.increment(-recovered);
        }
        tx.update(aff.ref, update);
      }
    });
  };
}

/** One affiliate's share of a delivery clearance — what actually moved. */
export interface ConfirmedCommission {
  affiliateUid: string;
  amountPaise: number;
}

/**
 * Clears an order's pending commissions into the affiliate's confirmed balance.
 * Idempotent — only rows still 'pending' are moved, so a repeated delivery
 * transition can't pay twice.
 *
 * Returns what each affiliate actually gained, so the caller can tell them their
 * commission is now withdrawable. An empty array means nothing moved (already
 * confirmed, fully reversed, or no commission at all) and therefore that nothing
 * should be announced.
 */
export async function confirmCommissionsForOrder(orderId: string): Promise<ConfirmedCommission[]> {
  const snap = await db.collection('commissions').where('orderId', '==', orderId).get();
  const pending = snap.docs.filter((d) => (d.data() as { status?: string }).status === 'pending');
  if (pending.length === 0) return [];

  // Filled inside the transaction and reset on every attempt, so a retry cannot
  // report an amount from an attempt that never committed.
  let confirmed: ConfirmedCommission[] = [];

  await db.runTransaction(async (tx) => {
    confirmed = [];
    // All reads first — re-read each row inside the transaction so a concurrent
    // confirmation can't double-credit.
    const fresh = await Promise.all(pending.map((d) => tx.get(d.ref)));
    const affiliateRefs = fresh.map((d) =>
      db.doc(`customers/${(d.data() as { affiliateUid: string }).affiliateUid}`),
    );
    const affSnaps = await Promise.all(affiliateRefs.map((r) => tx.get(r)));

    const now = FieldValue.serverTimestamp();
    // Pending balance still available per affiliate, as read in this
    // transaction, carried across rows so two rows for one affiliate can't each
    // claim the same paise.
    const availablePending = new Map<string, number>();
    fresh.forEach((d, i) => {
      const c = d.data() as
        | { status?: string; commissionPaise?: number; reversedPaise?: number }
        | undefined;
      if (!c || c.status !== 'pending') return;
      const earned = Number(c.commissionPaise ?? 0);
      if (earned <= 0) return;

      // Clear the NET, never the gross. A return can be approved while the row
      // is still 'pending' — the delivery→confirm step runs outside the status
      // transaction and can fail after the order is already 'delivered' (see
      // orders/status.ts), and a return only requires 'delivered'. That reversal
      // has already taken its share out of pendingBalancePaise, so confirming
      // the gross paid it a second time and left pendingBalancePaise negative
      // for ever.
      const reversed = Number(c.reversedPaise ?? 0);
      const net = Math.max(0, earned - reversed);

      const aff = affSnaps[i]!;
      const available =
        availablePending.get(aff.id) ??
        Number((aff.get('affiliate') as Record<string, any> | undefined)?.pendingBalancePaise ?? 0);
      // A row whose claw-back could not be fully recovered (unrecoveredPaise)
      // has less sitting in pending than its net, and no balance may go
      // negative — so move only what is actually there.
      const amount = Math.max(0, Math.min(net, Math.max(0, available)));
      availablePending.set(aff.id, Math.max(0, available - amount));

      // Stamp the row either way: a fully reversed one is terminal, and one that
      // cleared nothing must still leave 'pending' or a re-delivery would keep
      // reconsidering it for ever.
      tx.update(d.ref, {
        ...(net <= 0
          ? { status: 'cancelled', cancelledAt: now }
          : { status: 'confirmed', confirmedAt: now }),
        updatedAt: now,
      });
      if (amount <= 0) return;

      tx.update(affiliateRefs[i]!, {
        'affiliate.pendingBalancePaise': FieldValue.increment(-amount),
        'affiliate.confirmedBalancePaise': FieldValue.increment(amount),
        'affiliate.lifetimeEarningsPaise': FieldValue.increment(amount),
        updatedAt: now,
      });
      confirmed.push({ affiliateUid: aff.id, amountPaise: amount });
    });
  });

  return confirmed;
}
