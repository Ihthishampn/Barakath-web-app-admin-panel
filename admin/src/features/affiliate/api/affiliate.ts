import { collection, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { Customer, WithdrawalRequest } from '@barkath/shared';
import { db, functions } from '@/lib/firebase';
import { useLiveCollection } from '@/hooks/firestoreCache';
import type { SelectOption } from '@/components/ui/Select';

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

// ── Commission rate: percent in the UI, fraction on the wire ────────────────

/**
 * The rates the panel offers, as WHOLE PERCENTS. Shared by the allocate screen
 * and the customer profile so a rate can never be set to something the other
 * screen refuses to display.
 */
export const RATE_OPTIONS: SelectOption[] = [
  { value: '3', label: '3%' },
  { value: '5', label: '5%' },
  { value: '7', label: '7%' },
  { value: '10', label: '10%' },
];

/**
 * `affiliate.commissionRate` is stored as a FRACTION — production holds 0.05
 * for 5%. `normaliseRate` (functions/src/affiliate/commissions.ts) only divides
 * by 100 when the value is > 1, so a percent is tolerated for 3/5/7/10 but a
 * percent of 1 ("1%") would be read as 1.0 = 100%. The panel therefore labels
 * everything in percent and always sends the fraction, which is unambiguous at
 * every rate.
 */
export function ratePercent(rate: number | null | undefined): number | null {
  const n = Number(rate ?? NaN);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Values > 1 can only be a legacy percent that was stored unconverted.
  const pct = n > 1 ? n : n * 100;
  return Math.round(pct * 100) / 100; // 0.05 * 100 is 5.000000000000001 in JS
}

/** The fraction to store for a whole/decimal percent typed or picked by an admin. */
export function rateFraction(percent: number): number {
  return Math.round(percent * 100) / 10000;
}

/** "5%" for display, em-dash when no rate has ever been set. */
export function formatRate(rate: number | null | undefined): string {
  const pct = ratePercent(rate);
  return pct == null ? '—' : `${pct}%`;
}

/**
 * The rate picker's options for one affiliate: the standard presets, plus the
 * rate they are on today when it isn't one of them. Without that, opening the
 * picker on an affiliate hand-set to 6% would silently show (and then save) 3%.
 */
export function rateOptionsFor(rate: number | null | undefined): SelectOption[] {
  const pct = ratePercent(rate);
  if (pct == null || RATE_OPTIONS.some((o) => Number(o.value) === pct)) return RATE_OPTIONS;
  return [...RATE_OPTIONS, { value: String(pct), label: `${pct}% (current)` }].sort(
    (a, b) => Number(a.value) - Number(b.value),
  );
}

/**
 * The callable that owns `affiliate.commissionRate` / `affiliate.walletEnabled`.
 *
 * `adminAllocateAffiliate` is update-capable: it writes by field path, takes
 * commissionRate/walletEnabled as optionals, and leaves the balances, referral
 * code and enabledAt of an existing affiliate untouched — so the same call both
 * allocates and re-terms. If the server ever grows a dedicated callable, this
 * constant is the only thing that changes.
 */
const AFFILIATE_ALLOCATE_CALLABLE = 'adminAllocateAffiliate';
/**
 * Re-terming an EXISTING affiliate goes to its own callable, not to allocate.
 *
 * The two are deliberately different operations server-side: allocate turns
 * affiliate access ON, so routing an edit through it would silently re-enable an
 * affiliate whose access had been REVOKED — a rate change must never hand
 * someone their access back. adminUpdateAffiliateCommission refuses a customer
 * who is not already an affiliate, and audits as `affiliate.terms_updated`
 * rather than `affiliate.allocated`, so the log can tell an edit from a grant.
 */
const AFFILIATE_TERMS_CALLABLE = 'adminUpdateAffiliateCommission';

async function callAffiliateTerms(
  callable: string,
  input: { uid: string; commissionRate: number; walletEnabled: boolean },
): Promise<void> {
  const call = httpsCallable(functions, callable);
  await call(input);
}

/** Grant affiliate access to a customer (allocates code + wallet server-side). */
export async function allocateAffiliate(input: {
  uid: string;
  /** Fraction, not percent — see {@link rateFraction}. */
  commissionRate: number;
  walletEnabled: boolean;
}): Promise<void> {
  await callAffiliateTerms(AFFILIATE_ALLOCATE_CALLABLE, input);
}

/**
 * Change an EXISTING affiliate's commission rate / wallet access.
 *
 * Not retroactive: commission already accrued was written at the old rate by
 * `accrueCommission` and is never recalculated, so only orders placed from now
 * on earn at the new rate. Every screen offering this must say so.
 */
export async function updateAffiliateTerms(input: {
  uid: string;
  /** Fraction, not percent — see {@link rateFraction}. */
  commissionRate: number;
  walletEnabled: boolean;
}): Promise<void> {
  await callAffiliateTerms(AFFILIATE_TERMS_CALLABLE, input);
}
