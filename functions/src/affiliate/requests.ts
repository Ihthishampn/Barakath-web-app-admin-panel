/**
 * requestWithdrawal — a customer requests an affiliate payout.
 *
 * Creates a withdrawalRequests doc (status 'pending') for the admin's existing
 * approveWithdrawal / rejectWithdrawal flow, validates the confirmed balance,
 * computes the processing fee from settings/affiliate, and sets
 * affiliate.hasPendingWithdrawal so a second request is blocked until resolved.
 * (The confirmed balance is only deducted on admin approval.)
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, FieldValue, callableOpts } from '../_lib/admin.js';
import { requireActiveCustomer, requireCustomer } from '../_lib/guards.js';

export const requestWithdrawal = onCall(callableOpts, async (req) => {
  const { uid } = await requireActiveCustomer(req);
  const parsed = z.object({
    amountPaise: z.number().int().positive(),
    bankAccountId: z.string().min(1),
  }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid withdrawal request.');
  const { amountPaise, bankAccountId } = parsed.data;

  const affSettings = (await db.doc('settings/affiliate').get()).data() as Record<string, unknown> | undefined;
  const minWithdrawal = Number(affSettings?.minWithdrawalPaise ?? 0);
  const feeType = (affSettings?.processingFeeType as string) ?? 'fixed';
  const feeValue = Number(affSettings?.processingFeeValue ?? 0);
  const feeMin = Number(affSettings?.processingFeeMinPaise ?? 0);

  const result = await db.runTransaction(async (tx) => {
    const custRef = db.doc(`customers/${uid}`);
    const cust = await tx.get(custRef);
    if (!cust.exists) throw new HttpsError('failed-precondition', 'Customer not found.');
    const c = cust.data() as Record<string, unknown>;
    const aff = c.affiliate as Record<string, unknown> | null;
    if (!aff?.enabled) throw new HttpsError('failed-precondition', 'Affiliate programme not active on your account.');
    // The admin's "Wallet access" toggle wrote this field and nothing read it,
    // so switching it off changed nothing. Checked here rather than at payout:
    // letting the request through and only failing on approval would strand the
    // affiliate's balance in a request the admin cannot settle.
    if (aff.walletEnabled === false) {
      throw new HttpsError('failed-precondition', 'Wallet access is disabled on your account.');
    }
    if (aff.hasPendingWithdrawal) throw new HttpsError('failed-precondition', 'You already have a withdrawal in progress.');

    const confirmed = Number(aff.confirmedBalancePaise ?? 0);
    if (amountPaise > confirmed) throw new HttpsError('failed-precondition', 'Amount exceeds your withdrawable balance.');
    if (amountPaise < minWithdrawal) {
      throw new HttpsError('failed-precondition', `Minimum withdrawal is ₹${Math.round(minWithdrawal / 100)}.`);
    }

    const banks = (c.bankAccounts as Array<Record<string, unknown>>) ?? [];
    const bank = banks.find((b) => b.id === bankAccountId);
    if (!bank) throw new HttpsError('failed-precondition', 'Choose a valid bank account.');

    let processingFeePaise = feeType === 'percent' ? Math.round((amountPaise * feeValue) / 100) : feeValue;
    processingFeePaise = Math.max(processingFeePaise, feeMin);
    const netPayoutPaise = Math.max(0, amountPaise - processingFeePaise);

    // shortId.
    const counterRef = db.doc('counters/withdrawals');
    const seq = Number((await tx.get(counterRef)).get('seq') ?? 0) + 1;
    const shortId = `#WD-${String(seq).padStart(6, '0')}`;

    const wref = db.collection('withdrawalRequests').doc();
    const now = FieldValue.serverTimestamp();
    tx.set(wref, {
      id: wref.id,
      shortId,
      customerId: uid,
      customerName: (c.name as string) || 'Affiliate',
      customerPhone: (c.phone as string) || '',
      requestedAmountPaise: amountPaise,
      processingFeePaise,
      netPayoutPaise,
      bankAccount: {
        id: (bank.id as string),
        holderName: (bank.accountHolderName as string) ?? (bank.holderName as string) ?? '',
        accountNumberLast4: ((bank.accountNumberMasked as string) ?? '').slice(-4),
        ifsc: (bank.ifsc as string) ?? '',
        bankName: (bank.bankName as string) ?? '',
      },
      status: 'pending',
      statusHistory: [{ status: 'pending', at: new Date(), byUid: uid, note: 'Requested by affiliate' }],
      rejectionReason: null,
      paymentReference: null,
      processedAt: null,
      processedByUid: null,
      nonce: wref.id,
      searchIndex: [shortId.toLowerCase(), ((c.name as string) || '').toLowerCase()].filter(Boolean),
      createdAt: now,
      updatedAt: now,
    });

    tx.update(custRef, { 'affiliate.hasPendingWithdrawal': true, updatedAt: now });
    tx.set(counterRef, { seq }, { merge: true });
    return { withdrawalId: wref.id, shortId };
  });

  return result;
});
