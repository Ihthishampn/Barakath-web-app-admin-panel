/**
 * Verifies couponExpirySweep against the running Firestore emulator.
 *
 * Runs the REAL compiled sweep (functions/lib) so this exercises production
 * code, not a re-implementation. Provisions three coupons, sweeps, and asserts:
 *   - a personal coupon past expiresAt (status:'active')  → 'expired'
 *   - a personal coupon still in date  (status:'active')  → stays 'active'
 *   - a promo coupon past validUntil   (status:'active')  → 'expired'
 *
 * Run with the emulator env set on the command line so firebase-admin connects
 * to the emulator BEFORE the modules initialize:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=barkath-25607 \
 *     node scripts/verify-sweep.mjs
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'barkath-25607' });
}
const db = getFirestore();

const { sweepExpiredCoupons } = await import(
  pathToFileURL(resolve('functions/lib/scheduled/sweeps.js')).href
);

const UID = 'SWEEPTEST';
const past = Timestamp.fromMillis(Date.now() - 3_600_000);
const future = Timestamp.fromMillis(Date.now() + 3_600_000);

const expiredUser = db.doc(`customers/${UID}/coupons/expired1`);
const activeUser = db.doc(`customers/${UID}/coupons/active1`);
const expiredPromo = db.doc('coupons/SWEEPPROMO');

await expiredUser.set({ code: 'SWEEP-EXP', status: 'active', expiresAt: past, issuedAt: past });
await activeUser.set({ code: 'SWEEP-ACT', status: 'active', expiresAt: future, issuedAt: past });
await expiredPromo.set({ code: 'SWEEPPROMO', status: 'active', active: true, validUntil: past });

const result = await sweepExpiredCoupons();
console.log('sweep counts:', JSON.stringify(result));

const expiredUserAfter = (await expiredUser.get()).data();
const activeUserAfter = (await activeUser.get()).data();
const expiredPromoAfter = (await expiredPromo.get()).data();

console.log('expired user coupon →', expiredUserAfter?.status);
console.log('active  user coupon →', activeUserAfter?.status);
console.log('expired promo coupon →', expiredPromoAfter?.status);

const failures = [];
if (expiredUserAfter?.status !== 'expired') failures.push('expired user coupon NOT swept');
if (activeUserAfter?.status !== 'active') failures.push('in-date user coupon was WRONGLY swept');
if (expiredPromoAfter?.status !== 'expired') failures.push('expired promo coupon NOT swept');

// Clean up so reruns start fresh.
await expiredUser.delete();
await activeUser.delete();
await expiredPromo.delete();

if (failures.length) {
  console.error('SWEEP FAIL:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('SWEEP OK — Active→Expired reconciliation works for both collections.');
process.exit(0);
