/**
 * requestReturnOrReplacement — a customer requests a return for a delivered
 * order item. Creates an orderRequests doc (type 'return', status 'pending')
 * for the admin's existing adminApproveOrderRequest / adminRejectOrderRequest
 * flow (approval refunds to the wallet), and stamps the order item.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, FieldValue, callableOpts } from '../_lib/admin.js';
import { requireActiveCustomer, requireCustomer } from '../_lib/guards.js';

const RETURN_REASONS: Record<string, string> = {
  damaged: 'Item damaged / defective',
  wrong_item: 'Wrong item delivered',
  missing_item: 'Missing item / parts',
  not_as_described: "Doesn't match description",
  other: 'Other',
};

export const requestReturnOrReplacement = onCall(callableOpts, async (req) => {
  const { uid } = await requireActiveCustomer(req);
  const parsed = z.object({
    orderId: z.string().min(1),
    itemId: z.string().min(1),
    reasonKey: z.string().min(1),
    note: z.string().max(500).nullable().optional(),
  }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid return request.');
  const { orderId, itemId, reasonKey, note } = parsed.data;
  const reasonLabel = RETURN_REASONS[reasonKey];
  if (!reasonLabel) throw new HttpsError('invalid-argument', 'Choose a valid reason.');

  // Read outside the transaction: settings are not part of the atomic unit and
  // this keeps the txn to order/item reads only.
  const returnsSettings = await db.doc('settings/returns').get();
  const windowDays = Number(returnsSettings.get('windowDays') ?? 7);

  const result = await db.runTransaction(async (tx) => {
    const orderRef = db.doc(`orders/${orderId}`);
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) throw new HttpsError('not-found', 'Order not found.');
    const o = orderSnap.data() as Record<string, unknown>;
    if (o.customerId !== uid) throw new HttpsError('permission-denied', 'Not your order.');
    if (o.status !== 'delivered') throw new HttpsError('failed-precondition', 'Only delivered orders can be returned.');

    // The window is admin-configurable (Settings ▸ Storefront → settings/returns
    // .windowDays, default 7) and both storefronts gate on it. This used to
    // hardcode 3 days, so a request the customer was told was in-window got
    // rejected by the server. Measured from delivery, falling back to the placed
    // date for older orders with no `deliveredAt` — matching the clients.
    const fromMs =
      (o.deliveredAt as { toMillis?: () => number } | undefined)?.toMillis?.() ??
      (o.placedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ??
      (o.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.();
    if (!fromMs) {
      throw new HttpsError('failed-precondition', 'This order has no delivery date, so it cannot be returned.');
    }
    if (windowDays <= 0) {
      throw new HttpsError('failed-precondition', 'Returns are currently disabled.');
    }
    if (Date.now() - fromMs > windowDays * 24 * 60 * 60 * 1000) {
      throw new HttpsError(
        'failed-precondition',
        `The ${windowDays}-day return window for this order has closed.`,
      );
    }

    // Locate the line item. New orders embed items on the order document; older
    // orders still keep them in the `orders/{id}/items` subcollection.
    const embeddedItems = Array.isArray(o.items) ? (o.items as Array<Record<string, any>>) : [];
    const embeddedIdx = embeddedItems.findIndex((x) => x.id === itemId);
    let it: Record<string, any>;
    let legacyItemRef: ReturnType<typeof db.doc> | null = null;
    if (embeddedIdx >= 0) {
      it = embeddedItems[embeddedIdx]!;
    } else {
      legacyItemRef = db.doc(`orders/${orderId}/items/${itemId}`);
      const itemSnap = await tx.get(legacyItemRef);
      if (!itemSnap.exists) throw new HttpsError('not-found', 'Order item not found.');
      it = itemSnap.data() as Record<string, any>;
    }
    // A rejected item is eligible again (mirrors the web hasReturnableItem);
    // any other non-'none' state means a return is already in flight.
    if (it.returnStatus && it.returnStatus !== 'none' && it.returnStatus !== 'rejected') {
      throw new HttpsError('failed-precondition', 'A return is already in progress for this item.');
    }

    // Refund only what the customer ACTUALLY paid for this item — never the
    // value of a coupon/discount (and cashback is a credit, never part of the
    // price, so it's excluded by construction). The order-level discount is
    // spread across items in proportion to their line total, so a returned item
    // gives back its line total minus its share of that discount. Delivery/tax
    // are order-level and not refunded on a partial item return. The final
    // approval (adminApproveOrderRequest) additionally caps the total refunded
    // at the real money received (wallet + captured gateway / collected COD).
    const lineTotal = Number(it.lineTotalPaise ?? Number(it.offerPricePaise ?? 0) * Number(it.quantity ?? 1));
    const orderSubtotal = Number(o.subtotalPaise ?? 0);
    const orderDiscount = Number(o.discountPaise ?? 0); // coupon + spin coupon (already combined here)
    const discountShare = orderSubtotal > 0
      ? Math.round((orderDiscount * lineTotal) / orderSubtotal)
      : 0;
    const refundAmountPaise = Math.max(0, lineTotal - discountShare);

    // shortId.
    const counterRef = db.doc('counters/orderRequests');
    const seq = Number((await tx.get(counterRef)).get('seq') ?? 0) + 1;
    const shortId = `#RP-${String(seq).padStart(6, '0')}`;

    const reqRef = db.collection('orderRequests').doc();
    const now = FieldValue.serverTimestamp();
    tx.set(reqRef, {
      id: reqRef.id,
      shortId,
      type: 'return',
      customerId: uid,
      orderId,
      orderShortId: (o.shortId as string) ?? '',
      itemId,
      itemSnapshot: {
        productId: (it.productId as string) ?? '',
        productName: (it.productName as string) ?? 'Item',
        variantLabel: (it.variantLabel as string) ?? null,
        quantity: Number(it.quantity ?? 1),
        priceAtPurchasePaise: Number(it.offerPricePaise ?? 0),
      },
      reasonKey,
      reasonLabel,
      note: note ?? null,
      photoUrls: [],
      status: 'pending',
      statusHistory: [{ status: 'pending', at: new Date(), byUid: uid, note: 'Requested by customer' }],
      rejectionReason: null,
      refundMethod: 'wallet',
      refundAmountPaise,
      refundTransactionId: null,
      refundedAt: null,
      nonce: reqRef.id,
      searchIndex: [shortId.toLowerCase(), (o.shortId as string ?? '').toLowerCase()].filter(Boolean),
      createdAt: now,
      updatedAt: now,
    });

    // Stamp the item's return state — on the embedded array (read-modify-write
    // the whole array) or the legacy subcollection doc.
    if (embeddedIdx >= 0) {
      const nextItems = embeddedItems.map((x, i) =>
        i === embeddedIdx ? { ...x, returnStatus: 'requested', returnRequestId: reqRef.id } : x,
      );
      tx.update(orderRef, { items: nextItems, updatedAt: now });
    } else if (legacyItemRef) {
      tx.update(legacyItemRef, { returnStatus: 'requested', returnRequestId: reqRef.id });
    }
    tx.set(counterRef, { seq }, { merge: true });
    return { requestId: reqRef.id, shortId };
  });

  return result;
});
