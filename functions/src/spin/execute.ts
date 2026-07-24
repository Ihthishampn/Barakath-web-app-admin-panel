/**
 * executeSpin — server-authoritative Spin & Win.
 *
 * Validates the campaign + the user's daily spin allowance, picks a slice by
 * weighted RNG (server-side so the outcome can't be gamed), then issues the
 * prize: a coupon (customers/{uid}/coupons) for discount slices, a wallet
 * credit for cashback, nothing for better-luck. Records a spinHistory row.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, FieldValue, Timestamp, callableOpts } from '../_lib/admin.js';
import { requireCustomer } from '../_lib/guards.js';

interface Slice {
  id: string;
  prizeType: string;
  discountValuePaise: number | null;
  discountPercent: number | null;
  discountMaxCapPaise: number | null;
  minCartValuePaise: number;
  validityDays: number;
  weight: number;
  displayLabel: string;
  secondaryLabel: string;
  usedCount?: number;
}

/**
 * Fallback cap for a spin-won PERCENT coupon that has none.
 *
 * The wheel editor has no input for `discountMaxCapPaise`, so every percent
 * slice an admin authors is stored as `null` — and checkout treats a missing cap
 * as "unlimited" (`if (cap > 0)`), so a 50%-off slice takes ₹20,000 off a
 * ₹40,000 cart, auto-applied without the customer even entering the code. The
 * promotional coupon form already refuses to save an uncapped percent coupon;
 * mint with the same guarantee here instead of an unbounded one. ₹200 is the cap
 * the store's own percent coupons use.
 */
const DEFAULT_PERCENT_CAP_PAISE = 20_000;

function pickWeighted(slices: Slice[]): Slice {
  const total = slices.reduce((s, x) => s + Math.max(0, x.weight || 0), 0);
  if (total <= 0) return slices[Math.floor(Math.random() * slices.length)]!;
  let r = Math.random() * total;
  for (const s of slices) {
    r -= Math.max(0, s.weight || 0);
    if (r <= 0) return s;
  }
  return slices[slices.length - 1]!;
}

function code(): string {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'SPIN-';
  for (let i = 0; i < 5; i++) out += s[Math.floor(Math.random() * s.length)];
  return out;
}

export const executeSpin = onCall(callableOpts, async (req) => {
  const { uid } = requireCustomer(req);
  const parsed = z.object({ campaignId: z.string().min(1) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid spin request.');
  const campaignId = parsed.data.campaignId;

  const campRef = db.doc(`spinCampaigns/${campaignId}`);
  const campSnap = await campRef.get();
  if (!campSnap.exists) throw new HttpsError('not-found', 'This spin campaign is unavailable.');
  const camp = campSnap.data() as Record<string, unknown>;
  const now = Date.now();
  const startsAt = (camp.startsAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
  const endsAt = (camp.endsAt as { toMillis?: () => number })?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
  // The window is checked BEFORE the stored status: nothing ever flips a
  // campaign out of 'active' when it finishes (there is no spin sweep), so an
  // expired campaign is still status:'active' and used to fail with the vague
  // "not active right now". Say which it is.
  if (now > endsAt) throw new HttpsError('failed-precondition', 'This spin campaign has ended.');
  if (now < startsAt) throw new HttpsError('failed-precondition', "This spin campaign hasn't started yet.");
  if (camp.status !== 'active') throw new HttpsError('failed-precondition', 'This spin campaign is not running.');

  const slices = (camp.slices as Slice[]) ?? [];
  if (slices.length === 0) throw new HttpsError('failed-precondition', 'This campaign has no prizes configured.');

  const custRef = db.doc(`customers/${uid}`);

  // Eligibility — the admin picks who a campaign is for (all / new / existing /
  // affiliates / segment) and it was never checked here, so an "Affiliates only"
  // wheel handed its prizes to every signed-in customer. Read the profile once
  // now; the transaction below re-reads it for the values it writes.
  const custPre = await custRef.get();
  if (!custPre.exists) throw new HttpsError('not-found', 'Customer profile not found.');
  // A blocked customer keeps a valid ID token for up to an hour after the admin
  // blocks them, and nothing else in this callable looks at the flag, so without
  // this check "Block user" does not stop them winning prizes.
  if (custPre.get('isBlocked') === true) {
    throw new HttpsError('permission-denied', 'This account has been blocked. Contact support.');
  }
  const ordersCount = Number((custPre.get('stats') as Record<string, any> | undefined)?.ordersCount ?? 0);
  const isAffiliate = (custPre.get('affiliate') as Record<string, any> | null)?.enabled === true;
  const eligibility = String(camp.eligibility ?? 'all');
  const eligible =
    eligibility === 'affiliates'
      ? isAffiliate
      : eligibility === 'new'
        ? ordersCount === 0
        : eligibility === 'existing'
          ? ordersCount > 0
          : true; // 'all', and 'segment' — no segment definition exists to match on
  if (!eligible) {
    throw new HttpsError('failed-precondition', 'This spin campaign is not available for your account.');
  }

  // Daily allowance — a campaign-level cap (camp.spinsPerDay) that resets at IST
  // midnight, so every customer gets the same number of spins per day.
  //
  // Counted from a per-customer/per-campaign/per-day counter doc rather than by
  // scanning spinHistory: that query (`where('customerId','==',uid)`, no bound,
  // no limit) re-read the customer's ENTIRE lifetime spin history on every spin
  // and grew forever. Bounding it by createdAt would need a composite index; a
  // counter doc needs none, is a single read, and — being a document — can be
  // read INSIDE the transaction, which also closes the old read-before-write
  // window. Counters start at 0, so on the deploy day a customer may get their
  // daily allowance once more; that is a one-off and self-corrects.
  const spinsPerDay = Math.max(1, Number(camp.spinsPerDay ?? 1));
  const IST_OFFSET_MS = 5.5 * 3600_000;
  const istMidnightMs = Math.floor((now + IST_OFFSET_MS) / 86400_000) * 86400_000 - IST_OFFSET_MS;
  const dayKey = new Date(istMidnightMs + IST_OFFSET_MS).toISOString().slice(0, 10); // yyyy-mm-dd, IST day
  const counterRef = db.doc(`customers/${uid}/spinCounters/${campaignId}_${dayKey}`);
  // Admin-granted spins (customers.spinsRemaining, written by adminGrantSpins)
  // are BONUS spins spendable on top of the daily cap. They used to be
  // decremented on every spin and gate nothing at all, so granting or clearing
  // the balance changed nothing the customer could actually use.
  const capMessage = `You've used all ${spinsPerDay} spin${spinsPerDay === 1 ? '' : 's'} for today. Come back tomorrow!`;
  const usedPre = Number((await counterRef.get()).get('count') ?? 0);
  if (usedPre >= spinsPerDay && Number(custPre.get('spinsRemaining') ?? 0) <= 0) {
    throw new HttpsError('resource-exhausted', capMessage);
  }

  const outcome = await db.runTransaction(async (tx) => {
    // All reads first (Firestore requires it): profile, campaign (for the slice
    // usage counters) and today's spin counter.
    const [custSnap, campTxSnap, counterSnap] = await Promise.all([
      tx.get(custRef),
      tx.get(campRef),
      tx.get(counterRef),
    ]);
    if (!custSnap.exists) throw new HttpsError('not-found', 'Customer profile not found.');
    const remaining = Number(custSnap.get('spinsRemaining') ?? 0);
    const usedToday = Number(counterSnap.get('count') ?? 0);
    const exhaustedDaily = usedToday >= spinsPerDay;
    // Re-check inside the transaction: past the daily cap this spin is paid for
    // out of the granted balance, so it must still have one left.
    if (exhaustedDaily && remaining <= 0) throw new HttpsError('resource-exhausted', capMessage);
    const walletBefore = Number(custSnap.get('wallet.balancePaise') ?? 0);
    // Live cashback pool: the slice of the CURRENT balance that came from
    // cashback and is therefore spendable but never refundable. Distinct from
    // `wallet.breakdown.cashbackPaise`, which is a lifetime tally nothing ever
    // decrements. Clamped on read — a wallet that predates this field has none
    // (→ 0, fully refundable), and adminAdjustWallet can debit the balance
    // without touching the pool, which would otherwise leave it above the
    // balance it is supposed to be a subset of.
    const cashbackPoolBefore = Math.max(
      0,
      Math.min(Number(custSnap.get('wallet.cashbackBalancePaise') ?? 0), walletBefore),
    );

    const slice = pickWeighted(slices);
    const isCoupon =
      slice.prizeType === 'flat_discount' ||
      slice.prizeType === 'percent_discount' ||
      slice.prizeType === 'free_shipping';
    const isCashback = slice.prizeType === 'cashback';
    const cashbackAmt = isCashback ? Number(slice.discountValuePaise ?? 0) : 0;
    let couponCode: string | null = null;

    const spinRef = db.collection('spinHistory').doc();

    // Spend a granted spin only when it is the thing that authorised this spin —
    // spins inside the daily cap must not silently drain the admin's grant.
    const custUpdate: Record<string, unknown> = {
      ...(exhaustedDaily ? { spinsRemaining: Math.max(0, remaining - 1) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (cashbackAmt > 0) {
      custUpdate['wallet.balancePaise'] = FieldValue.increment(cashbackAmt);
      custUpdate['wallet.breakdown.cashbackPaise'] = FieldValue.increment(cashbackAmt);
      // …and the LIVE pool, which is what checkout spends first and what keeps
      // this prize out of any future refund. Written as an absolute value from
      // the clamped read above (not an increment) so a pool that had drifted
      // above the balance is repaired here instead of compounding.
      custUpdate['wallet.cashbackBalancePaise'] = cashbackPoolBefore + cashbackAmt;
      custUpdate['wallet.lifetimeCreditsPaise'] = FieldValue.increment(cashbackAmt);
      custUpdate['wallet.lastTransactionAt'] = FieldValue.serverTimestamp();
    }
    tx.update(custRef, custUpdate);

    if (isCoupon) {
      couponCode = code();
      // Floor at one day: the editor hides the validity input for the "special"
      // prize types, so a free-shipping slice can carry validityDays 0 — which
      // used to mint a coupon that had already expired when it was handed over.
      const days = Math.max(1, Number(slice.validityDays ?? 30));
      const expiresAt = Timestamp.fromMillis(now + days * 86400_000);
      const discountType =
        slice.prizeType === 'flat_discount' ? 'flat' : slice.prizeType === 'percent_discount' ? 'percent' : 'free_shipping';
      const sliceCapPaise = Number(slice.discountMaxCapPaise ?? 0);
      const cRef = db.collection(`customers/${uid}/coupons`).doc();
      tx.set(cRef, {
        id: cRef.id, code: couponCode, title: slice.displayLabel, description: slice.secondaryLabel,
        discountType,
        discountValuePaise: slice.discountValuePaise ?? null,
        discountPercent: slice.discountPercent ?? null,
        discountMaxCapPaise:
          discountType === 'percent'
            ? sliceCapPaise > 0
              ? sliceCapPaise
              : DEFAULT_PERCENT_CAP_PAISE
            : slice.discountMaxCapPaise ?? null,
        minCartValuePaise: slice.minCartValuePaise ?? 0,
        source: 'spin', campaignId, spinHistoryId: spinRef.id,
        status: 'active', issuedAt: FieldValue.serverTimestamp(), expiresAt,
        usedAt: null, usedOnOrderId: null, usedOnOrderShortId: null,
        maxUsesPerCoupon: 1, usesCount: 0, isNew: true,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (cashbackAmt > 0) {
      const txRef = db.collection(`customers/${uid}/walletTransactions`).doc();
      tx.set(txRef, {
        // Real running balance, like every other walletTransactions writer —
        // this used to be hardcoded 0 and broke any ledger reconciliation.
        id: txRef.id, type: 'credit', source: 'spin_reward', amountPaise: cashbackAmt,
        balanceAfterPaise: walletBefore + cashbackAmt,
        // `title` is required by the shared WalletTransaction type and is what
        // the app/web ledger rows render; it was missing, so both surfaces fell
        // back to their source-derived label. Store the same string explicitly.
        title: 'Spin reward credited',
        description: 'Spin & Win cashback', refType: 'spin', refId: spinRef.id,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    tx.set(spinRef, {
      id: spinRef.id, campaignId, customerId: uid, sliceId: slice.id, prizeType: slice.prizeType,
      label: slice.displayLabel, couponCode, createdAt: FieldValue.serverTimestamp(),
    });
    // Per-slice usage — the admin editor documents `usedCount` as "how many
    // players landed on it", but nothing ever incremented it, so it was 0
    // forever (or frozen seed data). It lives inside the `slices` array, so it
    // has to be rewritten from the copy read in this transaction rather than
    // incremented in place.
    const txSlices = (campTxSnap.get('slices') as Slice[] | undefined) ?? slices;
    tx.update(campRef, {
      slices: txSlices.map((s) =>
        s.id === slice.id ? { ...s, usedCount: Number(s.usedCount ?? 0) + 1 } : s,
      ),
      totalSpins: FieldValue.increment(1),
      ...(isCoupon ? { totalCouponsIssued: FieldValue.increment(1) } : {}),
    });
    // Today's spin count for this campaign (the daily-cap source of truth).
    tx.set(
      counterRef,
      { campaignId, dayKey, count: usedToday + 1, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    return { slice, couponCode };
  });

  return {
    sliceId: outcome.slice.id, // lets the web wheel land on the exact winning slice
    label: outcome.slice.displayLabel,
    secondaryLabel: outcome.slice.secondaryLabel,
    couponCode: outcome.couponCode,
    prizeType: outcome.slice.prizeType,
  };
});
