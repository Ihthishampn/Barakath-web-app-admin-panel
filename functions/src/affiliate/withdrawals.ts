/**
 * Affiliate money operations (all CF-only; withdrawalRequests is write:false):
 *  - adminAllocateAffiliate / adminRevokeAffiliate — grant/revoke affiliate access
 *  - approveWithdrawal / rejectWithdrawal — pay out or decline a withdrawal
 * Balances move atomically inside a transaction; every action is audited.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, FieldValue, callableOpts } from '../_lib/admin.js';
import { requireModule, writeAudit } from '../_lib/guards.js';
import { notifyWithdrawalDecision } from '../notifications/events.js';

export function referralCode(name: string, uid: string): string {
  const first = (name.split(' ')[0] ?? 'BRK').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'BRK';
  return `${first}-${uid.slice(0, 4).toUpperCase()}`;
}

/**
 * The rate is STORED as a fraction (production carries 0.05 for 5%), and both
 * the accrual engine (commissions.ts normaliseRate) and this module have always
 * accepted the percent form too — so `5` and `0.05` both mean 5%.
 *
 * The bounds are new. `z.number().nonnegative()` alone accepted 500, which
 * became a rate of 5.0 — a 500% commission, paid out of real money on every
 * referred order until someone noticed. Anything above 100 (percent) is a typo,
 * never an intention.
 */
export function normaliseCommissionRate(raw: number): number {
  if (!Number.isFinite(raw) || raw < 0) {
    throw new HttpsError('invalid-argument', 'Enter a commission rate between 0% and 100%.');
  }
  if (raw > 100) {
    throw new HttpsError('invalid-argument', 'Commission rate cannot be more than 100%.');
  }
  const rate = raw > 1 ? raw / 100 : raw; // accept 5 or 0.05
  if (rate < 0 || rate > 1) {
    throw new HttpsError('invalid-argument', 'Commission rate cannot be more than 100%.');
  }
  return rate;
}

export const adminAllocateAffiliate = onCall(callableOpts, async (req) => {
  const { uid: actor } = await requireModule(req, 'affiliateProgram', 'edit');
  // commissionRate is optional: the Customers screens toggle affiliate access
  // without asking for a rate, and requiring it here made that toggle fail with
  // invalid-argument every time. When it is omitted we keep the rate the
  // affiliate already had, else fall back to settings/affiliate.
  const parsed = z
    .object({
      uid: z.string().min(1),
      commissionRate: z.number().nonnegative().optional(),
      walletEnabled: z.boolean().optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');
  const { uid, commissionRate, walletEnabled } = parsed.data;

  const ref = db.doc(`customers/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Customer not found.');
  const existing = snap.get('affiliate') as Record<string, any> | null;

  let resolvedRate = commissionRate;
  if (resolvedRate == null) resolvedRate = Number(existing?.commissionRate ?? NaN);
  if (!Number.isFinite(resolvedRate)) {
    const settings = await db.doc('settings/affiliate').get();
    resolvedRate = Number(settings.get('defaultCommissionRate') ?? 0.05);
  }
  const rate = normaliseCommissionRate(resolvedRate);

  const now = FieldValue.serverTimestamp();

  // Write only the fields that change, by field path. Replacing the whole
  // `affiliate` map from a non-transactional read silently reverted any
  // FieldValue.increment on affiliate.*BalancePaise (accrueCommission /
  // confirmCommissionsForOrder) that landed between the read and the write.
  const update: Record<string, unknown> = {
    'affiliate.enabled': true,
    'affiliate.commissionRate': rate,
    // The allocate screen's 'Enable affiliate wallet access' toggle used to be
    // accepted and dropped on the floor; at least persist what the admin chose.
    'affiliate.walletEnabled': walletEnabled ?? existing?.walletEnabled ?? true,
    role: 'affiliate',
    updatedAt: now,
  };
  if (existing) {
    if (existing.enabledAt == null) update['affiliate.enabledAt'] = now;
    if (!existing.referralCode) update['affiliate.referralCode'] = referralCode(snap.get('name') ?? '', uid);
  } else {
    Object.assign(update, {
      'affiliate.enabledAt': now,
      'affiliate.referralCode': referralCode(snap.get('name') ?? '', uid),
      'affiliate.pendingBalancePaise': 0,
      'affiliate.confirmedBalancePaise': 0,
      'affiliate.withdrawnBalancePaise': 0,
      'affiliate.lifetimeEarningsPaise': 0,
      'affiliate.referredCount': 0,
      'affiliate.activeReferredCount': 0,
      'affiliate.lastCommissionAt': null,
      'affiliate.hasPendingWithdrawal': false,
    });
  }
  await ref.update(update);
  await writeAudit({ actorUid: actor, action: 'affiliate.allocated', entity: 'customers', entityId: uid, meta: { rate } });
  return { ok: true };
});

/**
 * adminUpdateAffiliateCommission — change an EXISTING affiliate's terms.
 *
 * `adminAllocateAffiliate` set `affiliate.commissionRate` once, at allocation,
 * and nothing anywhere could change it afterwards: correcting a rate meant
 * editing the customer document by hand in the console. This is the missing
 * half — the same `affiliateProgram.edit` gate its siblings use, the same
 * field-path writes (a whole-map replace would discard commission increments
 * committed since the read), and an audit entry carrying before/after so a rate
 * change is reconstructable.
 *
 * NOT retroactive, by construction: `commissions/{orderId}` stores the rate AND
 * the resolved `commissionPaise` at accrual time, and every later step
 * (confirmation, reversal, payout settlement) works from the stored figures.
 * Changing the rate only affects orders placed after the change.
 *
 * Deliberately separate from allocate rather than folded into it: allocate is
 * also the Customers-screen "make this customer an affiliate" toggle, which
 * sends no rate at all, so an admin editing terms needs a call that cannot
 * silently re-enable a revoked affiliate as a side effect.
 */
export const adminUpdateAffiliateCommission = onCall(callableOpts, async (req) => {
  const { uid: actor } = await requireModule(req, 'affiliateProgram', 'edit');
  const parsed = z
    .object({
      uid: z.string().min(1),
      /** Fraction (0.05) or percent (5) — both accepted, stored as a fraction. */
      commissionRate: z.number().optional(),
      walletEnabled: z.boolean().optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');
  const { uid, commissionRate, walletEnabled } = parsed.data;
  if (commissionRate == null && walletEnabled == null) {
    throw new HttpsError('invalid-argument', 'Nothing to update.');
  }

  const ref = db.doc(`customers/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Customer not found.');
  const existing = snap.get('affiliate') as Record<string, any> | null;
  // Only an allocated affiliate has terms to edit. Writing a rate onto a
  // customer who is not one would create a half-built `affiliate` map with no
  // referral code and no balances — which every reader treats as an affiliate.
  if (!existing) {
    throw new HttpsError('failed-precondition', 'This customer is not an affiliate yet.');
  }

  const before = {
    commissionRate: Number(existing.commissionRate ?? 0),
    walletEnabled: existing.walletEnabled !== false,
  };
  const rate = commissionRate == null ? before.commissionRate : normaliseCommissionRate(commissionRate);
  const wallet = walletEnabled ?? before.walletEnabled;

  const update: Record<string, unknown> = {
    'affiliate.commissionRate': rate,
    'affiliate.walletEnabled': wallet,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.update(update);

  await writeAudit({
    actorUid: actor,
    action: 'affiliate.terms_updated',
    entity: 'customers',
    entityId: uid,
    before,
    after: { commissionRate: rate, walletEnabled: wallet },
    meta: { rate, walletEnabled: wallet },
  });
  return { ok: true, commissionRate: rate, walletEnabled: wallet };
});

export const adminRevokeAffiliate = onCall(callableOpts, async (req) => {
  const { uid: actor } = await requireModule(req, 'affiliateProgram', 'edit');
  const parsed = z.object({ uid: z.string().min(1) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');
  const ref = db.doc(`customers/${parsed.data.uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Customer not found.');
  // Field-path write, not a whole-map replace: a stale read here would otherwise
  // wipe commission increments committed since the read (see allocate above).
  await ref.update({ 'affiliate.enabled': false, updatedAt: FieldValue.serverTimestamp() });
  await writeAudit({ actorUid: actor, action: 'affiliate.revoked', entity: 'customers', entityId: parsed.data.uid });
  return { ok: true };
});

export const approveWithdrawal = onCall(callableOpts, async (req) => {
  const { uid: actor } = await requireModule(req, 'affiliateProgram', 'approve');
  // paymentReference is REQUIRED. The transfer happens by hand outside the
  // system, so this string is the only proof it happened — a `paid` row without
  // one cannot be reconciled against a bank statement later. It was optional,
  // and the admin panel never sent it, so every settled payout stored null.
  const parsed = z
    .object({ requestId: z.string().min(1), paymentReference: z.string().trim().min(1) })
    .safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'A bank transfer reference is required.');
  }
  const wref = db.doc(`withdrawalRequests/${parsed.data.requestId}`);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(wref);
    if (!snap.exists) throw new HttpsError('not-found', 'Withdrawal not found.');
    const w = snap.data() as Record<string, any>;
    if (w.status !== 'pending' && w.status !== 'processing') throw new HttpsError('failed-precondition', `Already ${w.status}.`);
    const amount = Number(w.requestedAmountPaise ?? 0);
    // What actually reaches the bank = requested − processing fee. Recomputed
    // rather than trusted blindly so a request written before netPayoutPaise
    // existed still settles with a truthful figure for the client to show.
    const feePaise = Number(w.processingFeePaise ?? 0);
    const netPaidPaise = Number.isFinite(Number(w.netPayoutPaise))
      ? Number(w.netPayoutPaise)
      : Math.max(0, amount - feePaise);
    const now = FieldValue.serverTimestamp();

    const cref = db.doc(`customers/${w.customerId}`);
    const csnap = await tx.get(cref);
    // Which commission rows this payout settles. Without this the balances moved
    // but every row stayed 'confirmed' for ever, so the ledger could never
    // answer "what was this payout actually made up of?". Oldest first, so a
    // payout clears the longest-waiting earnings and leaves a coherent tail.
    // Read here, in the transaction's read phase, before any write.
    // Advisory, never fatal: this is bookkeeping on top of the payout, so a
    // missing/building composite index must not stop an admin paying an
    // affiliate. Degrades to "balances moved, rows not attributed", which the
    // audit entry records via commissionsSettled: 0.
    let settleable: FirebaseFirestore.QuerySnapshot | null = null;
    try {
      settleable = await tx.get(
        db
          .collection('commissions')
          .where('affiliateUid', '==', w.customerId)
          .where('status', '==', 'confirmed')
          .where('withdrawalRequestId', '==', null)
          .orderBy('createdAt', 'asc')
          .limit(400),
      );
    } catch (e) {
      console.error('withdrawal approve: commission settlement query failed', e);
    }
    if (csnap.exists) {
      const aff = (csnap.get('affiliate') as Record<string, any> | null) ?? {};
      const available = Number(aff.confirmedBalancePaise ?? 0);
      // Re-assert the balance HERE. requestWithdrawal only checked it when the
      // affiliate asked, and reverseCommissionsForRefund claws confirmed
      // commission back whenever a referred order is returned — so by approval
      // time the balance may be lower. Flooring the subtraction at 0 (as this
      // used to) silently paid out more than was ever earned, and payouts are
      // wired by hand off exactly this number.
      if (amount > available) {
        throw new HttpsError(
          'failed-precondition',
          `Confirmed balance is only ₹${(available / 100).toFixed(2)} — less than the requested ₹${(amount / 100).toFixed(2)}.`,
        );
      }
      // Field-path writes, not a whole-map replace: the `affiliate` map also
      // carries balances moved by FieldValue.increment (accrueCommission /
      // confirmCommissionsForOrder), and rewriting the map from a read wipes
      // anything that landed in between — the exact bug allocate/revoke above
      // were fixed for.
      tx.update(cref, {
        'affiliate.confirmedBalancePaise': available - amount,
        'affiliate.withdrawnBalancePaise': FieldValue.increment(amount),
        'affiliate.hasPendingWithdrawal': false,
        'affiliate.lastWithdrawalPaidAt': now,
        updatedAt: now,
      });
    }
    // Terminal, unambiguous payout state. No transfer is performed here —
    // payouts are settled by hand (Razorpay is in test mode) — so these fields
    // ARE the record of the payout: `status: 'paid'` + `paidAt` + the net amount
    // that actually reached the bank. A client renders "Amount credited to your
    // bank account." off status === 'paid' with no further inference.
    tx.update(wref, {
      status: 'paid',
      paidAt: now,
      paidAmountPaise: netPaidPaise,
      // Explicit: the money moved outside the system, not through a gateway API.
      payoutMode: 'manual',
      processedAt: now, processedByUid: actor,
      // A payout that succeeded must not keep showing an old decline reason.
      rejectionReason: null,
      paymentReference: parsed.data.paymentReference ?? null, updatedAt: now,
      statusHistory: FieldValue.arrayUnion({ status: 'paid', at: new Date(), byUid: actor, note: null }),
    });

    // Mark the rows this payout covers, up to the gross requested. Stopping at
    // the amount (rather than settling everything confirmed) keeps the ledger
    // honest when an affiliate withdraws only part of their balance.
    let remaining = amount;
    let settledCount = 0;
    for (const d of settleable?.docs ?? []) {
      if (remaining <= 0) break;
      const net = Number(d.get('commissionPaise') ?? 0) - Number(d.get('reversedPaise') ?? 0);
      if (net <= 0) continue;
      // Only stamp a row 'paid' when this payout actually covers ALL of it.
      // Marking a row 'paid' that was only partly covered (which is what
      // `remaining -= net` going negative used to do) both overstates the payout
      // and makes the row terminal, so a later return could never claw it back
      // against a balance that still held most of it. Skip it — oldest-first
      // means it is simply settled by the next payout that can cover it.
      if (net > remaining) continue;
      tx.update(d.ref, {
        status: 'paid',
        withdrawalRequestId: parsed.data.requestId,
        paidAt: now,
        updatedAt: now,
      });
      remaining -= net;
      settledCount++;
    }
    return {
      amount,
      netPaidPaise,
      settledCount,
      customerId: String(w.customerId ?? ''),
      shortId: (w.shortId as string | null) ?? null,
    };
  });

  // The payout is manual and the affiliate has no other signal that it happened.
  // Announce the NET figure — that is what actually reached the bank.
  await notifyWithdrawalDecision({
    affiliateUid: out.customerId,
    requestId: parsed.data.requestId,
    shortId: out.shortId,
    decision: 'paid',
    amountPaise: out.netPaidPaise,
  });

  await writeAudit({ actorUid: actor, action: 'withdrawal.approved', entity: 'withdrawalRequests', entityId: parsed.data.requestId, amountPaise: out.amount, meta: { netPaidPaise: out.netPaidPaise, commissionsSettled: out.settledCount } });
  return { ok: true };
});

export const rejectWithdrawal = onCall(callableOpts, async (req) => {
  const { uid: actor } = await requireModule(req, 'affiliateProgram', 'approve');
  const parsed = z.object({ requestId: z.string().min(1), reason: z.string().min(1) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'A reason is required.');
  const wref = db.doc(`withdrawalRequests/${parsed.data.requestId}`);

  // Set on the committing attempt, for the notification after the commit.
  let declined: { customerId: string; shortId: string | null; amountPaise: number } | null = null;

  await db.runTransaction(async (tx) => {
    declined = null;
    const snap = await tx.get(wref);
    if (!snap.exists) throw new HttpsError('not-found', 'Withdrawal not found.');
    const w = snap.data() as Record<string, any>;
    if (w.status !== 'pending' && w.status !== 'processing') throw new HttpsError('failed-precondition', `Already ${w.status}.`);
    declined = {
      customerId: String(w.customerId ?? ''),
      shortId: (w.shortId as string | null) ?? null,
      amountPaise: Number(w.requestedAmountPaise ?? 0),
    };
    const now = FieldValue.serverTimestamp();
    const cref = db.doc(`customers/${w.customerId}`);
    const csnap = await tx.get(cref);
    if (csnap.exists) {
      // Field-path write (see approveWithdrawal): a whole-map replace would
      // discard commission increments committed since this read. Nothing is
      // deducted — a rejected request never touched the balance — the affiliate
      // is simply free to request again.
      tx.update(cref, { 'affiliate.hasPendingWithdrawal': false, updatedAt: now });
    }
    // Terminal decline state, mirroring the paid one: status + a stamp + the
    // reason the client shows verbatim (`rejectionReason` is required above, so
    // it is never null on a rejected request).
    tx.update(wref, {
      status: 'rejected', rejectionReason: parsed.data.reason,
      rejectedAt: now, paidAt: null, paidAmountPaise: 0,
      processedAt: now, processedByUid: actor, updatedAt: now,
      statusHistory: FieldValue.arrayUnion({ status: 'rejected', at: new Date(), byUid: actor, note: parsed.data.reason }),
    });
  });

  const out = declined as { customerId: string; shortId: string | null; amountPaise: number } | null;
  if (out?.customerId) {
    await notifyWithdrawalDecision({
      affiliateUid: out.customerId,
      requestId: parsed.data.requestId,
      shortId: out.shortId,
      decision: 'rejected',
      amountPaise: out.amountPaise,
      reason: parsed.data.reason,
    });
  }

  await writeAudit({ actorUid: actor, action: 'withdrawal.rejected', entity: 'withdrawalRequests', entityId: parsed.data.requestId, meta: { reason: parsed.data.reason } });
  return { ok: true };
});
