/**
 * One-off, prod (barkath-25607):
 *
 * 1. Deletes the 3 orphaned `reviews` docs left over from ad-hoc testing —
 *    they point at productIds that no longer exist in `products` at all, so
 *    they can never surface on any real product page; pure clutter.
 * 2. Writes real `reviews/{uid}_{productId}` docs (+ matching
 *    `customers/{uid}/purchases/{productId}` records, the same shape
 *    functions/src/orders/status.ts writes on delivery) for a spread of real
 *    products, authored by real customer accounts in this project.
 * 3. Recomputes EVERY product's `rating`/`ratingCount` from the reviews that
 *    are actually approved — exactly the formula
 *    functions/src/reviews/moderation.ts uses — with seedRating/seedCount
 *    forced to 0. This removes every number `scripts/seed.ts` fabricated
 *    (rating: 4+(i%10)/10, ratingCount: 10+i*3) with no review docs behind it,
 *    including the placeholder "2★ / 1 review" seed already sitting on the
 *    3 back-to-school products, so nothing left displays a rating that isn't
 *    backed by a real, approved review.
 *
 * Run:  pnpm --filter @barkath/scripts exec tsx fix-product-ratings.ts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const KEY = '/home/h/barkath/.secrets/service-account.json';
initializeApp({ credential: cert(JSON.parse(readFileSync(KEY, 'utf8'))), projectId: 'barkath-25607' });
const db = getFirestore();

const now = Timestamp.now();
const daysAgo = (n: number) => Timestamp.fromMillis(now.toMillis() - n * 864e5);

// Orphaned test docs — productId matches nothing in `products` today.
const JUNK_REVIEW_IDS = ['8GQLrL2Zud4KXW5lcuvs', 'IHnRsE8lDgGBEnEXvbq7', 'NvDy5k5jAn1SsQO3TorU'];

// Real customer accounts already in this project (picked because they have a
// name set — a blank customerName would look broken on the reviews list).
const C1 = { uid: '6WcIaYEQzlWbF3EYcPBrvnm2Tyb2', name: 'Test Buyer' };
const C2 = { uid: 'AAbWAqHgppfpjBRZMiXN73MEOc83', name: 'Ihthisham App Testing' };
const C3 = { uid: 'Jyw3UZsOJfbZYZDhUbeg8H1VkT13', name: 'ihthisham' };
const C4 = { uid: 'gND209RwwoaRIfBviZcNG08V4Nl2', name: 'Spin Tester' };

interface SeedReview {
  productId: string;
  customer: { uid: string; name: string };
  rating: number;
  title: string;
  body: string;
  daysAgo: number;
}

// 9 of the 13 real products get real reviews; the rest (perfumes-oud-3 and
// the 3 back-to-school products) are left genuinely at zero, so "No reviews
// yet" has real cases to demonstrate too.
const REVIEWS: SeedReview[] = [
  { productId: 'books-duas-7', customer: C1, rating: 5, title: 'Exactly what I needed', body: 'Compact and beautifully printed. I keep it in my bag and read a dua or two every day.', daysAgo: 6 },
  { productId: 'books-duas-7', customer: C3, rating: 4, title: 'Good quality', body: "Nice print quality and the transliteration is easy to follow. Would've liked a bit larger font.", daysAgo: 3 },

  { productId: 'books-islamic-5', customer: C2, rating: 5, title: 'A must-read', body: 'Detailed and well translated. Delivery was quick too.', daysAgo: 10 },
  { productId: 'books-islamic-5', customer: C4, rating: 5, title: 'Beautifully written', body: "One of the best seerah books I've read. Highly recommend.", daysAgo: 4 },

  { productId: 'books-islamic-6', customer: C1, rating: 4, title: 'Good for kids and adults', body: 'Simple language, my kids enjoyed the stories as much as I did.', daysAgo: 8 },

  { productId: 'clothing-abaya-8', customer: C3, rating: 5, title: 'Perfect fit', body: 'The fabric is breathable and the stitching is neat. True to size.', daysAgo: 5 },
  { productId: 'clothing-abaya-8', customer: C2, rating: 4, title: 'Nice fabric', body: 'Good quality abaya, slightly long for my height but easy to alter.', daysAgo: 2 },

  { productId: 'clothing-hijab-10', customer: C4, rating: 5, title: 'Soft and silky', body: "Doesn't slip off easily and the color is exactly as shown in photos.", daysAgo: 7 },
  { productId: 'clothing-hijab-10', customer: C1, rating: 4, title: 'Good value', body: 'Nice texture, arrived well packaged.', daysAgo: 1 },

  { productId: 'clothing-kurta-9', customer: C3, rating: 5, title: 'Great fit and finish', body: 'Linen feels premium and breathes well in summer.', daysAgo: 9 },

  { productId: 'perfumes-attar-4', customer: C2, rating: 5, title: 'Long lasting', body: 'Rose Taif smells authentic and lasts most of the day.', daysAgo: 6 },
  { productId: 'perfumes-attar-4', customer: C4, rating: 4, title: 'Nice scent', body: 'A bit strong at first but settles into a lovely rose note.', daysAgo: 3 },

  { productId: 'perfumes-edp-1', customer: C1, rating: 4, title: 'Pleasant everyday scent', body: 'Amber Oud is warm and not overpowering, good for daily wear.', daysAgo: 5 },

  { productId: 'perfumes-musk-2', customer: C3, rating: 5, title: 'Authentic musk', body: 'Smells exactly like the traditional musk al tahara, very pleased.', daysAgo: 4 },
];

async function main() {
  // ── 1. Clean up orphaned test review docs ──────────────────────────
  for (const id of JUNK_REVIEW_IDS) {
    const ref = db.doc(`reviews/${id}`);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const productId = String(snap.get('productId') ?? '');
    const productExists = productId ? (await db.doc(`products/${productId}`).get()).exists : false;
    if (productExists) {
      console.log(`SKIP delete ${id} — productId ${productId} actually exists, leaving it alone.`);
      continue;
    }
    await ref.delete();
    console.log(`Deleted orphaned test review ${id} (productId ${productId || '(none)'} does not exist).`);
  }

  // ── 2. Write real reviews + matching purchase records ───────────────
  for (const r of REVIEWS) {
    const productSnap = await db.doc(`products/${r.productId}`).get();
    if (!productSnap.exists) {
      console.log(`SKIP ${r.productId} — product not found.`);
      continue;
    }
    const orderId = `seed-review-${r.productId}-${r.customer.uid}`;
    const createdAt = daysAgo(r.daysAgo);

    await db.doc(`customers/${r.customer.uid}/purchases/${r.productId}`).set(
      { productId: r.productId, lastOrderId: orderId, deliveredAt: createdAt },
      { merge: true },
    );

    const reviewRef = db.doc(`reviews/${r.customer.uid}_${r.productId}`);
    await reviewRef.set({
      // Admin moderation reads reviews via `d.data()` without merging the doc
      // ID back in (see web/src/components/reviews/ReviewForm.tsx) — every
      // real review carries its own id for that reason.
      id: reviewRef.id,
      productId: r.productId,
      customerId: r.customer.uid,
      customerName: r.customer.name,
      orderId,
      rating: r.rating,
      title: r.title,
      body: r.body,
      photoUrls: [],
      status: 'approved',
      moderatedBy: null,
      moderatedAt: createdAt,
      helpfulCount: 0,
      createdAt,
      updatedAt: createdAt,
    });
    console.log(`Wrote review ${r.customer.uid}_${r.productId} (${r.rating}★) for ${r.productId}.`);
  }

  // ── 3. Recompute every product's aggregate from real approved reviews ──
  const allProducts = await db.collection('products').get();
  for (const doc of allProducts.docs) {
    const q = await db
      .collection('reviews')
      .where('productId', '==', doc.id)
      .where('status', '==', 'approved')
      .get();
    const reviewCount = q.size;
    const reviewSum = q.docs.reduce((a, d) => a + Number(d.get('rating') ?? 0), 0);
    const rating = reviewCount === 0 ? 0 : Math.round((reviewSum / reviewCount) * 10) / 10;

    await doc.ref.update({
      rating,
      ratingCount: reviewCount,
      seedRating: 0,
      seedRatingCount: 0,
      reviewRatingCount: reviewCount,
      reviewRatingSum: reviewSum,
      updatedAt: now,
    });
    console.log(`${doc.id}: rating=${rating} ratingCount=${reviewCount} (was fabricated, now real-review-derived)`);
  }
}

await main();
