/**
 * One-off: add a "Back to School" category + 3 flash-sale products to the REAL
 * project (barkath-25607). Products are flagged isFlashSale so they appear in
 * the storefront Flash sale rail.
 *
 * Run:  pnpm --filter @barkath/scripts exec tsx add-back-to-school.ts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { buildSearchIndex } from '@barkath/shared';

const KEY = '/home/h/barkath/.secrets/service-account.json';
initializeApp({ credential: cert(JSON.parse(readFileSync(KEY, 'utf8'))), projectId: 'barkath-25607' });
const db = getFirestore();

const now = Timestamp.now();
const inr = (r: number) => Math.round(r * 100);
const img = (id: string, alt: string) => ({
  url: `https://images.unsplash.com/photo-${id}?w=700&q=80&auto=format&fit=crop`,
  alt,
  order: 0,
  isPrimary: true,
});

const CAT_ID = 'back-to-school';
const TINT = '#f2c94c';

const PRODUCTS = [
  {
    id: 'back-to-school-1',
    name: 'School Backpack — Navy',
    title: 'School Backpack — Navy, Water-resistant',
    sub: 'Bags',
    mrp: 1899, offer: 1299,
    image: img('1553062407-98eeb64c6a62', 'Navy school backpack'),
  },
  {
    id: 'back-to-school-2',
    name: 'Complete Stationery Kit',
    title: 'Complete Stationery Kit — 42 pieces',
    sub: 'Stationery',
    mrp: 999, offer: 649,
    image: img('1519682337058-a94d519337bc', 'Stationery kit with notebooks and pens'),
  },
  {
    id: 'back-to-school-3',
    name: 'Insulated Lunch Box & Bottle',
    title: 'Insulated Lunch Box & Bottle Set',
    sub: 'Essentials',
    mrp: 1499, offer: 999,
    image: img('1602143407151-7111542de6e8', 'Insulated lunch box and water bottle'),
  },
];

async function main() {
  console.log('Adding "Back to School" category + flash-sale products to barkath-25607…');

  // Category
  await db.doc(`categories/${CAT_ID}`).set({
    id: CAT_ID,
    slug: CAT_ID,
    name: 'Back to School',
    displayName: 'Back to School',
    description: 'Back to School — bags, stationery and everyday essentials.',
    categoryTint: TINT,
    categoryTagColor: 'amber',
    iconUrl: null,
    heroImageUrl: null,
    order: 10,
    visibility: 'visible',
    productCount: PRODUCTS.length,
    subCategories: ['Bags', 'Stationery', 'Essentials'].map((s, i) => ({
      id: s.toLowerCase(),
      slug: s.toLowerCase(),
      name: s,
      order: i,
      visibility: 'visible',
      productCount: 1,
    })),
    seoTitle: 'Back to School',
    seoDescription: 'Back to School at Barkath',
    createdAt: now,
    updatedAt: now,
  });

  // Products
  for (const p of PRODUCTS) {
    const kw = [p.name.split(' ')[0]!.toLowerCase(), CAT_ID, p.sub.toLowerCase()];
    await db.doc(`products/${p.id}`).set({
      id: p.id,
      slug: p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      name: p.name,
      displayTitle: p.title,
      description: `${p.title}. A premium Barkath product.`,
      categoryId: CAT_ID,
      categorySlug: CAT_ID,
      categoryTint: TINT,
      subCategoryId: p.sub.toLowerCase(),
      subCategorySlug: p.sub.toLowerCase(),
      images: [p.image],
      videoUrl: null,
      mrpPaise: inr(p.mrp),
      offerPricePaise: inr(p.offer),
      discountPercent: Math.round(((p.mrp - p.offer) / p.mrp) * 100),
      hasVariants: false,
      variants: [],
      stock: 25,
      lowStockThreshold: 5,
      specifications: [{ id: 's1', key: 'Category', value: 'Back to School' }],
      fbt: [],
      combo: { enabled: false, deliveryChargePaise: 0, itemIds: [] },
      status: 'published',
      visibility: 'visible',
      isNewArrival: false,
      isBestSeller: false,
      isFeatured: false,
      isFlashSale: true,
      returnAvailable: true,
      codAvailable: true,
      isAffiliateEligible: true,
      affiliateCommissionRate: null,
      seoTitle: p.name,
      seoDescription: p.title,
      searchKeywords: kw,
      searchIndex: buildSearchIndex([p.name, p.title, ...kw]),
      // Review-derived rating: 1.0 / 0 baseline until real reviews arrive.
      rating: 1,
      ratingCount: 0,
      soldCount: 0,
      newArrivalOrder: null,
      bestSellerOrder: null,
      hsnCode: null,
      taxIncluded: true,
      createdBy: 'script',
      updatedBy: 'script',
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    console.log(`  ✔ ${p.name} (flash sale)`);
  }

  console.log('✔ Done.');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
