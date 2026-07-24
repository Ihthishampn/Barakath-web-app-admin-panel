/**
 * adminGrantSpins — allocate Spin & Win spins to a customer (privileged).
 *
 * Adds `spins` to customers/{uid}.spinsRemaining (atomic increment). Positive
 * grants add spins; the balance never goes below 0. Used from the admin customer
 * profile. Spins are consumed by executeSpin and never reset daily.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, FieldValue, callableOpts } from '../_lib/admin.js';
import { requireModule, writeAudit } from '../_lib/guards.js';

const Schema = z.object({
  uid: z.string().min(1),
  spins: z.number().int().refine((n) => n !== 0, 'Spins must be non-zero.'),
});

export const adminGrantSpins = onCall(callableOpts, async (req) => {
  const { uid: actor } = await requireModule(req, 'customers', 'edit');
  const parsed = Schema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');
  const { uid, spins } = parsed.data;

  const ref = db.doc(`customers/${uid}`);
  const newBalance = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Customer not found.');
    const current = Number(snap.get('spinsRemaining') ?? 0);
    // Clamp at 0 so a negative adjustment can't drive the balance below zero.
    const next = Math.max(0, current + spins);
    tx.update(ref, { spinsRemaining: next, updatedAt: FieldValue.serverTimestamp() });
    return next;
  });

  await writeAudit({
    actorUid: actor,
    action: spins > 0 ? 'customer.spins_granted' : 'customer.spins_revoked',
    entity: 'customers',
    entityId: uid,
    meta: { spins, newBalance },
  });
  return { ok: true, spinsRemaining: newBalance };
});
