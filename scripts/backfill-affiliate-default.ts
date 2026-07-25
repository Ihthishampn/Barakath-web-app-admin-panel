/**
 * One-off, prod (barkath-25607): bring existing customers up to the new
 * "affiliate enabled by default" state. Provisions an ENABLED affiliate block —
 * same shape provisionAffiliateOnSignup writes for new users — on every customer
 * whose `affiliate` is still null.
 *
 * SKIPS anyone whose affiliate block already exists, including admin-revoked
 * users (affiliate.enabled === false) — a deliberate revoke must not be undone.
 * Idempotent: re-running only touches accounts still at affiliate:null.
 *
 * Run:  pnpm --filter @barkath/scripts exec tsx backfill-affiliate-default.ts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const KEY = '/home/h/barkath/.secrets/service-account.json';
initializeApp({ credential: cert(JSON.parse(readFileSync(KEY, 'utf8'))), projectId: 'barkath-25607' });
const db = getFirestore();

/** Mirrors functions/src/affiliate/withdrawals.ts referralCode(). */
function referralCode(name: string, uid: string): string {
  const first = (name.split(' ')[0] ?? 'BRK').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'BRK';
  return `${first}-${uid.slice(0, 4).toUpperCase()}`;
}

/** Mirrors normaliseCommissionRate() — accepts 5 or 0.05, both mean 5%. */
function normaliseRate(raw: number): number {
  if (!Number.isFinite(raw) || raw < 0) return 0.05;
  if (raw > 100) return 0.05;
  const rate = raw > 1 ? raw / 100 : raw;
  return rate < 0 || rate > 1 ? 0.05 : rate;
}

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
  return `${base}-${uid.slice(4, 10).toUpperCase()}`;
}

async function main() {
  const settings = await db.doc('settings/affiliate').get();
  const rate = normaliseRate(Number(settings.get('defaultCommissionRate') ?? 0.05));

  const all = await db.collection('customers').get();
  let provisioned = 0;
  let skipped = 0;

  for (const doc of all.docs) {
    if (doc.get('affiliate') != null) {
      skipped++;
      continue; // already an affiliate (enabled OR admin-revoked) — leave it.
    }
    const uid = doc.id;
    const code = await uniqueReferralCode(String(doc.get('name') ?? ''), uid);
    const now = FieldValue.serverTimestamp();
    await doc.ref.update({
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
    provisioned++;
    console.log(`provisioned ${uid} (${doc.get('name') || 'no name'}) → ${code}`);
  }

  console.log(`\nDone. provisioned=${provisioned}, skipped(existing affiliate)=${skipped}, total=${all.size}`);
}

await main();
