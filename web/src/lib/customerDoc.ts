'use client';
/**
 * Customer document lifecycle (create on first login, complete profile).
 *
 * For the DEV MOCK flow the doc is created client-side (a relaxed
 * `customers` create rule allows the owner to self-create with safe defaults).
 *
 * ┌─ FOR PRODUCTION (real MSG91) ──────────────────────────────────────────┐
 * │ Move creation server-side: have the `completeProfile` Cloud Function     │
 * │ create the doc with Admin SDK, and set firestore.rules `customers`       │
 * │ create back to `if false`. `ensureCustomerDoc` then becomes a no-op /    │
 * │ is replaced by that CF call. `completeCustomerProfile` (owner update of  │
 * │ name/email/profileComplete) stays valid under the existing update rule.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { buildSearchIndex } from '@barkath/shared';
import { auth, db } from './firebase';

/** 10-digit local + E.164, so admin search matches either form. */
function phoneTokens(phoneE164: string): string[] {
  return [phoneE164, phoneE164.replace(/^\+?91/, '')];
}

/** Safe, zeroed defaults for a brand-new customer (matches the Customer type). */
function defaultCustomer(uid: string, phoneE164: string) {
  return {
    id: uid,
    uid,
    phone: phoneE164,
    phoneVerified: true,
    name: '',
    email: null,
    emailVerified: false,
    gstin: null,
    avatarUrl: null,
    profileComplete: false,
    profileSkipped: false,
    role: 'customer' as const,
    isBlocked: false,
    blockReason: null,
    blockedAt: null,
    blockedByUid: null,
    wallet: {
      balancePaise: 0,
      breakdown: { refundsPaise: 0, rewardsPaise: 0, cashbackPaise: 0, topupPaise: 0 },
      lifetimeCreditsPaise: 0,
      lifetimeDebitsPaise: 0,
      lastTransactionAt: null,
    },
    spinsRemaining: 0,
    affiliate: null,
    referredBy: null,
    preferences: {
      notificationsEnabled: true,
      notifyOrderUpdates: true,
      notifyPromotions: true,
      notifyAffiliateEarnings: true,
      notifyWalletActivity: true,
    },
    stats: {
      ordersCount: 0,
      ordersDelivered: 0,
      ordersCancelled: 0,
      ordersReturned: 0,
      totalSpentPaise: 0,
      firstOrderAt: null,
      lastOrderAt: null,
      reviewsCount: 0,
      wishlistCount: 0,
      unreadNotifications: 0,
    },
    cart: [],
    addresses: [],
    bankAccounts: [],
    lastLoginAt: serverTimestamp(),
    lastActiveAt: serverTimestamp(),
    // searchIndex is maintained client-side (no onCustomerWrite trigger).
    searchIndex: buildSearchIndex(phoneTokens(phoneE164)),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

/**
 * Ensure a customer doc exists for the signed-in user (idempotent).
 * Returns whether the profile is already complete (drives post-login routing).
 */
export async function ensureCustomerDoc(phoneE164: string): Promise<{ profileComplete: boolean }> {
  const user = auth.currentUser;
  if (!user) return { profileComplete: false };
  const ref = doc(db, 'customers', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return { profileComplete: Boolean((snap.data() as { profileComplete?: boolean }).profileComplete) };
  }
  await setDoc(ref, defaultCustomer(user.uid, phoneE164));
  return { profileComplete: false };
}

/** Persist the display name / email and mark the profile complete. */
export async function completeCustomerProfile(name: string, email: string | null): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  const ref = doc(db, 'customers', user.uid);
  const phone = (await getDoc(ref)).get('phone') as string | undefined;
  await updateDoc(ref, {
    name: name.trim(),
    email: email?.trim() || null,
    profileComplete: true,
    // Recompute the search index client-side so admin search finds this customer.
    searchIndex: buildSearchIndex([name.trim(), email?.trim() ?? null, ...(phone ? phoneTokens(phone) : [])]),
    updatedAt: serverTimestamp(),
  });
}
