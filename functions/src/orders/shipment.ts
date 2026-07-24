/**
 * adminAssignRider — set an order's courier / AWB / rider.
 *
 * Shipment fields live on the CF-only-write `orders` collection, so the admin
 * cannot set them directly; without this callable the Order detail screen's
 * courier, tracking and rider inputs had nowhere to save to.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, FieldValue, callableOpts } from '../_lib/admin.js';
import { requireModule, writeAudit } from '../_lib/guards.js';

const Schema = z.object({
  orderId: z.string().min(1),
  courier: z.string().max(80).nullable().optional(),
  trackingId: z.string().max(80).nullable().optional(),
  riderName: z.string().max(80).nullable().optional(),
  riderPhone: z.string().max(20).nullable().optional(),
});

export const adminAssignRider = onCall(callableOpts, async (req) => {
  const { uid } = await requireModule(req, 'orders', 'edit');
  const parsed = Schema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid shipment payload.');
  const { orderId, courier, trackingId, riderName, riderPhone } = parsed.data;

  const ref = db.doc(`orders/${orderId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
  if (snap.get('status') === 'cancelled') {
    throw new HttpsError('failed-precondition', 'This order is cancelled.');
  }

  // Blank input clears the field rather than writing undefined, which Firestore
  // rejects outright.
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const name = clean(riderName);
  const phone = clean(riderPhone);
  // `rider` is a Rider object on the order, not a bare string — preserve the
  // existing distance so assigning a courier doesn't reset live tracking.
  // Kept when EITHER field is present: gating on the name alone silently threw
  // away a phone-only entry (Rider.name is nullable, and both clients already
  // render a rider without one), and clearing a name to fix a typo wiped the
  // stored number while the callable still reported success.
  const rider =
    name || phone
      ? {
          name,
          phone,
          currentDistanceKm: Number(
            (snap.get('rider') as { currentDistanceKm?: number } | null)?.currentDistanceKm ?? 0,
          ),
        }
      : null;

  await ref.update({
    courier: clean(courier),
    trackingId: clean(trackingId),
    rider,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAudit({
    actorUid: uid,
    action: 'order.shipment_updated',
    entity: 'orders',
    entityId: orderId,
    // Log what was actually stored — the name alone hid phone-only assignments.
    meta: { courier: clean(courier), trackingId: clean(trackingId), rider: rider && { name, phone } },
  });
  return { ok: true };
});
