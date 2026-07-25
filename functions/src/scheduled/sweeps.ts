/**
 * Scheduled maintenance sweeps.
 *
 * `couponExpirySweep` reconciles the persisted `status` of expired coupons so
 * the Active/Used/Expired buckets shown in the Admin Panel, User Web and User
 * App are correct without waiting for a read. Note this is a *convenience*
 * reconciliation only — the authoritative "an expired coupon cannot be used"
 * rule is ALSO enforced at read time in `computeCouponDiscount` (checkout.ts),
 * so a coupon is unusable the instant it expires even between sweeps.
 *
 * Two coupon collections are swept:
 *   - Promotional `coupons`            — field `validUntil` (null = no expiry).
 *   - Personal `customers/{uid}/coupons` — field `expiresAt`.
 * Used coupons are never touched (only `status == 'active'` is flipped).
 *
 * `stockReservationSweep` is the safety net for checkout stock holds: it gives
 * back the stock of any reservation whose 15-minute window elapsed without the
 * client releasing or consuming it (app killed, network lost, phone died).
 * Unlike the coupon sweep this one moves real inventory, so it is NOT a
 * convenience reconciliation — it is the only thing standing between a
 * closed app and permanently unsellable stock.
 *
 * `abandonedOrderSweep` is the same safety net one layer further in. The stock
 * RESERVATION sweep cannot help once an order exists: placeOrder consumes the
 * hold (marks it 'consumed') and decrements the catalogue itself, so an online
 * order the customer never paid for holds its units on the order document
 * instead — indefinitely, because nothing else ever cancels it.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { Query, type QueryDocumentSnapshot } from 'firebase-admin/firestore';

import { db, FieldValue, Timestamp, REGION } from '../_lib/admin.js';
import { RESERVATIONS, reservationLines, restoreReservedStock } from '../orders/reservations.js';
import { performCancellation } from '../orders/cancel.js';

/** Firestore caps a batch at 500 writes; stay under it. */
const BATCH_LIMIT = 400;

/**
 * Flip every expired-but-still-active coupon to `status: 'expired'`, in both
 * the promotional and personal collections. Returns how many of each it moved.
 * Exported so it can be invoked directly (scheduler handler + verification).
 */
export async function sweepExpiredCoupons(
  now = Timestamp.now(),
): Promise<{ promo: number; personal: number }> {
  const promo = await _sweep(
    // Promotional coupons past their validUntil (missing/null validUntil is
    // "no expiry" and is naturally excluded by the inequality).
    db.collection('coupons').where('validUntil', '<', now),
    now,
    (data) => data.status !== 'expired',
  );

  const personal = await _sweep(
    // Personal (won) coupons past their expiresAt. collectionGroup also matches
    // the top-level `coupons` collection, but those docs have no `expiresAt`
    // field so they never satisfy this inequality — no double processing.
    db
      .collectionGroup('coupons')
      .where('status', '==', 'active')
      .where('expiresAt', '<', now),
    now,
    () => true, // status == 'active' already filtered in the query
  );

  return { promo, personal };
}

/** Page through [query], batching `status: 'expired'` updates for matches. */
async function _sweep(
  query: Query,
  now: Timestamp,
  shouldFlip: (data: FirebaseFirestore.DocumentData) => boolean,
): Promise<number> {
  const snap = await query.get();
  let moved = 0;
  let batch = db.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    if (!shouldFlip(doc.data())) continue;
    batch.update(doc.ref, { status: 'expired', updatedAt: now });
    moved++;
    pending++;
    if (pending >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
  return moved;
}

/**
 * Runs daily at 00:15 IST. Cloud Scheduler triggers this in production; the
 * local emulator does not auto-fire scheduled functions, so tests invoke
 * [sweepExpiredCoupons] directly.
 */
export const couponExpirySweep = onSchedule(
  { region: REGION, schedule: 'every day 00:15', timeZone: 'Asia/Kolkata' },
  async () => {
    const { promo, personal } = await sweepExpiredCoupons();
    logger.info(
      `couponExpirySweep: expired ${promo} promotional and ${personal} personal coupon(s).`,
    );
  },
);

// ── Stock reservations ─────────────────────────────────────────────

/** Most reservations reclaimed in a single run (bounds the function's runtime). */
const RESERVATION_SWEEP_LIMIT = 500;
/**
 * Reservations reclaimed per transaction. Restoring stock has to read the
 * product documents and write each of them exactly once, which a `WriteBatch`
 * cannot do safely — a batch gives atomicity but no read isolation, so a
 * concurrent reserveStock could have its `variants[]` decrement overwritten by
 * this sweep's stale copy of the array. Reservations are therefore reclaimed in
 * small transactional chunks: batched enough to keep the run cheap, isolated
 * enough that stock arithmetic can never be lost.
 */
const RESERVATION_CHUNK = 20;

/**
 * Restore the stock of every expired-but-still-'active' reservation and mark it
 * 'expired'. Idempotent: each chunk re-reads its reservations inside the
 * transaction and skips any that another path (releaseStock, placeOrder,
 * an overlapping run) already settled, so stock is never given back twice.
 * Exported so it can be invoked directly (scheduler handler + verification).
 */
export async function sweepExpiredReservations(
  now = Timestamp.now(),
): Promise<{ expired: number }> {
  const snap = await db
    .collection(RESERVATIONS)
    .where('status', '==', 'active')
    .where('expiresAt', '<', now)
    .limit(RESERVATION_SWEEP_LIMIT)
    .get();

  let expired = 0;
  for (let i = 0; i < snap.docs.length; i += RESERVATION_CHUNK) {
    const refs = snap.docs.slice(i, i + RESERVATION_CHUNK).map((d) => d.ref);
    expired += await db.runTransaction(async (tx) => {
      // ── reads ──
      const fresh = await tx.getAll(...refs);
      const stale = fresh.filter((s) => s.exists && s.get('status') === 'active');
      if (stale.length === 0) return 0;

      const lines = stale.flatMap((s) => reservationLines(s.data()));
      const productIds = [...new Set(lines.map((l) => l.productId))];
      const productSnaps = await Promise.all(
        productIds.map((id) => tx.get(db.doc(`products/${id}`))),
      );

      // ── writes ── every product touched by the chunk is written once.
      restoreReservedStock(
        tx,
        new Map(productIds.map((id, idx) => [id, productSnaps[idx]!])),
        lines,
      );
      for (const s of stale) {
        tx.update(s.ref, { status: 'expired', updatedAt: FieldValue.serverTimestamp() });
      }
      return stale.length;
    });
  }

  if (snap.size >= RESERVATION_SWEEP_LIMIT) {
    logger.warn(
      `stockReservationSweep: hit the ${RESERVATION_SWEEP_LIMIT}-reservation cap; the remainder is picked up by the next run.`,
    );
  }
  return { expired };
}

/**
 * Runs every 5 minutes — a reservation lives 15 minutes, so an abandoned hold is
 * returned to the catalogue within ~20. Cloud Scheduler triggers this in
 * production; the local emulator does not auto-fire scheduled functions, so
 * tests invoke [sweepExpiredReservations] directly.
 */
export const stockReservationSweep = onSchedule(
  { region: REGION, schedule: 'every 5 minutes' },
  async () => {
    const { expired } = await sweepExpiredReservations();
    if (expired > 0) {
      logger.info(`stockReservationSweep: released ${expired} expired reservation(s).`);
    }
  },
);

// ── Abandoned (never-paid) online orders ───────────────────────────

/**
 * How long an unpaid online order holds its stock before it is reclaimed.
 *
 * Aligned with the checkout reservation window (RESERVATION_TTL_MS, 15 min): the
 * moment an order is placed its units come out of the catalogue, and if the
 * payment never lands they must go back on sale ~15 minutes later — the same
 * hold the storefront promises on every product, badged or not. The re-assert
 * inside `reclaimAbandonedOrder` (below) is what keeps this safe at 15 minutes:
 * it re-reads the order in a transaction and refuses to cancel one whose payment
 * has been captured in the meantime, so a customer still finishing a bank OTP is
 * never cancelled out from under a payment that actually went through — and if
 * their attempt failed, both clients keep offering "Pay now" until the sweep
 * reclaims it.
 */
export const ABANDONED_PAYMENT_GRACE_MS = 15 * 60 * 1000;

/** Cancellation reason stamped on the order, its timeline and the admin list. */
export const ABANDONED_PAYMENT_REASON = 'Payment not completed';

/** Orders examined per run — bounds the runtime and the read cost. */
const ABANDONED_ORDER_SWEEP_LIMIT = 200;

/**
 * Payment states that mean "no money has been taken for this order".
 *
 *  - 'pending' — placeOrder's initial state; the client died (or lost the
 *    network) before it could report anything back.
 *  - 'failed'  — the customer dismissed the gateway sheet or the payment was
 *    declined, and both clients report that via markPaymentFailed. This is the
 *    COMMON abandonment, and it holds stock exactly the same way 'pending'
 *    does, so leaving it out would miss most of what this sweep exists for.
 *
 * 'captured' and 'refunded' are never touched: money moved. Each state is
 * queried separately because the composite index that serves this
 * (`paymentMethod`, `paymentStatus`, `createdAt`) takes one equality per field.
 */
const UNPAID_STATUSES = ['pending', 'failed'] as const;

/**
 * Reclaim ONE abandoned order, re-asserting everything against the stored
 * document first. Returns whether it was cancelled.
 *
 * The re-assert is not belt-and-braces: the sweep's query result is a snapshot
 * that can be seconds old by the time this runs, and `verifyPayment` captures a
 * payment WITHOUT changing `order.status` — so `performCancellation`'s own
 * `allowedStatuses` check (which only sees `status`) cannot tell that money
 * landed in the meantime. Reading the order inside a transaction is what makes
 * the decision consistent with the document as it stands right now.
 */
async function reclaimAbandonedOrder(
  orderId: string,
  now: number,
): Promise<boolean> {
  const ref = db.doc(`orders/${orderId}`);
  const eligible = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const o = snap.data() as Record<string, unknown>;
    // Online orders only. COD was withdrawn, but legacy COD orders still exist
    // (some delivered ones sit at paymentStatus 'pending' for ever, because COD
    // was never captured through a gateway) and must never be swept.
    if (o.paymentMethod !== 'razorpay') return false;
    // An unpaid online order holds 'pending_payment' (current) or 'accepted'
    // (legacy). Anything further along was advanced by an admin who saw the
    // payment, and 'cancelled' is already done.
    if (o.status !== 'pending_payment' && o.status !== 'accepted') return false;
    if (!UNPAID_STATUSES.includes(o.paymentStatus as (typeof UNPAID_STATUSES)[number])) {
      return false;
    }
    // Anything actually paid wins, always.
    if (Number(o.amountPaidPaise ?? 0) > 0) return false;
    const placedMs = (o.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
    // No timestamp means no way to prove the order is old enough. Leave it.
    if (placedMs <= 0 || now - placedMs < ABANDONED_PAYMENT_GRACE_MS) return false;
    return true;
  });
  if (!eligible) return false;

  // Reuse the single cancellation implementation — stock restore, coupon
  // release, affiliate commission reversal, wallet refund, payment row, invoice
  // revocation and the timeline entry all behave exactly as they do for a
  // customer or admin cancellation. `allowedStatuses` re-checks `status`, and
  // `requirePaymentStatus` re-checks `paymentStatus` — both against the document
  // THAT transaction locks. The second is what closes the window between the
  // eligibility check above and the cancellation itself: `verifyPayment`
  // captures by setting `paymentStatus` without touching `status`, so a payment
  // landing in between is invisible to `allowedStatuses` alone. With it, the
  // capture wins and this throws 'failed-precondition' instead of cancelling a
  // paid order.
  await performCancellation({
    orderId,
    actorUid: 'system',
    reason: ABANDONED_PAYMENT_REASON,
    allowedStatuses: ['pending_payment', 'accepted'],
    requirePaymentStatus: [...UNPAID_STATUSES],
  });
  return true;
}

/**
 * Cancel online orders that were placed, never paid for, and never cancelled —
 * giving their stock back to the catalogue.
 *
 * Idempotent and safe to re-run: a reclaimed order leaves `status: 'accepted'`,
 * so the next run's own filter skips it, and every candidate is re-validated
 * inside a transaction immediately before it is cancelled. Ordered newest-first
 * so the freshest abandonments are always reclaimed even when a run is capped;
 * an order the cancellation failed on simply reappears in the next run.
 *
 * No `WriteBatch` is used at all — each order is cancelled by its own
 * transaction — so Firestore's 500-writes-per-commit cap cannot be reached by
 * batching here.
 *
 * Exported so it can be invoked directly (scheduler handler + verification).
 */
export async function sweepAbandonedOrders(
  now = Date.now(),
): Promise<{ reclaimed: number; scanned: number; capped: boolean }> {
  const cutoff = Timestamp.fromMillis(now - ABANDONED_PAYMENT_GRACE_MS);

  const candidates = new Map<string, QueryDocumentSnapshot>();
  let capped = false;
  for (const paymentStatus of UNPAID_STATUSES) {
    const snap = await db
      .collection('orders')
      .where('paymentMethod', '==', 'razorpay')
      .where('paymentStatus', '==', paymentStatus)
      .where('createdAt', '<', cutoff)
      .orderBy('createdAt', 'desc')
      .limit(ABANDONED_ORDER_SWEEP_LIMIT)
      .get();
    if (snap.size >= ABANDONED_ORDER_SWEEP_LIMIT) capped = true;
    // `status` cannot join the query — a fourth equality would need an index
    // that does not exist — so already-cancelled unpaid orders are filtered
    // here. They keep their unpaid `paymentStatus` for ever, which is exactly
    // why the query is newest-first: the recent, actionable orders are always
    // at the head of the page.
    for (const d of snap.docs) {
      // An unpaid online order sits at 'pending_payment' (its normal state now)
      // or 'accepted' (legacy orders placed before acceptance was deferred).
      // Anything further along was advanced by an admin who saw the payment.
      const s = d.get('status');
      if (s === 'pending_payment' || s === 'accepted') candidates.set(d.id, d);
    }
  }

  let reclaimed = 0;
  for (const orderId of candidates.keys()) {
    try {
      if (await reclaimAbandonedOrder(orderId, now)) reclaimed++;
    } catch (e) {
      // One bad order must not stop the rest of the run; it is re-attempted on
      // the next one because nothing about it changed.
      logger.error(`abandonedOrderSweep: could not reclaim order ${orderId}`, e);
    }
  }

  if (capped) {
    logger.warn(
      `abandonedOrderSweep: hit the ${ABANDONED_ORDER_SWEEP_LIMIT}-order scan cap; the remainder is picked up by the next run.`,
    );
  }
  return { reclaimed, scanned: candidates.size, capped };
}

/**
 * Runs every 5 minutes. With a 15-minute grace an abandoned order's stock is
 * back on sale within ~20 minutes of placement — matching the checkout
 * reservation hold. Cloud Scheduler triggers this in production; the local
 * emulator does not auto-fire scheduled functions, so tests invoke
 * [sweepAbandonedOrders] directly.
 */
export const abandonedOrderSweep = onSchedule(
  { region: REGION, schedule: 'every 5 minutes' },
  async () => {
    const { reclaimed, scanned } = await sweepAbandonedOrders();
    if (reclaimed > 0 || scanned > 0) {
      logger.info(
        `abandonedOrderSweep: cancelled ${reclaimed} unpaid order(s) out of ${scanned} candidate(s).`,
      );
    }
  },
);

// ── Flash sale status ───────────────────────────────────────────────

/**
 * Reconcile every non-`cancelled` flash sale's `status` against its time
 * window, so the storefront rail (which queries `status == 'active'`) picks
 * up a scheduled sale the moment it starts and drops it the moment it ends
 * without an admin having to flip anything by hand. Mirrors the coupon expiry
 * sweep: a *convenience* reconciliation, not the sole gate — `useActiveFlashSale`
 * also re-checks the time window client-side, so a sale never outlives its
 * window even mid-interval.
 *
 * Flash sales are few (a store runs a handful at a time), so this reads the
 * whole collection rather than an inequality query — no composite index to
 * maintain, and the cost is negligible either way.
 */
export async function sweepFlashSaleStatus(
  now = Timestamp.now(),
): Promise<{ flipped: number }> {
  const snap = await db.collection('flashSales').get();
  const nowMs = now.toMillis();
  let batch = db.batch();
  let pending = 0;
  let flipped = 0;

  for (const doc of snap.docs) {
    const d = doc.data() as { status?: string; startsAt?: Timestamp; endsAt?: Timestamp };
    if (d.status === 'cancelled') continue; // an admin's terminal call — never overridden
    const starts = d.startsAt?.toMillis?.() ?? 0;
    const ends = d.endsAt?.toMillis?.() ?? 0;
    const want = nowMs < starts ? 'scheduled' : nowMs <= ends ? 'active' : 'ended';
    if (d.status === want) continue;
    batch.update(doc.ref, { status: want, updatedAt: now });
    flipped++;
    pending++;
    if (pending >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
  return { flipped };
}

/**
 * Runs every 15 minutes. Cloud Scheduler triggers this in production; the
 * local emulator does not auto-fire scheduled functions, so tests invoke
 * [sweepFlashSaleStatus] directly.
 */
export const flashSaleStatusFlip = onSchedule(
  { region: REGION, schedule: 'every 15 minutes' },
  async () => {
    const { flipped } = await sweepFlashSaleStatus();
    if (flipped > 0) logger.info(`flashSaleStatusFlip: updated ${flipped} flash sale(s).`);
  },
);
