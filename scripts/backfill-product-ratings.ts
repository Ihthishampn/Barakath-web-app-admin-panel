/**
 * Backfill: make every product's rating REVIEW-DERIVED.
 *
 * Recomputes `products/{id}.rating` / `.ratingCount` from that product's
 * APPROVED reviews and strips the retired manual-seed provenance fields
 * (`seedRating`, `seedRatingCount`, `reviewRatingSum`, `reviewRatingCount`).
 * A product with no approved reviews is reset to the 1.0 / 0 baseline. This is
 * the same computation the `onReviewWritten` trigger
 * (functions/src/reviews/aggregate.ts) does live — run once to clear the old
 * fabricated seed numbers that predate the trigger.
 *
 * Idempotent: safe to run repeatedly.
 *
 * Emulator (default, safe):
 *   firebase emulators:start
 *   GCLOUD_PROJECT=barkath-25607 pnpm --filter @barkath/scripts exec tsx backfill-product-ratings.ts
 *
 * Production (explicit opt-in — needs the service-account key):
 *   TARGET=prod pnpm --filter @barkath/scripts exec tsx backfill-product-ratings.ts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

const PROD = process.env.TARGET === 'prod';
const PROJECT_ID = 'barkath-25607';

if (PROD) {
  // Real project — authenticate with the service-account key, no emulator host.
  const KEY = process.env.SERVICE_ACCOUNT || '/home/h/barkath/.secrets/service-account.json';
  initializeApp({ credential: cert(JSON.parse(readFileSync(KEY, 'utf8'))), projectId: PROJECT_ID });
} else {
  // Emulator by default — guardrail against accidentally touching prod.
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || PROJECT_ID });
}

const db = getFirestore();
const BASELINE_RATING = 1;

async function main() {
  console.log(`Backfilling product ratings (${PROD ? 'PROD' : 'emulator'})…`);
  const products = await db.collection('products').get();
  let touched = 0;

  for (const p of products.docs) {
    const q = await db
      .collection('reviews')
      .where('productId', '==', p.id)
      .where('status', '==', 'approved')
      .get();

    const ratingCount = q.size;
    const sum = q.docs.reduce((a, d) => a + Number(d.get('rating') ?? 0), 0);
    const rating =
      ratingCount > 0 ? Math.round((sum / ratingCount) * 10) / 10 : BASELINE_RATING;

    await p.ref.update({
      rating,
      ratingCount,
      seedRating: FieldValue.delete(),
      seedRatingCount: FieldValue.delete(),
      reviewRatingSum: FieldValue.delete(),
      reviewRatingCount: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    });
    touched++;
    console.log(`  ${p.id}: ${rating} ★ · ${ratingCount} review(s)`);
  }

  console.log(`Done — ${touched} product(s) recomputed.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
