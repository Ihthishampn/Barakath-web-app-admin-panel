/**
 * adminApproveOrderRequest / adminRejectOrderRequest — return decisions.
 * Approve is money-moving: when Settings ▸ Storefront ▸ Returns has
 * "Auto-refund to wallet" ON it credits the refund to the customer's wallet and
 * writes an immutable walletTransactions ledger entry, all atomically. With the
 * toggle OFF the return is still approved but no money moves — the request is
 * left marked for a manual payout to the original payment method. The
 * orderRequests + walletTransactions collections are CF-only-write.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, FieldValue, callableOpts } from '../_lib/admin.js';
import { requireModule, writeAudit } from '../_lib/guards.js';
import { prepareCommissionReversal } from '../affiliate/commissions.js';
import { notifyRefundCredited, notifyReturnDecision } from '../notifications/events.js';

const OPEN = ['pending', 'under_review'];

export const adminApproveOrderRequest = onCall(callableOpts, async (req) => {
  const { uid: actor } = await requireModule(req, 'refunds', 'approve');
  const parsed = z.object({ requestId: z.string().min(1) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');
  const rref = db.doc(`orderRequests/${parsed.data.requestId}`);

  // Settings are not part of the atomic unit, so they're read outside the
  // transaction (same as requestReturnOrReplacement does for windowDays).
  // Default ON — matches the admin form's own default for a missing doc.
  const returnsSettings = await db.doc('settings/returns').get();
  const autoRefundToWallet = returnsSettings.get('autoRefundToWallet') !== false;

  const out = await db.runTransaction(async (tx) => {
    // ── reads first ──
    const snap = await tx.get(rref);
    if (!snap.exists) throw new HttpsError('not-found', 'Request not found.');
    const r = snap.data() as Record<string, any>;
    if (!OPEN.includes(r.status)) throw new HttpsError('failed-precondition', `Already ${r.status}.`);

    const requested = r.refundAmountPaise ?? (r.itemSnapshot?.priceAtPurchasePaise ?? 0) * (r.itemSnapshot?.quantity ?? 1);

    // A refund can never exceed what the customer actually paid for the order.
    // Load the order and derive the real received amount — this is what stops a
    // return from refunding money that was never captured (e.g. an online order
    // still 'pending' at the gateway). COD is treated as paid once delivered,
    // because the cash was collected even though paymentStatus stays 'pending'.
    // That COD branch is LEGACY-ONLY and deliberately kept: no new order can be
    // COD (placeOrder rejects it), but the ones placed before it was withdrawn
    // are still returnable, and dropping it would refuse every refund on them.
    const orderRef = r.orderId ? db.doc(`orders/${r.orderId}`) : null;
    const orderSnap = orderRef ? await tx.get(orderRef) : null;
    if (!orderSnap || !orderSnap.exists) {
      throw new HttpsError('failed-precondition', 'The order for this request no longer exists.');
    }
    const o = orderSnap.data() as Record<string, any>;
    const walletUsed = Number(o.walletUsedPaise ?? 0);
    // Of that wallet payment, only the part funded by the customer's OWN money
    // (top-ups, previous refunds) may come back — "Refund their amount only.
    // Cashback or discounted amount never returns to wallet." placeOrder spends
    // the cashback pool first and stamps the split on the order, so this is a
    // read, never a recomputation against a balance that has since moved.
    //
    // LEGACY: orders placed before the split existed carry no walletRealPaise.
    // Their composition is unknowable, and silently withholding money from a
    // customer who already paid is the worse failure — so the whole wallet
    // payment counts as real, exactly as it did before this rule. Clamped to
    // walletUsed so a malformed field can never inflate the cap.
    const walletRealPaise =
      o.walletRealPaise == null
        ? walletUsed
        : Math.max(0, Math.min(Number(o.walletRealPaise), walletUsed));
    const total = Number(o.totalPaise ?? 0);
    const method = String(o.paymentMethod ?? 'cod');
    const captured = o.paymentStatus === 'captured' || o.paymentStatus === 'refunded';
    const delivered = o.status === 'delivered' || !!o.deliveredAt;

    // Money genuinely received FROM THE CUSTOMER:
    //  • wallet portion — always taken at checkout, but only the real-money half
    //    of it (the cashback half was the store's own prize coming back);
    //  • the rest — only if an online payment was captured, or COD was delivered.
    // The gateway/cash side still nets off the FULL wallet payment: the customer
    // was only ever asked to pay `total - walletUsed` online, cashback included.
    const gatewayOrCash = method === 'cod' ? (delivered ? total - walletUsed : 0) : captured ? total - walletUsed : 0;
    const receivedPaise = Math.max(0, walletRealPaise + gatewayOrCash);
    const alreadyRefunded = Number(o.refundedPaise ?? 0);
    const refundable = Math.max(0, receivedPaise - alreadyRefunded);

    // Resolve the returned line item so the decision reflects back onto it — the
    // customer app/web read the ITEM's returnStatus, not the request. New orders
    // embed items on the order doc; older orders keep them in a subcollection
    // (read it here, before any write, per transaction rules).
    const embeddedItems = Array.isArray(o.items) ? (o.items as Array<Record<string, any>>) : null;
    let legacyItemRef: ReturnType<typeof db.doc> | null = null;
    let legacyItemExists = false;
    if (!embeddedItems && r.itemId) {
      legacyItemRef = db.doc(`orders/${r.orderId}/items/${r.itemId}`);
      legacyItemExists = (await tx.get(legacyItemRef)).exists;
    }

    // A returned unit was never really sold, so the product's soldCount has to
    // come back down — mirroring the cancellation path. Read it here (before any
    // write) so the decrement can be floored at zero rather than blindly
    // FieldValue.increment(-n)-ing a counter that may be stale or already 0.
    const returnedProductId = String(r.itemSnapshot?.productId ?? '');
    const returnedQty = Math.max(0, Number(r.itemSnapshot?.quantity ?? 0));
    const productRef = returnedProductId && returnedQty > 0 ? db.doc(`products/${returnedProductId}`) : null;
    const productSnap = productRef ? await tx.get(productRef) : null;

    // Payment record (written by placeOrder / verifyPayment, keyed by order id).
    // Read it now so the write phase can settle it without a read-after-write —
    // same treatment the cancellation path gives it (orders/cancel.ts).
    const paymentRef = db.doc(`payments/${r.orderId}`);
    const paymentSnap = await tx.get(paymentRef);

    const amount = Math.min(Math.max(0, requested), refundable);
    if (amount <= 0) {
      // Three different zeros, and telling them apart is the difference between
      // an admin retrying and an admin being able to explain. The cashback case
      // is new: such an order WAS paid, just not with refundable money, so the
      // old "already fully refunded" wording would be plainly wrong.
      const paidForReal = captured || (method === 'cod' && delivered);
      throw new HttpsError(
        'failed-precondition',
        !paidForReal
          ? 'This order was never paid (payment is still pending), so there is nothing to refund.'
          : receivedPaise <= 0 && walletUsed > 0
            ? 'This order was paid entirely from cashback, which is never refunded to the wallet.'
            : 'This order has already been fully refunded.',
      );
    }

    // Refunding the customer must also claw back the referrer's commission.
    // The order is necessarily 'delivered' by now, so that commission is already
    // confirmed and withdrawable — left alone, a referrer keeps real money on a
    // refunded order. Reads are taken here, before the first write below.
    //
    // The base is the MERCHANDISE VALUE RETURNED, not `amount` (what the
    // customer got back). prepareCommissionReversal measures its argument
    // against the commission's `eligiblePaise` — post-discount merchandise value
    // — so handing it the customer refund compares two different bases. They
    // diverge whenever cashback paid part of the order, because cashback is
    // never refunded: a ₹1000 order paid ₹400 cashback + ₹600 real refunds
    // ₹600, which against a ₹1000 base claws back only 60% of the commission.
    // The affiliate kept the rest on fully returned goods, and the row stayed
    // 'confirmed' and withdrawable for ever.
    //
    // Post-discount, so it lines up with `eligiblePaise`: the line's share of
    // the order discount is taken off proportionally. Falls back to the raw line
    // value when the merchandise subtotal can't be reconstructed (legacy orders)
    // — over-reversing a referrer is the safer direction than under-reversing.
    const returnedLineValuePaise = Math.max(
      0,
      Number(r.itemSnapshot?.priceAtPurchasePaise ?? 0) * returnedQty,
    );
    const merchSubtotalPaise = (Array.isArray(o.items) ? (o.items as Array<Record<string, any>>) : [])
      .reduce((s, it) => s + Number(it.offerPricePaise ?? 0) * Number(it.quantity ?? it.qty ?? 0), 0);
    const orderDiscountPaise = Math.max(0, Number(o.discountPaise ?? 0));
    const returnedMerchandisePaise =
      merchSubtotalPaise > 0
        ? Math.round(
            (returnedLineValuePaise * Math.max(0, merchSubtotalPaise - orderDiscountPaise)) /
              merchSubtotalPaise,
          )
        : returnedLineValuePaise;
    const applyCommissionReversal = await prepareCommissionReversal(
      tx,
      r.orderId as string,
      returnedMerchandisePaise > 0 ? returnedMerchandisePaise : amount,
    );

    const now = FieldValue.serverTimestamp();
    // "Auto-refund to wallet" OFF means the approval must not move money: the
    // refund is owed but will be paid out by hand to the original payment
    // method, so the destination is recorded as 'gateway' and refundedAt /
    // refundTransactionId stay null — that is what tells the admin (list
    // "Destination" column, drawer, CSV export) the payout is still outstanding.
    const toWallet = autoRefundToWallet && (r.refundMethod ?? 'wallet') === 'wallet';
    const refundMethod = autoRefundToWallet ? r.refundMethod ?? 'wallet' : 'gateway';
    let txId: string | null = null;

    if (toWallet && amount > 0) {
      const cref = db.doc(`customers/${r.customerId}`);
      const csnap = await tx.get(cref);
      if (!csnap.exists) throw new HttpsError('not-found', 'Customer not found.');
      const before = (csnap.get('wallet.balancePaise') as number) ?? 0;
      const after = before + amount;
      const wref = db.collection(`customers/${r.customerId}/walletTransactions`).doc();
      txId = wref.id;
      tx.set(wref, {
        id: wref.id, type: 'credit', source: 'refund', amountPaise: amount, balanceAfterPaise: after,
        orderId: r.orderId ?? null, orderShortId: r.orderShortId ?? null, couponId: null, refundRequestId: r.id ?? parsed.data.requestId,
        razorpayOrderId: null, razorpayPaymentId: null, adjustedByUid: actor, adjustmentReason: 'Return approved',
        title: `Refund · ${r.orderShortId ?? ''}`, description: r.reasonLabel ?? null, createdAt: now,
      });
      tx.update(cref, {
        'wallet.balancePaise': after,
        'wallet.breakdown.refundsPaise': FieldValue.increment(amount),
        'wallet.lifetimeCreditsPaise': FieldValue.increment(amount),
        'wallet.lastTransactionAt': now,
        updatedAt: now,
      });
    }

    tx.update(rref, {
      status: 'approved',
      refundAmountPaise: amount,
      refundMethod,
      refundTransactionId: txId,
      refundedAt: toWallet ? now : null,
      updatedAt: now,
      statusHistory: FieldValue.arrayUnion({
        status: 'approved',
        at: new Date(),
        byUid: actor,
        note: toWallet ? null : 'Approved — refund to be paid out manually (auto-refund to wallet is off).',
      }),
    });

    // Track the cumulative refund on the order so a later return can't push the
    // total past what was actually paid — and stamp the item 'approved' so the
    // customer app/web stop showing the return as still pending.
    // `refundedPaise` is incremented either way — the amount is committed the
    // moment the return is approved, so a second return on the same order can
    // never push the total past what was actually collected. `paymentStatus`
    // only flips to 'refunded' once the money has genuinely left; a manual
    // payout stays 'captured' until the admin settles it.
    tx.update(orderSnap.ref, {
      refundedPaise: FieldValue.increment(amount),
      // `toWallet`, not `autoRefundToWallet`: with the store setting ON but the
      // request's own refundMethod set to 'gateway', no money moves here (the
      // credit block above is skipped and refundedAt stays null) — yet the order
      // reported itself fully 'refunded' to the customer and to the admin, while
      // the payments row was left 'captured'. Flip it only when the credit
      // actually happened, exactly as the comment above promises.
      paymentStatus:
        toWallet && amount >= receivedPaise - alreadyRefunded
          ? 'refunded'
          : o.paymentStatus ?? 'pending',
      updatedAt: now,
      ...(embeddedItems
        ? { items: embeddedItems.map((x) => (x.id === r.itemId ? { ...x, returnStatus: 'approved' } : x)) }
        : {}),
    });
    if (legacyItemRef && legacyItemExists) {
      tx.update(legacyItemRef, { returnStatus: 'approved' });
    }

    // Settle the payment row the admin Payments module reads, exactly as the
    // cancellation path does — left alone it keeps reporting the order as fully
    // collected, so the month total and the GST export overstate net revenue by
    // every refund ever approved. `refundedPaise` accumulates across partial
    // returns and decides between 'partial_refund' and 'refunded'. Only when
    // money genuinely moved: a manual payout (auto-refund to wallet OFF) has not
    // reached the customer yet, so the payment is still a captured one. Only an
    // existing, still-collected document is touched — a legacy order must not
    // gain a payment record, and a failed one must not look refunded.
    if (toWallet && paymentSnap.exists && paymentSnap.get('status') !== 'failed' && paymentSnap.get('status') !== 'refunded') {
      const paidPaise = Number(paymentSnap.get('amountPaise') ?? 0);
      // Capped at what this row actually collected: on an order part-paid from
      // the wallet the refund can exceed the gateway/cash portion, and a
      // negative net would corrupt the admin's revenue figure.
      const refundedSoFar = Math.min(paidPaise, Number(paymentSnap.get('refundedPaise') ?? 0) + amount);
      tx.update(paymentRef, {
        // "Fully refunded" is an order-level fact (the wallet credit covers the
        // wallet portion too), so reuse the test applied to paymentStatus above.
        status: alreadyRefunded + amount >= receivedPaise ? 'refunded' : 'partial_refund',
        refundedPaise: refundedSoFar,
        updatedAt: now,
      });
    }
    // Roll back the sale on the product. Floored at zero so a counter that was
    // never incremented (legacy orders, seeded data) can't go negative and start
    // corrupting the "best sellers" ordering.
    if (productRef && productSnap?.exists) {
      const soldBefore = Number(productSnap.get('soldCount') ?? 0);
      const soldAfter = Math.max(0, soldBefore - returnedQty);
      if (soldAfter !== soldBefore) {
        tx.update(productRef, { soldCount: soldAfter, updatedAt: now });
      }
    }
    applyCommissionReversal();
    return {
      amount,
      creditedToWallet: toWallet,
      // Carried out for the notification below — reading the request again after
      // the commit would be a second round trip for values we already hold.
      customerId: String(r.customerId ?? ''),
      orderId: (r.orderId as string | null) ?? null,
      orderShortId: (r.orderShortId as string | null) ?? null,
    };
  });

  // Tell the customer the decision, and (separately) that the money has landed.
  // Two notifications on purpose: the return outcome belongs to the order
  // channel, the wallet credit to the wallet channel, and a customer who has
  // muted one still gets the other. Both are idempotent (keyed by the request /
  // the order) and both swallow their own failures — the refund has committed.
  await notifyReturnDecision({
    customerId: out.customerId,
    requestId: parsed.data.requestId,
    decision: 'approved',
    orderId: out.orderId,
    orderShortId: out.orderShortId,
    refundAmountPaise: out.amount,
    creditedToWallet: out.creditedToWallet,
  });
  if (out.creditedToWallet && out.amount > 0) {
    await notifyRefundCredited({
      customerId: out.customerId,
      eventId: `refund_return_${parsed.data.requestId}`,
      amountPaise: out.amount,
      orderId: out.orderId,
      orderShortId: out.orderShortId,
      cause: 'return',
    });
  }

  await writeAudit({
    actorUid: actor,
    action: 'return.approved',
    entity: 'orderRequests',
    entityId: parsed.data.requestId,
    amountPaise: out.amount,
    meta: { autoRefundToWallet, manualPayout: !out.creditedToWallet },
  });
  // Whether money actually moved is reported back: with auto-refund to wallet
  // OFF the approval only records a debt, and the admin screen must say so
  // instead of confirming a refund that has not happened.
  return { ok: true, amountPaise: out.amount, creditedToWallet: out.creditedToWallet };
});

export const adminRejectOrderRequest = onCall(callableOpts, async (req) => {
  const { uid: actor } = await requireModule(req, 'refunds', 'approve');
  const parsed = z.object({ requestId: z.string().min(1), reason: z.string().min(1) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'A rejection reason is required.');
  const rref = db.doc(`orderRequests/${parsed.data.requestId}`);

  // Set on the committing attempt, for the notification after the commit.
  let rejected: { customerId: string; orderId: string | null; orderShortId: string | null } | null = null;

  await db.runTransaction(async (tx) => {
    rejected = null;
    const snap = await tx.get(rref);
    if (!snap.exists) throw new HttpsError('not-found', 'Request not found.');
    if (!OPEN.includes(snap.get('status'))) throw new HttpsError('failed-precondition', `Already ${snap.get('status')}.`);
    const r = snap.data() as Record<string, any>;
    rejected = {
      customerId: String(r.customerId ?? ''),
      orderId: (r.orderId as string | null) ?? null,
      orderShortId: (r.orderShortId as string | null) ?? null,
    };

    // Reflect the rejection onto the order item so the customer app/web stop
    // showing the return as pending and the item becomes re-requestable. Reads
    // (order + legacy item) must precede writes.
    const orderRef = r.orderId ? db.doc(`orders/${r.orderId}`) : null;
    const orderSnap = orderRef ? await tx.get(orderRef) : null;
    let embeddedItems: Array<Record<string, any>> | null = null;
    let legacyItemRef: ReturnType<typeof db.doc> | null = null;
    let legacyItemExists = false;
    if (orderSnap?.exists) {
      const o = orderSnap.data() as Record<string, any>;
      embeddedItems = Array.isArray(o.items) ? (o.items as Array<Record<string, any>>) : null;
      if (!embeddedItems && r.itemId) {
        legacyItemRef = db.doc(`orders/${r.orderId}/items/${r.itemId}`);
        legacyItemExists = (await tx.get(legacyItemRef)).exists;
      }
    }

    const now = FieldValue.serverTimestamp();
    tx.update(rref, {
      status: 'rejected',
      rejectionReason: parsed.data.reason,
      updatedAt: now,
      statusHistory: FieldValue.arrayUnion({ status: 'rejected', at: new Date(), byUid: actor, note: parsed.data.reason }),
    });
    if (orderSnap?.exists && embeddedItems) {
      tx.update(orderSnap.ref, {
        items: embeddedItems.map((x) => (x.id === r.itemId ? { ...x, returnStatus: 'rejected' } : x)),
        updatedAt: now,
      });
    } else if (legacyItemRef && legacyItemExists) {
      tx.update(legacyItemRef, { returnStatus: 'rejected' });
    }
  });

  // The rejection reason is written BY an admin FOR the customer, so it is shown
  // verbatim — same string the returns screens already render.
  const out = rejected as { customerId: string; orderId: string | null; orderShortId: string | null } | null;
  if (out?.customerId) {
    await notifyReturnDecision({
      customerId: out.customerId,
      requestId: parsed.data.requestId,
      decision: 'rejected',
      orderId: out.orderId,
      orderShortId: out.orderShortId,
      reason: parsed.data.reason,
    });
  }

  await writeAudit({ actorUid: actor, action: 'return.rejected', entity: 'orderRequests', entityId: parsed.data.requestId, meta: { reason: parsed.data.reason } });
  return { ok: true };
});
