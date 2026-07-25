import { collection, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { Customer, WithdrawalRequest } from '@barkath/shared';
import { db, functions } from '@/lib/firebase';
import { useLiveCollection } from '@/hooks/firestoreCache';

export const AFFILIATES_KEY = 'customers:affiliates';
export const WITHDRAWALS_KEY = 'withdrawalRequests:pending';

/**
 * All customers with affiliate access enabled, real-time. Equality-only query
 * (`affiliate.enabled == true`) — a single-field index covers it, so no
 * composite index is required. Sorted client-side (see `sortAffiliates`).
 *
 * `enabled` is the caller's `customers` view permission: this reads the
 * customers collection, which firestore.rules gates on the customers module,
 * while the screen itself is gated on affiliateProgram. An affiliate-only
 * sub-admin must not fire the query at all (rules are not filters — it would
 * fail whole). The key changes with it so a permission granted mid-session
 * still attaches a listener.
 */
export function useAffiliates(enabled: boolean) {
  return useLiveCollection<Customer>(enabled ? AFFILIATES_KEY : `${AFFILIATES_KEY}:denied`, () =>
    enabled ? query(collection(db, 'customers'), where('affiliate.enabled', '==', true)) : null,
  );
}

/** Withdrawal requests, newest first, real-time (status + createdAt index exists). */
export function useWithdrawals() {
  return useLiveCollection<WithdrawalRequest>(WITHDRAWALS_KEY, () =>
    query(collection(db, 'withdrawalRequests'), orderBy('createdAt', 'desc')),
  );
}

/** Newest affiliates first (by enabledAt, falling back to created). */
export function sortAffiliates(list: Customer[]): Customer[] {
  return [...list].sort((a, b) => {
    const at = a.affiliate?.enabledAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
    const bt = b.affiliate?.enabledAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
    return bt - at;
  });
}

/** "HDFC ••4821" — bank label for a withdrawal request. */
export function bankLabel(w: WithdrawalRequest): string {
  return `${w.bankAccount.bankName} ••${w.bankAccount.accountNumberLast4}`;
}

/**
 * What the affiliate is actually owed on this request: the gross they asked for
 * less settings/affiliate's processing fee. That net figure is what web and the
 * app promise them ("You receive …") and what an admin wires by hand. Requests
 * written before the fields existed fall back to the gross.
 */
export const feePaiseOf = (w: WithdrawalRequest) => Number(w.processingFeePaise ?? 0);
export const netPayoutPaiseOf = (w: WithdrawalRequest) =>
  Number(w.netPayoutPaise ?? w.requestedAmountPaise);

/**
 * The figure to show in the Amount column.
 *
 * Before a decision it is the gross request — that is what will leave the
 * affiliate's confirmed balance. Once paid it is `paidAmountPaise`, the NET that
 * actually reached the bank (approveWithdrawal writes it). Showing the gross on
 * a settled row overstated every payout by the processing fee.
 */
export function displayAmountPaise(w: WithdrawalRequest): number {
  if (w.status !== 'paid') return w.requestedAmountPaise;
  return Number(w.paidAmountPaise ?? netPayoutPaiseOf(w));
}

/**
 * When a request reached its terminal state, and why.
 *
 * `processedAt` is stamped on BOTH outcomes (approveWithdrawal and
 * rejectWithdrawal both write it), so it can date a row but must never be used
 * to decide what happened to it — `status` is the only classifier. `paidAt` /
 * `rejectedAt` are the outcome-specific stamps; `processedAt` is the fallback
 * for rows written before they existed.
 */
export function outcomeNote(w: WithdrawalRequest): { at: Date | null; reason: string | null } | null {
  const stamp = (t: unknown): Date | null =>
    (t as { toDate?: () => Date } | null | undefined)?.toDate?.() ?? null;
  if (w.status === 'paid') {
    return { at: stamp(w.paidAt) ?? stamp(w.processedAt), reason: w.paymentReference };
  }
  if (w.status === 'rejected') {
    return { at: stamp(w.rejectedAt) ?? stamp(w.processedAt), reason: w.rejectionReason };
  }
  return null;
}

// ── Privileged mutations (Cloud Functions — money / cross-user / atomic) ─────
// Not deployed yet → these fail with `not-found`; callers wrap with cfError.

/**
 * Pay out a withdrawal from confirmed commission (money op → server-side).
 *
 * `paymentReference` is the UTR / transfer reference of the bank transfer the
 * admin has just made by hand — payouts are settled manually, so it is the only
 * evidence tying the terminal `status: 'paid'` row to real money. The callable
 * has always accepted it; the panel never sent one, so every settled request
 * stored `paymentReference: null`.
 */
export async function approveWithdrawal(requestId: string, paymentReference: string): Promise<void> {
  const call = httpsCallable(functions, 'approveWithdrawal');
  await call({ requestId, paymentReference });
}

/** Decline a withdrawal with a customer-facing reason. */
export async function rejectWithdrawal(requestId: string, reason: string): Promise<void> {
  const call = httpsCallable(functions, 'rejectWithdrawal');
  await call({ requestId, reason });
}

// ── Allocation / wallet access ──────────────────────────────────────────────
// There is no per-affiliate commission rate any more — commission is configured
// per product (amount or percentage). Allocation only turns affiliate access on
// and (optionally) toggles wallet-withdrawal access.

/** Grant affiliate access to a customer (allocates code + wallet server-side). */
export async function allocateAffiliate(input: { uid: string; walletEnabled: boolean }): Promise<void> {
  const call = httpsCallable(functions, 'adminAllocateAffiliate');
  await call(input);
}

/**
 * Change an EXISTING affiliate's wallet-withdrawal access. Deliberately separate
 * from allocate (which turns access ON) so an edit can never re-enable a revoked
 * affiliate as a side effect; audits as `affiliate.terms_updated`.
 */
export async function updateAffiliateTerms(input: { uid: string; walletEnabled: boolean }): Promise<void> {
  const call = httpsCallable(functions, 'adminUpdateAffiliateCommission');
  await call(input);
}
