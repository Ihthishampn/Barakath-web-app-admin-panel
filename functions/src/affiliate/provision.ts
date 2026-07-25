/**
 * provisionAffiliateOnSignup — every new customer is born an affiliate.
 *
 * Affiliate access is ON by default (product requirement): the moment a
 * customer document is created (both clients self-create it at first login —
 * web/src/lib/customerDoc.ts, app auth_repository.dart — writing `affiliate:
 * null`), this trigger fills in an ENABLED affiliate block: a referral code,
 * the default commission rate and zeroed balances.
 *
 * Why server-side and not in the client `defaultCustomer` builders: the
 * commission rate the accrual engine pays out is read straight from this block
 * (commissions.ts `accrueCommission`), so it must never be client-writable. The
 * customer create rule keeps `affiliate` null (firestore.rules), and this
 * Admin-SDK write — which bypasses rules — is the only thing that sets it. That
 * closes the door on a forged rate or pre-loaded balances.
 *
 * An admin can still disable/re-enable any user afterwards through
 * adminRevokeAffiliate / adminAllocateAffiliate (Customers screen toggle); this
 * only establishes the default-on state.
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db, FieldValue, REGION } from '../_lib/admin.js';
import { referralCode, normaliseCommissionRate } from './withdrawals.js';

/**
 * A referral code no other customer already holds. `resolveReferralCode`
 * (referral.ts) resolves a code with `.limit(1)` and takes the first match, so
 * a collision would silently attribute one affiliate's referrals to another —
 * tolerable when only a handful of admins were allocated, but everyone holds a
 * code now, so uniqueness is enforced here.
 */
async function uniqueReferralCode(name: string, uid: string): Promise<string> {
  const base = referralCode(name, uid);
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = attempt === 0 ? base : `${base}${attempt}`;
    const q = await db
      .collection('customers')
      .where('affiliate.referralCode', '==', candidate)
      .limit(1)
      .get();
    if (q.empty) return candidate;
  }
  // Vanishingly unlikely to get here — fall back to more uid entropy.
  return `${base}-${uid.slice(4, 10).toUpperCase()}`;
}

export const provisionAffiliateOnSignup = onDocumentCreated(
  { document: 'customers/{uid}', region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    // Never clobber a block that already exists — an admin pre-allocation, a
    // backfilled account, or a re-created doc. onDocumentCreated fires once per
    // create, and this handler's own update below does not re-fire it.
    if (snap.get('affiliate') != null) return;

    const uid = event.params.uid;
    const settings = await db.doc('settings/affiliate').get();
    const rate = normaliseCommissionRate(Number(settings.get('defaultCommissionRate') ?? 0.05));
    const code = await uniqueReferralCode(String(snap.get('name') ?? ''), uid);
    const now = FieldValue.serverTimestamp();

    // The doc's `affiliate` is null, so no concurrent affiliate.* increment can
    // be in flight — writing the whole block at once is safe here (unlike the
    // by-field-path discipline the admin allocate/accrual writers must keep).
    // `role` stays 'customer': every gate keys on affiliate.enabled, not role.
    await snap.ref.update({
      affiliate: {
        enabled: true,
        enabledAt: now,
        referralCode: code,
        commissionRate: rate,
        pendingBalancePaise: 0,
        confirmedBalancePaise: 0,
        withdrawnBalancePaise: 0,
        lifetimeEarningsPaise: 0,
        referredCount: 0,
        activeReferredCount: 0,
        lastCommissionAt: null,
        hasPendingWithdrawal: false,
        walletEnabled: true,
        lastWithdrawalPaidAt: null,
      },
      updatedAt: now,
    });
  },
);
