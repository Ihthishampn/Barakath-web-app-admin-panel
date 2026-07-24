/**
 * Wallet top-up (money-in) — Razorpay-funded credit to the customer wallet.
 *
 *   topUpWallet  — validate amount, open a Razorpay order, park a pending marker.
 *   verifyTopUp  — verify the gateway signature, then credit the wallet + write
 *                  an immutable walletTransactions ledger row (atomic).
 *
 * The wallet / walletTransactions / pendingPayments writes are Admin-SDK only.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db, FieldValue, callableOpts } from '../_lib/admin.js';
import { requireActiveCustomer, requireCustomer } from '../_lib/guards.js';
import { notifyWalletMovement } from '../notifications/events.js';
import { rupees } from '../notifications/notify.js';

const RZP_KEY_ID = defineSecret('RAZORPAY_KEY_ID');
const RZP_KEY_SECRET = defineSecret('RAZORPAY_KEY_SECRET');

const MIN_TOPUP = 100_00; // ₹100
const MAX_TOPUP = 100_000_00; // ₹1,00,000

export const topUpWallet = onCall(
  { ...callableOpts, secrets: [RZP_KEY_ID, RZP_KEY_SECRET] },
  async (req) => {
    const { uid } = await requireActiveCustomer(req);
    const parsed = z.object({ amountPaise: z.number().int().positive() }).safeParse(req.data);
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Enter a valid amount.');
    const amount = parsed.data.amountPaise;
    if (amount < MIN_TOPUP) throw new HttpsError('failed-precondition', 'Minimum top-up is ₹100.');
    if (amount > MAX_TOPUP) throw new HttpsError('failed-precondition', 'Maximum top-up is ₹1,00,000.');

    const authHeader = Buffer.from(`${RZP_KEY_ID.value()}:${RZP_KEY_SECRET.value()}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${authHeader}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency: 'INR', receipt: `topup_${uid.slice(0, 8)}`, notes: { type: 'wallet_topup', uid } }),
    });
    if (!res.ok) throw new HttpsError('internal', 'Could not start the top-up. Please try again.');
    const rzp = (await res.json()) as { id: string };

    // Park a server-trusted marker so verifyTopUp credits exactly this amount.
    await db.doc(`pendingPayments/${rzp.id}`).set({
      id: rzp.id, uid, amountPaise: amount, type: 'wallet_topup', status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
    return { razorpayOrderId: rzp.id, keyId: RZP_KEY_ID.value(), amountPaise: amount };
  },
);

/**
 * Best-effort status check for a top-up whose Razorpay result never reached
 * the client (the checkout activity was killed while the app was
 * backgrounded). `pendingPayments` denies all client reads, so this is the
 * only way the app can ask "did this actually go through?" instead of leaving
 * the customer stuck on a spinner forever.
 */
export const getTopUpStatus = onCall(callableOpts, async (req) => {
  const { uid } = requireCustomer(req);
  const parsed = z.object({ razorpayOrderId: z.string().min(1) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const snap = await db.doc(`pendingPayments/${parsed.data.razorpayOrderId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Top-up not found.');
  const p = snap.data() as Record<string, unknown>;
  if (p.uid !== uid) throw new HttpsError('permission-denied', 'Not your top-up.');
  return { status: String(p.status ?? 'pending') };
});

export const verifyTopUp = onCall(
  { ...callableOpts, secrets: [RZP_KEY_SECRET] },
  async (req) => {
    const { uid } = requireCustomer(req);
    const parsed = z.object({
      razorpayOrderId: z.string().min(1),
      razorpayPaymentId: z.string().min(1),
      razorpaySignature: z.string().min(1),
    }).safeParse(req.data);
    if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payment payload.');
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = parsed.data;

    const expected = createHmac('sha256', RZP_KEY_SECRET.value())
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');
    // Constant-time compare so a signature can't be probed byte by byte.
    const sigBuf = Buffer.from(razorpaySignature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return { credited: false };
    }

    const pendRef = db.doc(`pendingPayments/${razorpayOrderId}`);
    const amount = await db.runTransaction(async (tx) => {
      const pend = await tx.get(pendRef);
      if (!pend.exists) throw new HttpsError('not-found', 'Top-up not found.');
      const p = pend.data() as Record<string, unknown>;
      if (p.uid !== uid) throw new HttpsError('permission-denied', 'Not your top-up.');
      if (p.status !== 'pending') return 0; // idempotent — already credited
      const amt = Number(p.amountPaise ?? 0);

      const custRef = db.doc(`customers/${uid}`);
      const cust = await tx.get(custRef);
      if (!cust.exists) throw new HttpsError('failed-precondition', 'Customer not found.');
      const wallet = (cust.get('wallet') as Record<string, unknown>) ?? {};
      const balanceAfter = Number(wallet.balancePaise ?? 0) + amt;

      // Deliberately does NOT touch `wallet.cashbackBalancePaise`: a top-up is
      // the customer's own money, so it is fully refundable and must stay
      // outside the cashback pool. Growing the balance without growing the pool
      // also keeps the pool ≤ balance invariant safe by construction.
      tx.update(custRef, {
        'wallet.balancePaise': FieldValue.increment(amt),
        'wallet.breakdown.topupPaise': FieldValue.increment(amt),
        'wallet.lifetimeCreditsPaise': FieldValue.increment(amt),
        'wallet.lastTransactionAt': FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const txRef = db.collection(`customers/${uid}/walletTransactions`).doc();
      tx.set(txRef, {
        id: txRef.id, type: 'credit', source: 'topup', amountPaise: amt, balanceAfterPaise: balanceAfter,
        description: 'Wallet top-up', refType: 'topup', refId: razorpayPaymentId,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.update(pendRef, { status: 'captured', razorpayPaymentId, updatedAt: FieldValue.serverTimestamp() });
      return amt;
    });

    // Only on the attempt that actually credited (the transaction returns 0 on a
    // replay), and keyed by the gateway order so a re-verified top-up cannot
    // announce itself twice. Best-effort: the money is already in the wallet.
    if (amount > 0) {
      await notifyWalletMovement({
        customerId: uid,
        eventId: `topup_${razorpayOrderId}`,
        direction: 'credit',
        amountPaise: amount,
        title: 'Wallet topped up',
        body: `${rupees(amount)} has been added to your wallet.`,
      });
    }

    return { credited: amount > 0, amountPaise: amount };
  },
);
