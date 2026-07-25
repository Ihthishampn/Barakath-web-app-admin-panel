/**
 * Backfill: give every product a PRODUCT-LEVEL affiliate commission.
 *
 * Commission is now configured on the product (a fixed amount OR a percentage),
 * not on the affiliate. This backfills legacy products so the affiliate system
 * keeps working:
 *   1. product already has `commissionPaise` (amount)  → keep it.
 *   2. else product already has `affiliateCommissionRate` (percent) → keep it.
 *   3. else lift a per-variant `commissionPaise` up to the product (amount),
 *      preserving what a variant-commission product used to pay.
 *   4. else default to DEFAULT_PRODUCT_COMMISSION_RATE (5%).
 * In every case the two product fields are made mutually exclusive, per-variant
 * `commissionPaise` is nulled (checkout reads the product level now), and
 * `isAffiliateEligible` is defaulted to true if unset.
 *
 * Idempotent. Emulator by default; TARGET=prod (with the service-account key)
 * to run against production.
 *
 *   GCLOUD_PROJECT=barkath-25607 pnpm --filter @barkath/scripts exec tsx backfill-product-commission.ts
 *   TARGET=prod pnpm --filter @barkath/scripts exec tsx backfill-product-commission.ts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { DEFAULT_PRODUCT_COMMISSION_RATE } from '@barkath/shared';

const PROD = process.env.TARGET === 'prod';
const PROJECT_ID = 'barkath-25607';

if (PROD) {
  const KEY = process.env.SERVICE_ACCOUNT || '/home/h/barkath/.secrets/service-account.json';
  initializeApp({ credential: cert(JSON.parse(readFileSync(KEY, 'utf8'))), projectId: PROJECT_ID });
} else {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || PROJECT_ID });
}

const db = getFirestore();

async function main() {
  console.log(`Backfilling product commission (${PROD ? 'PROD' : 'emulator'})…`);
  const products = await db.collection('products').get();
  let touched = 0;

  for (const p of products.docs) {
    const d = p.data() as Record<string, unknown>;
    const productAmount = d.commissionPaise;
    const productRate = d.affiliateCommissionRate;
    const variants = Array.isArray(d.variants) ? (d.variants as Array<Record<string, unknown>>) : [];

    let commissionPaise: number | null = null;
    let affiliateCommissionRate: number | null = null;

    if (typeof productAmount === 'number') {
      commissionPaise = productAmount; // (1) keep the fixed amount
    } else if (typeof productRate === 'number') {
      affiliateCommissionRate = productRate; // (2) keep the percentage
    } else {
      // (3) lift a per-variant amount up to the product, if any.
      const variantAmount = variants
        .map((v) => v.commissionPaise)
        .find((c) => typeof c === 'number') as number | undefined;
      if (typeof variantAmount === 'number') {
        commissionPaise = variantAmount;
      } else {
        affiliateCommissionRate = DEFAULT_PRODUCT_COMMISSION_RATE; // (4) default 5%
      }
    }

    // Null per-variant commission — checkout reads the product level now.
    const nextVariants = variants.map((v) => ({ ...v, commissionPaise: null }));

    await p.ref.update({
      commissionPaise,
      affiliateCommissionRate,
      isAffiliateEligible: d.isAffiliateEligible !== false,
      ...(variants.length ? { variants: nextVariants } : {}),
      updatedAt: Timestamp.now(),
    });
    touched++;
    const desc =
      commissionPaise != null ? `₹${(commissionPaise / 100).toFixed(2)}/unit` : `${(affiliateCommissionRate! * 100).toFixed(1)}%`;
    console.log(`  ${p.id}: ${desc}`);
  }

  console.log(`Done — ${touched} product(s) updated.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
