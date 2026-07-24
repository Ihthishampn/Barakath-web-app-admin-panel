/**
 * linkReferral — attach a customer to the affiliate whose code they entered.
 *
 * This is the missing half of the affiliate feature: the storefront collected a
 * referral code but discarded it, so `customers/{uid}.referredBy` was always
 * null and no commission could ever accrue. A callable (not a client write)
 * because it touches ANOTHER user's document — incrementing the affiliate's
 * referredCount — which security rules rightly forbid from the client.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, FieldValue, callableOpts } from '../_lib/admin.js';
import { requireActiveCustomer, requireCustomer } from '../_lib/guards.js';

const Schema = z.object({ code: z.string().min(1).max(40) });

/** Codes are stored upper-cased (see referralCode() in withdrawals.ts). */
export function normaliseReferralCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export interface ResolvedReferral {
  affiliateUid: string;
  /** The normalised code, as stored on the affiliate. */
  affiliateCode: string;
}

/**
 * Resolve a referral code to the affiliate that owns it.
 *
 * Used only by linkReferral now: a referral code is entered ONCE, at sign-up,
 * and checkout no longer accepts one (see placeOrder). It runs a QUERY, which
 * Firestore forbids inside a transaction — the caller therefore resolves the
 * code first and then re-reads the affiliate document inside its own
 * transaction's read phase before writing anything.
 *
 * Throws: not-found for an unknown code, failed-precondition for a disabled
 * affiliate or the caller's own code.
 */
export async function resolveReferralCode(
  rawCode: string,
  forUid: string,
): Promise<ResolvedReferral> {
  const code = normaliseReferralCode(rawCode);
  if (!code) throw new HttpsError('invalid-argument', 'Enter a referral code.');

  const q = await db
    .collection('customers')
    .where('affiliate.referralCode', '==', code)
    .limit(1)
    .get();
  if (q.empty) throw new HttpsError('not-found', 'That referral code is not valid.');

  const affiliate = q.docs[0]!;
  if (!(affiliate.get('affiliate') as { enabled?: boolean } | undefined)?.enabled) {
    throw new HttpsError('failed-precondition', 'That referral code is no longer active.');
  }
  if (affiliate.id === forUid) {
    throw new HttpsError('failed-precondition', 'You cannot use your own referral code.');
  }
  return { affiliateUid: affiliate.id, affiliateCode: code };
}

export const linkReferral = onCall(callableOpts, async (req) => {
  const { uid } = await requireActiveCustomer(req);
  const parsed = Schema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Enter a referral code.');
  const { affiliateUid, affiliateCode } = await resolveReferralCode(parsed.data.code, uid);

  const selfRef = db.doc(`customers/${uid}`);
  const affiliateRef = db.doc(`customers/${affiliateUid}`);
  const affiliateSnap = await affiliateRef.get();
  const affiliateName = String(affiliateSnap.get('name') ?? '').split(' ')[0] ?? '';

  await db.runTransaction(async (tx) => {
    const self = await tx.get(selfRef);
    if (!self.exists) throw new HttpsError('failed-precondition', 'Complete your profile first.');
    // The link is PERMANENT and is the only source of commission attribution
    // now that checkout takes no code. Re-linking is refused (not silently
    // re-pointed): it would move every future order's commission to a different
    // affiliate, and would leave the first affiliate's referredCount describing
    // a customer who no longer earns them anything. Read inside the transaction
    // so two concurrent calls contend instead of both writing a link.
    if (self.get('referredBy')) {
      throw new HttpsError('failed-precondition', 'Your account is already linked to a referrer.');
    }
    const now = FieldValue.serverTimestamp();
    tx.update(selfRef, {
      referredBy: { affiliateUid, affiliateCode, linkedAt: now },
      updatedAt: now,
    });
    tx.update(affiliateRef, {
      'affiliate.referredCount': FieldValue.increment(1),
      updatedAt: now,
    });
  });

  return { ok: true, affiliateName };
});
