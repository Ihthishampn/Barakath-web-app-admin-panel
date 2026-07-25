/**
 * Shared order cancellation — restock, wallet refund, affiliate reversal.
 *
 * Both cancel paths (customer `cancelOrder` and admin `adminChangeOrderStatus`
 * → 'cancelled') funnel through here. They used to diverge: the admin path only
 * stamped metadata, so an admin cancellation silently kept the customer's money
 * and left stock decremented. One implementation means they can't drift again.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../_lib/admin.js';
import { revokeInvoiceForOrder } from './invoice.js';
import { notifyOrderStatus, notifyRefundCredited } from '../notifications/events.js';

export interface CancelOptions {
  orderId: string;
  /** Who performed it — stamped on the order, timeline and ledger. */
  actorUid: string;
  reason: string;
  /** Customer-initiated cancels must own the order; admin cancels skip this. */
  requireOwnerUid?: string;
  /** Statuses the caller permits; the admin path validates its own graph. */
  allowedStatuses?: string[];
  /**
   * Payment statuses the caller permits, asserted against the LOCKED order
   * inside the transaction.
   *
   * `verifyPayment` captures by setting `paymentStatus: 'captured'` WITHOUT
   * touching `status`, so `allowedStatuses` alone cannot see a capture that
   * lands between a caller's own pre-check and this transaction. The abandoned
   * order sweep needs that race to be lost safely: a payment arriving mid-sweep
   * must win, and the order must not be cancelled out from under it.
   */
  requirePaymentStatus?: string[];
}

/**
 * Cancels an order atomically: restores variant + product stock, refunds any
 * captured amount to the wallet with a ledger row, reverses a pending affiliate
 * commission, and writes the status + timeline entry.
 */
export async function performCancellation(opts: CancelOptions): Promise<void> {
  const { orderId, actorUid, reason, requireOwnerUid, allowedStatuses, requirePaymentStatus } =
    opts;

  // Queries can't run inside a transaction, so the (legacy) item lines and any
  // linked commission are read up front. New orders embed items on the order
  // document; the subcollection read is a fallback for orders placed before the
  // single-document migration.
  const legacyItemsSnap = await db.collection(`orders/${orderId}/items`).get();
  const legacyLines = legacyItemsSnap.docs.map((d) => d.data() as Record<string, unknown>);
  const commissionSnap = await db
    .collection('commissions')
    .where('orderId', '==', orderId)
    .get();

  // Set by the attempt that commits (reset on every attempt, so a transaction
  // retry cannot leave a stale value behind). A Storage delete cannot be part of
  // a Firestore transaction — and must not be retried with one — so it runs
  // after the commit, from this.
  let publishedInvoice: { shortId: string | null } | null = null;

  /**
   * What the customer has to be told once this actually commits. Set on the
   * committing attempt only (reset per attempt, like publishedInvoice), because
   * a notification for a cancellation that was rolled back would be a lie.
   */
  let cancelled: {
    customerId: string;
    shortId: string | null;
    refundPaise: number;
  } | null = null;

  await db.runTransaction(async (tx) => {
    publishedInvoice = null;
    cancelled = null;
    const orderRef = db.doc(`orders/${orderId}`);

    // ── all reads first (Firestore forbids a read after a write) ──
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) throw new HttpsError('not-found', 'Order not found.');
    const o = orderSnap.data() as Record<string, unknown>;

    if (requireOwnerUid && o.customerId !== requireOwnerUid) {
      throw new HttpsError('permission-denied', 'Not your order.');
    }
    if (allowedStatuses && !allowedStatuses.includes(o.status as string)) {
      throw new HttpsError('failed-precondition', 'This order can no longer be cancelled.');
    }
    if (o.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'This order is already cancelled.');
    }
    // Asserted against the locked document, so a capture committing between the
    // caller's pre-check and this transaction aborts the cancellation instead of
    // racing it.
    if (requirePaymentStatus && !requirePaymentStatus.includes(String(o.paymentStatus ?? ''))) {
      throw new HttpsError('failed-precondition', 'This order has since been paid.');
    }

    const customerId = String(o.customerId ?? '');
    // Prefer the embedded items array; fall back to the legacy subcollection.
    const embedded = Array.isArray(o.items) ? (o.items as Array<Record<string, unknown>>) : [];
    const lines = embedded.length > 0 ? embedded : legacyLines;
    // A cart can hold two variants of the SAME product, i.e. two lines with one
    // productId. Reading (and writing) the document once per line would mean two
    // whole-`variants`-array writes built from the same pre-transaction snapshot,
    // the second silently discarding the first — so group by product id and
    // restock every line of a product into a single copy of its array.
    const productIds = [...new Set(lines.map((l) => String(l.productId ?? '')))].filter(Boolean);
    const productSnaps = await Promise.all(
      productIds.map((id) => tx.get(db.doc(`products/${id}`))),
    );
    const refundPaise = Number(o.amountPaidPaise ?? 0);
    // The cashback slice of this order's wallet payment (placeOrder spends the
    // live cashback pool first and stamps the split on the order).
    //
    // A cancelled order never happened, so the customer must not LOSE the prize
    // they won — the full `refundPaise` still goes back to the balance below.
    // But it must not become refundable either, or cancelling an order would
    // launder cashback into withdrawable money: so this much also goes back into
    // the live pool, spendable again and still excluded from every future
    // refund. Capped at refundPaise — a razorpay order that was never captured
    // only refunds its wallet part, and we cannot restore more than we return.
    // Absent on legacy orders (nothing was ever classified) → restore nothing.
    const cashbackRestorePaise = Math.max(
      0,
      Math.min(Number(o.walletCashbackPaise ?? 0), refundPaise),
    );
    const custRef = customerId ? db.doc(`customers/${customerId}`) : null;
    const custSnap = custRef ? await tx.get(custRef) : null;

    // Payment record (written by placeOrder / verifyPayment, keyed by order id).
    // Read it now so the write phase can settle it without a read-after-write.
    const paymentRef = db.doc(`payments/${orderId}`);
    const paymentSnap = await tx.get(paymentRef);

    // Releasing the coupon the order consumed (see placeOrder) — read the docs
    // now so the write phase can restore them without a read-after-write.
    //
    // The identity is taken from the flat `couponId` / `userCouponId` fields
    // placeOrder now stamps, falling back to the nested `appliedCoupon` for
    // orders placed before they existed. `couponReleasedAt` makes the release
    // single-shot: performCancellation already refuses to run on an order that
    // is 'cancelled', but a counter is the one thing that can never be
    // reconstructed if some future path double-releases it.
    const applied = (o.appliedCoupon as Record<string, unknown> | null) ?? null;
    const alreadyReleased = !!o.couponReleasedAt;
    // A deferred (razorpay) order that was cancelled BEFORE its payment never
    // consumed its coupon (placeOrder stamps `couponConsumedAt: null` and
    // verifyPayment sets it on capture) — so there is nothing to release, and
    // decrementing the counter would push it BELOW what other orders hold.
    // `=== null` matches only those: a legacy order has no such field (undefined)
    // and a consumed order carries a timestamp, both of which release normally.
    const neverConsumed = o.couponConsumedAt === null;
    const skipRelease = alreadyReleased || neverConsumed;
    const userCouponId = skipRelease
      ? null
      : (o.userCouponId as string | null) ?? (applied?.userCouponId as string | null) ?? null;
    const promoCouponId = skipRelease
      ? null
      : (o.couponId as string | null) ?? (applied?.couponId as string | null) ?? null;
    const userCouponRef =
      userCouponId && customerId ? db.doc(`customers/${customerId}/coupons/${userCouponId}`) : null;
    const userCouponSnap = userCouponRef ? await tx.get(userCouponRef) : null;
    const promoCouponRef = promoCouponId ? db.doc(`coupons/${promoCouponId}`) : null;
    const promoCouponSnap = promoCouponRef ? await tx.get(promoCouponRef) : null;
    const usageSnap =
      promoCouponId && customerId
        ? await tx.get(db.doc(`customers/${customerId}/couponUsage/${promoCouponId}`))
        : null;

    // A commission only needs reversing while it is still pending — once it has
    // cleared to the affiliate's confirmed balance it may already be withdrawn.
    const pendingCommissions = commissionSnap.docs.filter(
      (d) => (d.data() as { status?: string }).status === 'pending',
    );
    const affiliateRefs = pendingCommissions.map((d) =>
      db.doc(`customers/${(d.data() as { affiliateUid: string }).affiliateUid}`),
    );
    await Promise.all(affiliateRefs.map((r) => tx.get(r)));

    // ── writes ──
    productIds.forEach((productId, i) => {
      const snap = productSnaps[i]!;
      if (!snap.exists) return;
      const p = snap.data() as Record<string, unknown>;
      const variants = ((p.variants as Array<Record<string, unknown>>) ?? []).map((v) => ({ ...v }));
      let totalQty = 0;
      let plainQty = 0;
      let touchedVariants = false;
      for (const l of lines) {
        if (String(l.productId ?? '') !== productId) continue;
        const qty = Number(l.quantity ?? 0);
        if (qty <= 0) continue;
        totalQty += qty;
        if (l.variantId) {
          const v = variants.find((x) => x.id === l.variantId);
          if (v) {
            v.stock = Number(v.stock ?? 0) + qty;
            touchedVariants = true;
            continue;
          }
          // Variant row gone — the top-level counter is the only place left to
          // put the units back.
          plainQty += qty;
          continue;
        }
        plainQty += qty;
      }
      if (totalQty <= 0) return;
      const upd: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
      };
      // Mirror placeOrder exactly: variant units go back to their `variants[]`
      // row, and only variant-less units touch the top-level counter (which is
      // not an aggregate — see orders/reservations.ts). Restoring variant units
      // here as well used to inflate `products.stock` on a product where nothing
      // had ever debited it.
      if (plainQty > 0) upd.stock = FieldValue.increment(plainQty);
      // Mirror the soldCount bump placeOrder applies, clamped so a product whose
      // counter was never incremented (legacy order) can't go negative.
      const soldDelta = Math.min(totalQty, Number(p.soldCount ?? 0));
      if (soldDelta > 0) upd.soldCount = FieldValue.increment(-soldDelta);
      if (touchedVariants) upd.variants = variants;
      tx.update(snap.ref, upd);
    });

    if (custRef && custSnap?.exists) {
      const custUpdate: Record<string, unknown> = {
        // Lifetime stats — nothing else maintains them.
        'stats.ordersCancelled': FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      };

      // placeOrder adds the whole order total to lifetime spend at PLACEMENT —
      // before a rupee is collected on a razorpay order — so a cancellation has
      // to take it back or a place→cancel loop inflates "total spent" without
      // bound on the admin Customers list and in reports. Clamped to what the
      // customer has actually accumulated so a legacy order (placed before the
      // counter existed) can't drive it negative.
      //
      // `stats.ordersCount` is deliberately NOT reversed: it is what
      // firstOrderOnly / targetUsers:'new' are judged on, and giving a customer
      // their "new customer" status back by cancelling is exactly the abuse the
      // coupon rules exist to stop.
      const orderTotalPaise = Number(o.totalPaise ?? 0);
      if (orderTotalPaise > 0) {
        const spent = Number(
          (custSnap.get('stats') as Record<string, unknown> | undefined)?.totalSpentPaise ?? 0,
        );
        const reverse = Math.min(orderTotalPaise, Math.max(0, spent));
        if (reverse > 0) custUpdate['stats.totalSpentPaise'] = FieldValue.increment(-reverse);
      }
      if (refundPaise > 0) {
        custUpdate['wallet.balancePaise'] = FieldValue.increment(refundPaise);
        custUpdate['wallet.breakdown.refundsPaise'] = FieldValue.increment(refundPaise);
        custUpdate['wallet.lifetimeCreditsPaise'] = FieldValue.increment(refundPaise);
        custUpdate['wallet.lastTransactionAt'] = FieldValue.serverTimestamp();
      }
      if (cashbackRestorePaise > 0) {
        // Absolute, from the value read in this transaction and clamped to the
        // balance it describes — same treatment placeOrder/executeSpin give it,
        // so drift is repaired rather than carried forward. Still inside the
        // invariant: the pool we restore to is ≤ the pre-refund balance and the
        // amount restored is ≤ refundPaise, so the result is ≤ the new balance.
        const walletNow = (custSnap.get('wallet') as Record<string, unknown>) ?? {};
        const poolNow = Math.max(
          0,
          Math.min(Number(walletNow.cashbackBalancePaise ?? 0), Number(walletNow.balancePaise ?? 0)),
        );
        custUpdate['wallet.cashbackBalancePaise'] = poolNow + cashbackRestorePaise;
      }
      tx.update(custRef, custUpdate);
    }

    if (refundPaise > 0 && custSnap?.exists) {
      const balanceAfter =
        Number((custSnap.get('wallet') as Record<string, unknown>)?.balancePaise ?? 0) + refundPaise;
      const txRef = db.collection(`customers/${customerId}/walletTransactions`).doc();
      tx.set(txRef, {
        id: txRef.id,
        type: 'credit',
        source: 'refund',
        amountPaise: refundPaise,
        balanceAfterPaise: balanceAfter,
        description: `Refund for cancelled order ${(o.shortId as string) ?? orderId}`,
        refType: 'order',
        refId: orderId,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    pendingCommissions.forEach((d, i) => {
      const c = d.data() as { affiliateUid: string; commissionPaise: number };
      const amount = Number(c.commissionPaise ?? 0);
      tx.update(d.ref, {
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (amount > 0) {
        tx.update(affiliateRefs[i]!, {
          'affiliate.pendingBalancePaise': FieldValue.increment(-amount),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    // ── Release the coupon this order consumed ──────────────────────
    //
    // placeOrder burns it at placement (personal coupon → uses + 'used';
    // promotional → usesCount + the per-customer counter), so a cancelled order
    // that released nothing would permanently destroy a spin prize the customer
    // owns and consume a slice of the store's coupon budget for a sale that
    // never happened.
    //
    // Every write below is an ABSOLUTE value derived from the snapshot read in
    // this transaction and floored at zero — never `FieldValue.increment(-1)`.
    // A blind decrement (and, worse, a merge-set that CREATES the counter
    // document at −1 when the order never incremented it: a legacy order, a
    // coupon deleted and recreated, a re-run) leaves the coupon reading as
    // "budget still available" for two more redemptions than the admin ever
    // configured. That is a limit silently becoming a bigger limit, which is the
    // one thing a usage cap must never do.
    let couponReleased = false;

    // The customer's OWN prize goes back — but only if this order is the one
    // holding it (`usedOnOrderId`), or the order predates that stamp. Without
    // the check, cancelling an old order could reset a coupon a LATER order is
    // currently relying on, and hand the customer a second free redemption.
    if (userCouponRef && userCouponSnap?.exists) {
      const uc = userCouponSnap.data() as Record<string, unknown>;
      const heldBy = (uc.usedOnOrderId as string | null) ?? null;
      if (heldBy == null || heldBy === orderId) {
        const expiresMs = (uc.expiresAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
        tx.update(userCouponRef, {
          // Handing back a use does not un-expire the coupon; the expiry sweep
          // would only flip it again, and in the meantime it would be offered
          // on both storefronts as redeemable.
          status: expiresMs > 0 && expiresMs < Date.now() ? 'expired' : 'active',
          usedAt: null,
          usedOnOrderId: null,
          usedOnOrderShortId: null,
          usesCount: Math.max(0, Math.max(0, Number(uc.usesCount ?? 0)) - 1),
          updatedAt: FieldValue.serverTimestamp(),
        });
        couponReleased = true;
      }
    }

    if (promoCouponId) {
      // The STORE'S budget (maxUsesTotal) comes back: no sale happened, so the
      // coupon should still be redeemable by someone.
      if (promoCouponRef && promoCouponSnap?.exists) {
        const c = promoCouponSnap.data() as Record<string, unknown>;
        tx.update(promoCouponRef, {
          usesCount: Math.max(0, Math.max(0, Number(c.usesCount ?? 0)) - 1),
          updatedAt: FieldValue.serverTimestamp(),
        });
        couponReleased = true;
      }
      // The PER-CUSTOMER counter deliberately does NOT come back.
      //
      // `maxUsesPerUser` is not a budget, it is an anti-abuse cap — "this
      // customer may redeem this coupon N times". Handing it back on
      // cancellation turned it into "N times CONCURRENTLY": placing an order
      // costs nothing (an online order sits 'pending' until it is paid), so a
      // customer could place → cancel → place again without limit and a coupon
      // the owner capped at one use appeared on order after order. That is the
      // reported defect. A cancellation is recorded on the counter instead, so
      // the admin can still see it happened and lift it by hand if the
      // cancellation was the store's fault.
      if (customerId) {
        // update, not merge-set: only an existing counter is annotated. A
        // cancellation must never CREATE a usage record for a redemption that
        // was never counted.
        const usageRef = db.doc(`customers/${customerId}/couponUsage/${promoCouponId}`);
        if (usageSnap?.exists) {
          tx.update(usageRef, {
            cancelledCount: Math.max(0, Number(usageSnap.get('cancelledCount') ?? 0)) + 1,
            lastCancelledAt: FieldValue.serverTimestamp(),
          });
        }
      }
    }

    // Settle the payment row so the admin Payments page doesn't keep showing a
    // captured/pending payment for a cancelled order. Only touch an existing
    // document — a cancelled legacy order should not gain a payment record.
    if (paymentSnap.exists) {
      tx.update(paymentRef, {
        status: refundPaise > 0 ? 'refunded' : 'failed',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // Withdraw the invoice. Both storefronts show "Download PDF" purely on the
    // presence of `invoiceUrl`, so a cancelled order would otherwise keep
    // handing the customer a document headed "Tax Invoice" for the full total —
    // against an order that will never ship and whose money has just been
    // refunded. Clearing the fields here (same transaction as the cancellation)
    // removes it from every client; the Storage object itself is deleted after
    // the commit, which is what revokes the tokened URL already in the wild.
    // An admin who needs a copy can still re-publish it from the Order detail
    // screen (adminGenerateInvoice), which mints a fresh token.
    if (o.invoiceUrl) publishedInvoice = { shortId: (o.shortId as string | null) ?? null };

    const now = FieldValue.serverTimestamp();
    tx.update(orderRef, {
      status: 'cancelled',
      cancelledAt: now,
      cancellationReason: reason,
      cancelledByUid: actorUid,
      paymentStatus: refundPaise > 0 ? 'refunded' : (o.paymentStatus ?? 'pending'),
      invoiceUrl: null,
      invoiceGeneratedAt: null,
      // Stamped only when a counter actually moved, so the release can never be
      // replayed against this order.
      ...(couponReleased ? { couponReleasedAt: now } : {}),
      updatedAt: now,
    });
    const tlRef = db.collection(`orders/${orderId}/timeline`).doc();
    tx.set(tlRef, {
      id: tlRef.id,
      status: 'cancelled',
      at: now,
      byUid: actorUid,
      note: reason,
      meta: {},
      createdAt: now,
    });
    cancelled = {
      customerId,
      shortId: (o.shortId as string | null) ?? null,
      refundPaise: custSnap?.exists ? refundPaise : 0,
    };
  });

  // Only once the cancellation is committed: the order no longer points at the
  // object, so deleting it can never orphan a live link. Never fatal.
  const invoice = publishedInvoice as { shortId: string | null } | null;
  if (invoice) await revokeInvoiceForOrder(orderId, invoice.shortId);

  // Both cancellation paths (customer cancelOrder, admin status change) and the
  // abandoned-order sweep funnel through here, so notifying from here is what
  // stops the three of them drifting. Every helper swallows its own errors —
  // the cancellation and its refund have already committed.
  const done = cancelled as { customerId: string; shortId: string | null; refundPaise: number } | null;
  if (done?.customerId) {
    await notifyOrderStatus({
      customerId: done.customerId,
      orderId,
      orderShortId: done.shortId,
      status: 'cancelled',
      note: reason,
    });
    if (done.refundPaise > 0) {
      await notifyRefundCredited({
        customerId: done.customerId,
        // Deterministic (not the ledger row's generated id): one cancellation
        // per order, so a re-run can never announce the refund twice.
        eventId: `refund_cancel_${orderId}`,
        amountPaise: done.refundPaise,
        orderId,
        orderShortId: done.shortId,
        cause: 'cancellation',
      });
    }
  }
}
