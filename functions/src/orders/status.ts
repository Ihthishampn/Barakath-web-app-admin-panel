/**
 * adminChangeOrderStatus — order state-machine transition (critical: touches the
 * immutable timeline; cancel is admin-audited). Runs in a transaction, enforces
 * the valid transition graph + orders.edit permission, writes a timeline entry
 * and an audit log. The orders collection is CF-only-write in firestore.rules.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { DocumentReference } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db, FieldValue, Timestamp, callableOpts } from '../_lib/admin.js';
import { requireModule, writeAudit } from '../_lib/guards.js';
import { performCancellation } from './cancel.js';
import { confirmCommissionsForOrder } from '../affiliate/commissions.js';
import { notifyCommission, notifyOrderStatus } from '../notifications/events.js';

// The admin transition graph. The functions bundle deliberately does NOT depend
// on @barkath/shared (see _lib/search.ts), so this mirrors ORDER_STATUS_TRANSITIONS
// in packages/shared/src/enums.ts by hand — keep the two in sync.
//
// 'shipped' and 'out_for_delivery' now include 'cancelled': an ADMIN must be able
// to cancel a parcel already with the courier (lost/damaged in transit) so it can
// be refunded and restocked. Previously this local copy stopped at 'packed', so
// the admin UI (which reads the shared enum) offered a Cancel the callable then
// rejected with "Cannot move shipped → cancelled". Customers are still bounded
// separately (CANCELLABLE_STATUSES) and can't self-cancel past 'packed'.
const TRANSITIONS: Record<string, string[]> = {
  accepted: ['packing', 'cancelled'],
  packing: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

const Schema = z.object({
  orderId: z.string().min(1),
  status: z.string().min(1),
  note: z.string().nullable().optional(),
});

/**
 * Clears the referrer's commission into their withdrawable balance on delivery.
 *
 * This cannot join the status transaction: `confirmCommissionsForOrder` runs a
 * query plus its own transaction, so it can abort on contention while the order
 * is already 'delivered'. It is idempotent (only rows still 'pending' move), and
 * the caller accepts `delivered → delivered` as a no-op re-entry, so a failure
 * here is recoverable by simply marking the order delivered again.
 *
 * Only orders that actually carry a commission are touched — placeOrder leaves
 * `affiliateCommissionStatus` null when there is no referrer or no accrual.
 */
async function settleDeliveryCommissions(
  ref: DocumentReference,
  orderId: string,
  affiliateCommissionStatus: unknown,
  orderShortId: string | null,
): Promise<void> {
  if (affiliateCommissionStatus !== 'pending') return;
  const confirmed = await confirmCommissionsForOrder(orderId);
  await ref.update({ affiliateCommissionStatus: 'confirmed' }).catch(() => undefined);
  // Tell the referrer their commission is withdrawable now. Only what actually
  // moved is announced (confirmCommissionsForOrder returns nothing on a repeat),
  // and notifyCommission is itself idempotent per order+phase.
  for (const c of confirmed) {
    await notifyCommission({
      affiliateUid: c.affiliateUid,
      orderId,
      orderShortId,
      amountPaise: c.amountPaise,
      phase: 'confirmed',
    });
  }
}

/**
 * Record what this customer has actually received, one doc per product.
 *
 * This is the review-eligibility index. Reviews used to be creatable by ANY
 * signed-in customer for ANY product — nothing checked that they had bought it.
 * Security rules cannot express "has a delivered order containing this product"
 * (that needs a query across another collection), but they CAN check a single
 * document exists — so delivery writes one, and the rule reads it.
 *
 * Deliberately NOT a Cloud Function on the write side: keeping this an index
 * means submitting a review stays a direct, rules-gated client write.
 *
 * Idempotent (doc id is the product id) and best-effort: a failure here must
 * never fail the delivery itself — the worst case is a customer who cannot
 * review yet, recoverable by re-marking the order delivered.
 */
async function recordPurchases(
  customerId: string,
  orderId: string,
  items: unknown,
): Promise<void> {
  let list = Array.isArray(items) ? items : [];
  // Older orders keep their lines in an `items` SUBCOLLECTION rather than the
  // embedded array. Missing that fallback would silently deny those customers
  // the right to review anything they had bought.
  if (!list.length) {
    const sub = await db.collection(`orders/${orderId}/items`).get();
    list = sub.docs.map((d) => d.data());
  }
  const productIds = [
    ...new Set(
      list
        .map((it) => String((it as Record<string, unknown>)?.productId ?? ''))
        .filter((id) => id.length > 0),
    ),
  ];
  if (!productIds.length) return;

  const batch = db.batch();
  const now = Timestamp.now();
  for (const productId of productIds) {
    batch.set(
      db.doc(`customers/${customerId}/purchases/${productId}`),
      { productId, lastOrderId: orderId, deliveredAt: now },
      { merge: true },
    );
  }
  await batch.commit();
}

export const adminChangeOrderStatus = onCall(callableOpts, async (req) => {
  const { uid } = await requireModule(req, 'orders', 'edit');
  const parsed = Schema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');
  const { orderId, status, note } = parsed.data;

  const ref = db.doc(`orders/${orderId}`);

  // Cancellation is not a plain status stamp — it must restore stock, refund the
  // customer and reverse any pending commission. Validate the transition here,
  // then delegate to the one shared implementation.
  if (status === 'cancelled') {
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
    const from = (snap.data() as { status: string }).status;
    if (!(TRANSITIONS[from] ?? []).includes('cancelled')) {
      throw new HttpsError('failed-precondition', `Cannot move ${from} → cancelled.`);
    }
    await performCancellation({
      orderId,
      actorUid: uid,
      reason: note ?? 'Cancelled by admin',
    });
    await writeAudit({
      actorUid: uid,
      action: 'order.status_changed',
      entity: 'orders',
      entityId: orderId,
      meta: { from, to: status },
    });
    return { ok: true, status };
  }

  // `delivered → delivered` is a no-op re-entry, not a transition: the commission
  // clearance below runs after (and outside) the status transaction, so if it
  // fails the order is already delivered and the admin's retry would otherwise
  // hit "Cannot move delivered → delivered" with the commission stranded as
  // 'pending' forever. Re-entry re-runs only the clearance — no second timeline
  // entry, no second audit row.
  if (status === 'delivered') {
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
    const o = snap.data() as Record<string, unknown>;
    if (o.status === 'delivered') {
      await settleDeliveryCommissions(
        ref,
        orderId,
        o.affiliateCommissionStatus,
        (o.shortId as string | null) ?? null,
      );
      // Re-entry also repairs a purchases index that failed to write first time.
      await recordPurchases(String(o.customerId ?? ''), orderId, o.items).catch((e) =>
        console.error('recordPurchases (re-entry) failed', e),
      );
      // …and a notification that never made it out. Keyed by order + status, so
      // a customer who was already told is not told again.
      await notifyOrderStatus({
        customerId: String(o.customerId ?? ''),
        orderId,
        orderShortId: (o.shortId as string | null) ?? null,
        status: 'delivered',
      });
      return { ok: true, status };
    }
  }

  const prev = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
    const o = snap.data() as {
      status: string;
      shortId?: string | null;
      customerId?: string;
      affiliateCommissionStatus?: string | null;
      paymentMethod?: string;
      paymentStatus?: string;
      totalPaise?: number;
      items?: unknown;
    };
    const allowed = TRANSITIONS[o.status] ?? [];
    if (!allowed.includes(status)) {
      throw new HttpsError('failed-precondition', `Cannot move ${o.status} → ${status}.`);
    }
    // Read before any write (Firestore forbids a read after a write in a txn).
    const customerId = String(o.customerId ?? '');
    const custRef = status === 'delivered' && customerId ? db.doc(`customers/${customerId}`) : null;
    const custSnap = custRef ? await tx.get(custRef) : null;
    // LEGACY-ORDER PATH, deliberately retained. COD can no longer be CHOSEN
    // (placeOrder rejects it), but the COD orders placed before it was withdrawn
    // are still moving through fulfilment: cash is collected by the rider at the
    // door and nothing else ever settles it, so without this a delivered COD
    // order stays paymentStatus 'pending' on both the order and the admin
    // Payments page, and reports under-count revenue. Removing it would also
    // break the refund path, which reads a delivered COD order as genuinely paid
    // (returns/decisions.ts). Read the payment row up front (no read-after-write
    // in a txn).
    const codCapture =
      status === 'delivered' && o.paymentMethod === 'cod' && o.paymentStatus === 'pending';
    const payRef = codCapture ? db.doc(`payments/${orderId}`) : null;
    const paySnap = payRef ? await tx.get(payRef) : null;
    const now = FieldValue.serverTimestamp();
    const upd: Record<string, unknown> = { status, updatedAt: now };
    if (status === 'shipped') upd.shippedAt = now;
    if (status === 'out_for_delivery') upd.outForDeliveryAt = now;
    if (status === 'delivered') upd.deliveredAt = now;
    if (status === 'cancelled') {
      upd.cancelledAt = now;
      upd.cancellationReason = note ?? 'Cancelled by admin';
      upd.cancelledByUid = uid;
    }
    if (codCapture) {
      upd.paymentStatus = 'captured';
      // The full total, matching verifyPayment: any wallet share was already
      // counted into amountPaidPaise at placement and the rider collects the rest.
      upd.amountPaidPaise = Number(o.totalPaise ?? 0);
    }
    tx.update(ref, upd);

    // Only settle an existing payment row — a legacy order without one should
    // not gain a record here (same rule performCancellation follows).
    if (payRef && paySnap?.exists) {
      tx.update(payRef, { status: 'captured', capturedAt: now, updatedAt: now });
    }

    // Customer lifetime stats (read by the admin Customers list); nothing else
    // maintains them. Only written when the doc exists so a delivery can never
    // fail on a customer record that has since been removed.
    if (status === 'delivered' && custRef && custSnap?.exists) {
      tx.update(custRef, {
        'stats.ordersDelivered': FieldValue.increment(1),
        updatedAt: now,
      });
    }

    const tref = db.collection(`orders/${orderId}/timeline`).doc();
    tx.set(tref, {
      id: tref.id,
      status,
      at: now,
      byUid: uid,
      byName: 'admin',
      note: note ?? null,
      meta: {},
      createdAt: now,
    });
    return {
      from: o.status,
      commissionStatus: o.affiliateCommissionStatus ?? null,
      // Carried out of the transaction so the purchases index (review
      // eligibility) can be written after the status has actually committed.
      customerId,
      items: o.items,
      shortId: o.shortId ?? null,
    };
  });

  // The transition is committed — record it before the commission clearance, so
  // a failure there can no longer swallow the audit entry for the delivery.
  await writeAudit({
    actorUid: uid,
    action: 'order.status_changed',
    entity: 'orders',
    entityId: orderId,
    meta: { from: prev.from, to: status },
  });

  // Delivery clears the referrer's commission into their withdrawable balance,
  // and records what the customer received so they may review those products.
  if (status === 'delivered') {
    await settleDeliveryCommissions(ref, orderId, prev.commissionStatus, prev.shortId);
    await recordPurchases(prev.customerId, orderId, prev.items).catch((e) =>
      console.error('recordPurchases failed', e),
    );
  }

  // Tell the customer. AFTER the commit and deliberately outside every
  // transaction: notifyOrderStatus swallows its own failures, so a push that
  // cannot be delivered can never roll back — or fail — a status change that has
  // already happened. Idempotent per order+status.
  await notifyOrderStatus({
    customerId: prev.customerId,
    orderId,
    orderShortId: prev.shortId,
    status,
    note: note ?? null,
  });

  return { ok: true, status };
});
