import { collection, doc, getDoc, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { Commission, Customer, Order, WalletTransaction } from '@barkath/shared';
import { db, functions } from '@/lib/firebase';
import { useLiveCollection, useLiveDoc } from '@/hooks/firestoreCache';

export const CUSTOMERS_KEY = 'customers:createdAt-desc';

/**
 * All customers, newest first, real-time.
 *
 * `enabled` is the caller's `customers` view permission. The Customers screens
 * are gated on that module by the route, so they pass nothing — but screens in
 * OTHER modules also need the roster (Affiliate ▸ Allocate), and firestore.rules
 * gates this collection on `customers` alone. Rules are not filters: firing the
 * query without the permission fails the whole listener, so those callers must
 * decide not to subscribe. The cache key changes with it, so a permission
 * granted mid-session still attaches a listener.
 */
export function useCustomersList(enabled = true) {
  return useLiveCollection<Customer>(enabled ? CUSTOMERS_KEY : `${CUSTOMERS_KEY}:denied`, () =>
    enabled ? query(collection(db, 'customers'), orderBy('createdAt', 'desc')) : null,
  );
}

/**
 * Customers whose permanent referral link points at this affiliate.
 *
 * `customers/{uid}.referredBy` (written once by the linkReferral CF at sign-up)
 * is now the ONLY source of affiliate attribution — there is no per-order
 * referral code any more — so this list is the complete answer to "who does this
 * affiliate earn from". Equality-only on a map field, which Firestore's
 * automatic single-field index covers (no composite index, no fieldOverrides);
 * sorted client-side, as one affiliate's referrals are always a small set.
 */
export function useReferredCustomers(affiliateUid: string | null) {
  return useLiveCollection<Customer>(`customers:referredBy:${affiliateUid}`, () =>
    affiliateUid
      ? query(collection(db, 'customers'), where('referredBy.affiliateUid', '==', affiliateUid))
      : null,
  );
}

export function useCustomer(uid: string | null) {
  return useLiveDoc<Customer>(uid ? `customers/${uid}` : null);
}

export async function getCustomer(uid: string): Promise<Customer | null> {
  const snap = await getDoc(doc(db, 'customers', uid));
  return snap.exists() ? (snap.data() as Customer) : null;
}

/**
 * Orders placed by one customer, real-time. Equality-only query (no composite
 * index needed); sorted newest-first client-side — a single customer's order
 * count is always small.
 */
export function useCustomerOrders(uid: string | null) {
  return useLiveCollection<Order>(`orders:customer:${uid}`, () =>
    uid ? query(collection(db, 'orders'), where('customerId', '==', uid)) : null,
  );
}

/** Wallet ledger for one customer, newest first, real-time. */
export function useWalletTransactions(uid: string | null) {
  return useLiveCollection<WalletTransaction>(`wallet:${uid}`, () =>
    uid ? query(collection(db, 'customers', uid, 'walletTransactions'), orderBy('createdAt', 'desc')) : null,
  );
}

/** Affiliate commissions earned by one customer, newest first, real-time. */
export function useCommissions(uid: string | null) {
  return useLiveCollection<Commission>(`commissions:${uid}`, () =>
    uid ? query(collection(db, 'commissions'), where('affiliateUid', '==', uid), orderBy('accruedAt', 'desc')) : null,
  );
}

// ── Privileged mutations (Cloud Functions — cross-user / money) ──────
export async function setBlocked(uid: string, blocked: boolean, reason?: string): Promise<void> {
  const call = httpsCallable(functions, blocked ? 'adminBlockUser' : 'adminUnblockUser');
  await call({ uid, reason: reason ?? null });
}

/** Grant or revoke affiliate access (allocates code + wallet server-side). */
export async function setAffiliateEnabled(uid: string, enabled: boolean): Promise<void> {
  const call = httpsCallable(functions, enabled ? 'adminAllocateAffiliate' : 'adminRevokeAffiliate');
  await call({ uid });
}

/** Grant (positive) or revoke (negative) Spin & Win spins. Returns the new balance. */
export async function grantSpins(uid: string, spins: number): Promise<number> {
  const call = httpsCallable<{ uid: string; spins: number }, { ok: boolean; spinsRemaining: number }>(
    functions,
    'adminGrantSpins',
  );
  const res = await call({ uid, spins });
  return res.data.spinsRemaining;
}

/** Manually credit or deduct a customer's normal wallet. Returns the new balance (paise). */
export async function adjustWallet(
  uid: string,
  direction: 'credit' | 'debit',
  amountPaise: number,
  reason?: string,
): Promise<number> {
  const call = httpsCallable<
    { uid: string; direction: 'credit' | 'debit'; amountPaise: number; reason?: string },
    { ok: boolean; balancePaise: number }
  >(functions, 'adminAdjustWallet');
  const res = await call({ uid, direction, amountPaise, reason });
  return res.data.balancePaise;
}
