'use client';
import { useEffect, useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import type { Customer, WithdrawalRequest, WithdrawalStatus } from '@barkath/shared';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/useCollection';

/** Payout-account validation — mirrored by `requestWithdrawal` on the server. */
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCT_RE = /^\d{9,18}$/;

/** firestore.rules caps `customers/{uid}.bankAccounts` at 5 entries. */
export const MAX_BANK_ACCOUNTS = 5;

/** Only the last 4 digits are ever persisted (client-safe form). */
export function maskAccountNumber(digits: string): string {
  return `•••• ${digits.slice(-4)}`;
}

/**
 * Resolve an IFSC to a real bank + branch via Razorpay's public IFSC directory
 * (free, unauthenticated). Without it the bank name is typed by hand and the
 * branch is never known, so a payout account can be stored against a bank that
 * does not match the IFSC at all.
 *
 * `initialBranch` seeds the branch when editing an existing account: the lookup
 * only fires while the customer is typing an IFSC, so an untouched IFSC must
 * keep the branch already on file instead of blanking it.
 *
 * Returns the resolved bank name rather than writing it — the caller keeps the
 * Bank name field editable and simply syncs it when a lookup lands.
 */
export function useIfscLookup(
  ifsc: string,
  initialBranch: string | null = null,
): { branch: string | null; resolvedBankName: string | null; ifscUnknown: boolean } {
  const [branch, setBranch] = useState<string | null>(initialBranch);
  const [resolvedBankName, setResolvedBankName] = useState<string | null>(null);
  const [ifscUnknown, setIfscUnknown] = useState(false);

  useEffect(() => {
    if (!IFSC_RE.test(ifsc)) {
      setIfscUnknown(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`https://ifsc.razorpay.com/${ifsc}`, { signal: ctrl.signal });
        if (res.status === 404) {
          setIfscUnknown(true);
          setBranch(null);
          return;
        }
        if (!res.ok) return; // transient — leave whatever the customer typed
        const d = (await res.json()) as { BANK?: string; BRANCH?: string; CITY?: string };
        setIfscUnknown(false);
        if (d.BANK) setResolvedBankName(d.BANK);
        setBranch(d.BRANCH || d.CITY || null);
      } catch {
        // Offline or aborted — never block saving on the lookup.
      }
    }, 350); // debounce while typing
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [ifsc]);

  return { branch, resolvedBankName, ifscUnknown };
}

/** Withdrawal states where the payout has been requested but not settled. */
const OPEN_WITHDRAWAL_STATUSES: readonly WithdrawalStatus[] = ['pending', 'approved', 'processing'];

/**
 * Accounts that must not be edited or deleted because a payout is riding on
 * them: the admin settles withdrawals manually against the bank details copied
 * onto the `withdrawalRequests` row, so changing (or removing) the account
 * behind an open request would redirect money the admin is about to send.
 *
 * `affiliate.hasPendingWithdrawal` is the cheap flag that says "look"; the
 * request rows say WHICH account. While that flag is set we fail closed —
 * if the rows are still loading or unreadable we lock everything rather than
 * risk allowing an edit under an open request.
 */
export function usePayoutLock(customer: Customer | null): { isLocked: (bankId: string) => boolean } {
  const uid = customer?.uid;
  const pending = customer?.affiliate?.hasPendingWithdrawal === true;

  // Index-free: filter by owner only (no orderBy → no composite index), same as
  // the affiliate activity list. Skipped entirely when nothing is pending.
  const { data, loading, error } = useCollection<WithdrawalRequest>(
    () => (uid && pending ? query(collection(db, 'withdrawalRequests'), where('customerId', '==', uid)) : null),
    [uid, pending],
  );

  const lockedIds = useMemo(
    () =>
      new Set(
        data
          .filter((w) => OPEN_WITHDRAWAL_STATUSES.includes(w.status))
          .map((w) => w.bankAccount?.id)
          .filter(Boolean),
      ),
    [data],
  );

  return {
    isLocked: (bankId: string) => pending && (loading || error || lockedIds.has(bankId)),
  };
}

/** Copy shown wherever a locked account is blocked, so the reason is identical. */
export const PAYOUT_LOCK_MSG =
  'This account is on a withdrawal that’s being processed. You can change it once the payout is settled.';
