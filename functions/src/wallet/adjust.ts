/**
 * adminAdjustWallet — manually credit or debit a customer's normal wallet
 * (privileged; admin-spec §6.5 Add / Deduct).
 *
 * Atomically updates customers/{uid}.wallet and appends an immutable
 * walletTransactions ledger row (source = 'admin_adjust'), so every manual
 * adjustment is traceable to the acting admin and a reason. A debit can never
 * drive the balance below zero.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, FieldValue, callableOpts } from '../_lib/admin.js';
import { requireModule, writeAudit } from '../_lib/guards.js';
import { notifyWalletMovement } from '../notifications/events.js';
import { rupees } from '../notifications/notify.js';

const Schema = z.object({
  uid: z.string().min(1),
  direction: z.enum(['credit', 'debit']),
  amountPaise: z.number().int().positive('Enter an amount greater than zero.'),
  reason: z.string().trim().max(200).optional(),
});

export const adminAdjustWallet = onCall(callableOpts, async (req) => {
  const { uid: actor } = await requireModule(req, 'customers', 'edit');
  const parsed = Schema.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid payload.');
  }
  const { uid, direction, amountPaise, reason } = parsed.data;
  const signed = direction === 'credit' ? amountPaise : -amountPaise;

  const custRef = db.doc(`customers/${uid}`);
  // The ledger row id, carried out of the transaction so the notification can be
  // keyed by the movement it describes (reset per attempt — a retried
  // transaction must not announce an id that never committed).
  let ledgerId = '';
  const balanceAfter = await db.runTransaction(async (tx) => {
    ledgerId = '';
    const snap = await tx.get(custRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Customer not found.');
    const wallet = (snap.get('wallet') as Record<string, unknown>) ?? {};
    const current = Number(wallet.balancePaise ?? 0);
    const next = current + signed;
    if (next < 0) {
      throw new HttpsError('failed-precondition', 'Deduction exceeds the wallet balance.');
    }

    // An admin debit can take the balance below the non-refundable cashback
    // pool, which must never exceed it (see Wallet.cashbackBalancePaise). Clamp
    // it down on a debit — an admin removing money removes the promo slice
    // first, which is the conservative direction: it can only ever make MORE of
    // the remaining balance refundable, never less.
    const pool = Number(wallet.cashbackBalancePaise ?? 0);
    const clampedPool = Math.max(0, Math.min(pool, next));

    tx.update(custRef, {
      'wallet.balancePaise': FieldValue.increment(signed),
      ...(clampedPool !== pool ? { 'wallet.cashbackBalancePaise': clampedPool } : {}),
      ...(direction === 'credit'
        ? { 'wallet.lifetimeCreditsPaise': FieldValue.increment(amountPaise) }
        : { 'wallet.lifetimeDebitsPaise': FieldValue.increment(amountPaise) }),
      'wallet.lastTransactionAt': FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const txRef = db.collection(`customers/${uid}/walletTransactions`).doc();
    tx.set(txRef, {
      id: txRef.id,
      type: direction,
      source: 'admin_adjust',
      amountPaise,
      balanceAfterPaise: next,
      orderId: null,
      orderShortId: null,
      couponId: null,
      refundRequestId: null,
      razorpayOrderId: null,
      razorpayPaymentId: null,
      adjustedByUid: actor,
      adjustmentReason: reason ?? null,
      title: direction === 'credit' ? 'Wallet credit (admin)' : 'Wallet deduction (admin)',
      description: reason ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
    ledgerId = txRef.id;
    return next;
  });

  // Money moved in the customer's wallet without them being told — the wallet
  // channel of their notification preferences existed and nothing ever wrote to
  // it. Best-effort and after the commit: the adjustment stands either way.
  await notifyWalletMovement({
    customerId: uid,
    eventId: ledgerId || `admin_adjust_${Date.now()}`,
    direction,
    amountPaise,
    title: direction === 'credit' ? 'Wallet credited' : 'Wallet debited',
    body:
      direction === 'credit'
        ? `${rupees(amountPaise)} has been added to your wallet.${reason ? ` ${reason}` : ''}`
        : `${rupees(amountPaise)} has been deducted from your wallet.${reason ? ` ${reason}` : ''}`,
  });

  await writeAudit({
    actorUid: actor,
    action: direction === 'credit' ? 'wallet.credited' : 'wallet.debited',
    entity: 'customers',
    entityId: uid,
    meta: { amountPaise, direction, reason: reason ?? null, balanceAfterPaise: balanceAfter },
  });
  return { ok: true, balancePaise: balanceAfter };
});
