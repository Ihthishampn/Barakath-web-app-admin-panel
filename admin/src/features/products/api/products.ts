import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { buildSearchIndex, discountPercent, DEFAULT_PRODUCT_COMMISSION_RATE, type Product } from '@barkath/shared';
import { db, storage } from '@/lib/firebase';
import { deleteStorageFolder } from '@/lib/storage';
import { useLiveCollection } from '@/hooks/firestoreCache';

export const PRODUCTS_KEY = 'products:createdAt-desc';

/** All products (every status) for the admin list, newest first, real-time. */
export function useProductsList() {
  return useLiveCollection<Product>(PRODUCTS_KEY, () =>
    query(collection(db, 'products'), orderBy('createdAt', 'desc')),
  );
}

export function totalStock(p: Product): number {
  return p.hasVariants ? p.variants.reduce((n, v) => n + (v.stock ?? 0), 0) : (p.stock ?? 0);
}

export type ProductBadgeTone = 'success' | 'gold' | 'error' | 'neutral';

/** Derive the list status badge from product status + stock (prototype logic). */
export function deriveProductStatus(p: Product): { label: string; tone: ProductBadgeTone } {
  if (p.status === 'archived') return { label: 'Archived', tone: 'neutral' };
  if (p.status === 'draft') return { label: 'Draft', tone: 'neutral' };
  const stock = totalStock(p);
  if (stock === 0) return { label: 'Out of stock', tone: 'error' };
  if (stock <= (p.lowStockThreshold || 5)) return { label: 'Low stock', tone: 'gold' };
  return { label: 'Active', tone: 'success' };
}

export async function deleteProduct(id: string): Promise<void> {
  // A duplicate keeps the source's image URLs (the bytes are never re-uploaded),
  // so wiping `products/{id}` would 404 every copy's gallery. Check for copies
  // BEFORE the doc goes away — see duplicateProduct's `imagesFrom` stamp.
  const copies = await getDocs(query(collection(db, 'products'), where('imagesFrom', 'array-contains', id)));
  await deleteDoc(doc(db, 'products', id));
  // Also remove the product's uploaded images so they don't orphan in Storage.
  // Best-effort: a Storage failure must not undo the (already committed) doc
  // delete, and externally-hosted images (e.g. seeded URLs) have nothing here.
  if (copies.empty) await deleteStorageFolder(`products/${id}`);
}

export async function setProductArchived(id: string, archived: boolean): Promise<void> {
  const patch: Record<string, unknown> = {
    status: archived ? 'archived' : 'published',
    updatedAt: serverTimestamp(),
  };
  if (!archived) {
    // Restoring from archive puts the product back in front of shoppers, and the
    // storefronts derive "New arrivals" from publishedAt — so stamp it when the
    // product actually goes live, not whenever the doc was first created.
    const prev = await getProduct(id);
    if (needsPublishStamp(prev, 'published')) patch.publishedAt = serverTimestamp();
  }
  await updateDoc(doc(db, 'products', id), patch);
}

/**
 * True when this write moves the product into 'published' from something that
 * wasn't already live. web/src/lib/catalog.ts and the app both compute New
 * arrivals from `publishedAt ?? createdAt` within a short window, so the stamp
 * has to move on draft/archived → published. An edit to an already-published
 * product must NOT re-stamp (that would restart its New-arrivals window).
 */
function needsPublishStamp(prev: Product | null, next: Product['status']): boolean {
  if (next !== 'published') return false;
  return !(prev?.status === 'published' && prev.publishedAt != null);
}

export async function getProduct(id: string): Promise<Product | null> {
  const snap = await getDoc(doc(db, 'products', id));
  return snap.exists() ? (snap.data() as Product) : null;
}

/**
 * A product's `rating`/`ratingCount` are DERIVED, never entered here: they are
 * the mean and count of that product's APPROVED reviews, computed ONLY by the
 * onReviewWritten trigger (functions/src/reviews/aggregate.ts) and locked
 * against client writes in firestore.rules. A new product starts at the
 * baseline 1.0 / 0. This file therefore never sets the pair except to that
 * baseline on create — there is no admin-entered seed any more.
 */
const BASELINE_RATING = { rating: 1, ratingCount: 0 } as const;

/** Reserve a Firestore doc id for a new product (so images can upload pre-save). */
export function newProductId(): string {
  return doc(collection(db, 'products')).id;
}

export interface ProductFormValues {
  id: string;
  name: string;
  categoryId: string;
  categoryTint: string;
  subCategoryId: string;
  description: string;
  variants: Product['variants'];
  specifications: Product['specifications'];
  fbt: string[];
  images: Product['images'];
  mrpPaise: number;
  offerPricePaise: number;
  status: Product['status'];
  isBestSeller: boolean;
  isFeatured: boolean;
  isFlashSale: boolean;
  /** Referral (affiliate) display price for a variant-less product. */
  referralPricePaise: number | null;
  /**
   * Product affiliate commission — exactly one of these is set, the other null
   * (the form's Amount|Percent toggle decides). Applies to every variant.
   * `commissionPaise` = fixed amount per unit; `affiliateCommissionRate` =
   * percentage as a fraction.
   */
  commissionPaise: number | null;
  affiliateCommissionRate: number | null;
  /**
   * HSN code printed on the GST invoice for every line of this product.
   * `null` = inherit `settings/tax.hsnCodes[categorySlug]`, which is exactly
   * what functions/src/orders/invoice.ts falls back to
   * (`it.hsnCode ?? hsnCodes[category] ?? ''`). It used to be hardcoded null
   * here with no field anywhere to set it, so the fallback was the only source
   * — and that map had no editor either, which is why every invoice printed an
   * empty HSN column.
   */
  hsnCode: string | null;
}

/**
 * Create or update a product. Computes discountPercent + searchIndex client-side
 * (the onProductWrite trigger also does this in prod; here the functions emulator
 * may be off, so we keep search working regardless).
 */
export async function saveProduct(values: ProductFormValues, isNew: boolean): Promise<string> {
  const hasVariants = values.variants.length > 0;
  const searchKeywords = [values.name.split(' ')[0]?.toLowerCase() ?? '', values.categoryId];
  const base = {
    name: values.name,
    displayTitle: values.name,
    slug: values.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    description: values.description,
    categoryId: values.categoryId,
    categorySlug: values.categoryId,
    categoryTint: values.categoryTint,
    subCategoryId: values.subCategoryId,
    subCategorySlug: values.subCategoryId,
    images: values.images,
    mrpPaise: values.mrpPaise,
    offerPricePaise: values.offerPricePaise,
    discountPercent: discountPercent(values.mrpPaise, values.offerPricePaise),
    hasVariants,
    variants: values.variants,
    // Referral display price is variant-less-only (a variant carries its own).
    referralPricePaise: hasVariants ? null : values.referralPricePaise,
    // Affiliate commission is a PRODUCT-level setting now — a fixed amount OR a
    // percentage, mutually exclusive (the form nulls whichever isn't chosen),
    // applied to every variant. Written on both create and edit.
    commissionPaise: values.commissionPaise,
    affiliateCommissionRate: values.affiliateCommissionRate,
    specifications: values.specifications,
    fbt: values.fbt,
    searchKeywords,
    searchIndex: buildSearchIndex([values.name, ...searchKeywords]),
    status: values.status,
    // Merchandising flags → drive the storefront's Best sellers / Featured rails.
    // (New arrivals is automatic — derived from the publish date in the
    // storefront — so there's no isNewArrival flag to set here.)
    isBestSeller: values.isBestSeller,
    isFeatured: values.isFeatured,
    // Flash sale — opt-in per product (its own status, not derived from price).
    isFlashSale: values.isFlashSale,
    // Written on EVERY save (create and edit), so an existing product can be
    // given a code without being recreated. Blank normalises to null, which is
    // the "inherit the category code" signal the invoice already understands.
    hsnCode: values.hsnCode?.trim() || null,
    updatedBy: 'admin',
    updatedAt: serverTimestamp(),
  };

  if (isNew) {
    await setDoc(doc(db, 'products', values.id), {
      id: values.id,
      ...base,
      // Rating is review-derived and starts at the 1.0 / 0 baseline. Only the
      // onReviewWritten trigger may move it from here (firestore.rules locks the
      // pair against client writes; the rules also require exactly this on create).
      ...BASELINE_RATING,
      // Stamped when first flagged; the storefront rail sorts on it ascending.
      bestSellerOrder: values.isBestSeller ? Date.now() : null,
      // New arrivals is derived from publishedAt in the storefront; keep the
      // schema fields present (false/null) for back-compat with old readers.
      isNewArrival: false,
      newArrivalOrder: null,
      videoUrl: null,
      stock: 0,
      lowStockThreshold: 5,
      combo: { enabled: false, deliveryChargePaise: 0, itemIds: [] },
      visibility: 'visible',
      returnAvailable: true,
      codAvailable: true,
      isAffiliateEligible: true,
      seoTitle: values.name,
      seoDescription: values.name,
      soldCount: 0,
      taxIncluded: true,
      createdBy: 'admin',
      // Only a product that goes live now has a publish date — a draft gets its
      // stamp when it is actually published (see needsPublishStamp).
      publishedAt: values.status === 'published' ? serverTimestamp() : null,
      createdAt: serverTimestamp(),
      deletedAt: null,
    });
  } else {
    // Read the stored doc so the derived fields below are computed from what is
    // in Firestore rather than from (possibly stale) form state — inside a
    // transaction, so a write that lands between the read and the update can't
    // slip past the merge below.
    const ref = doc(db, 'products', values.id);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const prev = snap.exists() ? (snap.data() as Product) : null;
      const stored = prev?.variants ?? [];
      // An edit never touches `rating`/`ratingCount` — they are review-derived
      // and locked against client writes (firestore.rules); `base` deliberately
      // omits them, so the stored pair carries through untouched.
      // Adding the first variant flips hasVariants, and every reader (storefront,
      // inventory, the list badge) stops looking at the top-level `stock` from
      // then on — carry it onto the first new variant instead of orphaning real
      // inventory, and clear the field it just left.
      const converting = stored.length === 0 && values.variants.length > 0;
      const variants = values.variants.map((v, i) => {
        const was = stored.find((x) => x.id === v.id);
        // The form only holds the stock it saw when it opened; Inventory
        // adjustments, orders and cancellations move it meanwhile. Re-attach
        // what is actually stored — same reason the rating aggregate above is
        // only written when the admin edited it.
        if (was) return { ...v, stock: was.stock ?? 0 };
        if (converting && i === 0) return { ...v, stock: prev?.stock ?? 0 };
        return v;
      });
      tx.update(ref, {
        ...base,
        variants,
        ...(converting ? { stock: 0 } : {}),
        // The Best sellers rail is ordered by bestSellerOrder ASC, so re-stamping
        // on every save would reshuffle it on unrelated edits — stamp off→on only.
        bestSellerOrder: values.isBestSeller ? (prev?.bestSellerOrder ?? Date.now()) : null,
        ...(needsPublishStamp(prev, values.status) ? { publishedAt: serverTimestamp() } : {}),
      });
    });
  }
  return values.id;
}

export async function uploadProductImage(productId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'png';
  const path = `products/${productId}/gallery-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: file.type || 'image/png' });
  return getDownloadURL(r);
}

/**
 * Duplicate a product into a new draft doc. Copies every field, appends
 * “(Copy)” to the name, resets sales-derived counters + publish state, and
 * gives it a fresh id/slug so nothing collides with the original.
 */
export async function duplicateProduct(id: string): Promise<string> {
  const src = await getProduct(id);
  if (!src) throw new Error('Product not found');
  const newId = newProductId();
  const name = `${src.name} (Copy)`;
  const searchKeywords = [name.split(' ')[0]?.toLowerCase() ?? '', src.categoryId];
  const { id: _oldId, ...rest } = src;
  // Old source docs may still carry the retired manual-seed provenance fields;
  // never copy them onto a fresh product (the onReviewWritten trigger owns the
  // rating now, and a leftover seed reads as fabricated data).
  for (const k of ['seedRating', 'seedRatingCount', 'reviewRatingSum', 'reviewRatingCount']) {
    delete (rest as Record<string, unknown>)[k];
  }
  await setDoc(doc(db, 'products', newId), {
    ...rest,
    id: newId,
    name,
    // Stock is physical, not copyable — carrying it over would let the copy sell
    // units that only exist once. The copy starts empty; Inventory owns it.
    stock: 0,
    variants: (src.variants ?? []).map((v) => ({ ...v, stock: 0 })),
    // The images still point at the source's Storage objects (the bytes are not
    // re-uploaded), so record the folders this copy depends on — deleteProduct
    // refuses to wipe a folder that a copy is still reading from.
    imagesFrom: imageFolderIds(src.images ?? []),
    displayTitle: name,
    slug: `${src.slug || slugifyName(src.name)}-copy-${newId.slice(0, 5).toLowerCase()}`,
    status: 'draft',
    searchKeywords,
    searchIndex: buildSearchIndex([name, ...searchKeywords]),
    // A copy has no reviews of its own → the 1.0 / 0 baseline every new product
    // starts at (the create rule requires exactly this).
    ...BASELINE_RATING,
    soldCount: 0,
    newArrivalOrder: null,
    bestSellerOrder: null,
    isNewArrival: false,
    isBestSeller: false,
    isFeatured: false,
    createdBy: 'admin',
    updatedBy: 'admin',
    publishedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    deletedAt: null,
  });
  return newId;
}

/**
 * Product ids whose Storage folder a set of images lives in. uploadProductImage
 * puts everything under `products/{productId}/…`, which survives into the
 * download URL (percent-encoded), so a copy's dependence on someone else's
 * folder is readable straight off the URL — including copies of copies.
 */
function imageFolderIds(images: Product['images']): string[] {
  const ids = new Set<string>();
  for (const im of images) {
    const m = /products(?:%2F|\/)([^%/?]+)(?:%2F|\/)/i.exec(im.url ?? '');
    if (m?.[1]) ids.add(m[1]);
  }
  return [...ids];
}

function slugifyName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export interface ImportRow {
  name: string;
  categorySlug: string;
  categoryTint: string;
  subCategorySlug: string;
  pricePaise: number;
  offerPricePaise: number;
  stock: number;
  description: string;
}

export interface ImportError {
  line: number;
  message: string;
}

/**
 * Create many simple (non-variant) products from parsed CSV rows in batched
 * writes (≤400/commit). Admin is a rules-gated writer, so this is a direct
 * client batch — no Cloud Function needed (tech-arch §6.0).
 */
export async function importProducts(rows: ImportRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  for (let i = 0; i < rows.length; i += 400) {
    const batch = writeBatch(db);
    for (const row of rows.slice(i, i + 400)) {
      const id = newProductId();
      const searchKeywords = [row.name.split(' ')[0]?.toLowerCase() ?? '', row.categorySlug];
      batch.set(doc(db, 'products', id), {
        id,
        name: row.name,
        displayTitle: row.name,
        slug: `${slugifyName(row.name)}-${id.slice(0, 5).toLowerCase()}`,
        description: row.description,
        categoryId: row.categorySlug,
        categorySlug: row.categorySlug,
        categoryTint: row.categoryTint,
        subCategoryId: row.subCategorySlug,
        subCategorySlug: row.subCategorySlug,
        images: [],
        videoUrl: null,
        mrpPaise: row.pricePaise,
        offerPricePaise: row.offerPricePaise,
        discountPercent: discountPercent(row.pricePaise, row.offerPricePaise),
        hasVariants: false,
        variants: [],
        specifications: [],
        fbt: [],
        combo: { enabled: false, deliveryChargePaise: 0, itemIds: [] },
        searchKeywords,
        searchIndex: buildSearchIndex([row.name, ...searchKeywords]),
        status: 'draft',
        visibility: 'visible',
        stock: row.stock,
        lowStockThreshold: 5,
        isNewArrival: false,
        isBestSeller: false,
        isFeatured: false,
        returnAvailable: true,
        codAvailable: true,
        isAffiliateEligible: true,
        // Imported products get the default commission percentage so the
        // affiliate system works out of the box (admins can change per product).
        commissionPaise: null,
        affiliateCommissionRate: DEFAULT_PRODUCT_COMMISSION_RATE,
        seoTitle: row.name,
        seoDescription: row.name,
        // Rating is review-derived; an imported product starts at the 1.0 / 0
        // baseline like any other (the create rule requires exactly this).
        ...BASELINE_RATING,
        soldCount: 0,
        newArrivalOrder: null,
        bestSellerOrder: null,
        hsnCode: null,
        taxIncluded: true,
        createdBy: 'admin',
        updatedBy: 'admin',
        publishedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        deletedAt: null,
      });
    }
    await batch.commit();
  }
  return rows.length;
}
