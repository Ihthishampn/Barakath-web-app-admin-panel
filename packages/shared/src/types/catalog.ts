import type { BaseDoc, ImageRef, SoftDeletable, Ts } from './common.js';
import type { ProductStatus, Visibility } from '../enums.js';

// ── Categories (tech-arch §1.3) ────────────────────────────────────
export interface SubCategory {
  id: string;
  slug: string;
  name: string;
  order: number;
  visibility: Visibility;
  productCount: number;
}

export interface Category extends BaseDoc {
  slug: string;
  name: string;
  displayName: string;
  description: string;
  /** Admin-picked raw hex (design-token exception, §1.0). */
  categoryTint: string;
  categoryTagColor: 'amber' | 'green' | 'blue' | 'gray';
  iconUrl: string | null;
  heroImageUrl: string | null;
  order: number;
  visibility: Visibility;
  productCount: number;
  subCategories: SubCategory[];
  seoTitle: string;
  seoDescription: string;
}

// ── Products (tech-arch §1.4) ──────────────────────────────────────
export interface ProductVariant {
  id: string;
  label: string;
  mrpPaise: number;
  offerPricePaise: number;
  stock: number;
  sku: string;
  referralPricePaise: number | null;
  commissionPaise: number | null;
  weight: number; // grams
  visibility: Visibility;
  /** IDs referencing settings/variables units (e.g. colorUnitId, sizeUnitId). */
  attributes?: Record<string, string>;
}

export interface ProductSpec {
  id: string;
  key: string;
  value: string;
}

export interface Product extends BaseDoc, SoftDeletable {
  slug: string;
  name: string;
  displayTitle: string;
  description: string;

  categoryId: string;
  categorySlug: string;
  categoryTint: string;
  subCategoryId: string;
  subCategorySlug: string;

  images: ImageRef[];
  videoUrl: string | null;

  mrpPaise: number;
  offerPricePaise: number;
  discountPercent: number;

  hasVariants: boolean;
  variants: ProductVariant[];
  /**
   * Referral (affiliate) display price for a variant-less product. Not
   * commission — see `commissionPaise` / `affiliateCommissionRate` below.
   */
  referralPricePaise?: number | null;
  /**
   * Product affiliate commission — the FIXED-AMOUNT option (per unit, ×qty at
   * checkout). Mutually exclusive with {@link affiliateCommissionRate}: exactly
   * one of the two is set per product, the other is null. `null` here means
   * "not the fixed-amount path" (0 is a real "pays nothing"). Applies to every
   * variant of the product.
   */
  commissionPaise?: number | null;
  stock: number; // used only when hasVariants=false
  lowStockThreshold: number;

  specifications: ProductSpec[];
  fbt: string[]; // frequently-bought-together product IDs

  combo: { enabled: boolean; deliveryChargePaise: number; itemIds: string[] };

  status: ProductStatus;
  visibility: Visibility;
  isNewArrival: boolean;
  isBestSeller: boolean;
  isFeatured: boolean;
  /** Opt-in flash sale flag (own status, off by default) — set per product in the admin. */
  isFlashSale?: boolean;
  returnAvailable: boolean; // was replacementAvailable
  codAvailable: boolean;

  isAffiliateEligible: boolean;
  /**
   * Product affiliate commission — the PERCENTAGE option (fraction; ×line total,
   * i.e. ×qty, at checkout). Mutually exclusive with {@link commissionPaise}:
   * exactly one of the two is set per product, the other is null.
   */
  affiliateCommissionRate: number | null;

  seoTitle: string;
  seoDescription: string;
  searchKeywords: string[];
  searchIndex: string[];

  /**
   * Average of this product's APPROVED review ratings (one decimal). DERIVED,
   * never entered: the `onReviewWritten` trigger
   * (functions/src/reviews/aggregate.ts) is the sole writer, and firestore.rules
   * locks the pair against client writes. A product with no reviews is the
   * baseline `rating: 1.0, ratingCount: 0`, shown as "1.0 ★ · 0 Reviews".
   */
  rating: number;
  /** Number of APPROVED reviews behind {@link rating}. 0 for a new product. */
  ratingCount: number;
  soldCount: number;

  newArrivalOrder: number | null;
  bestSellerOrder: number | null;

  hsnCode: string | null;
  taxIncluded: boolean;

  createdBy: string;
  updatedBy: string;
  publishedAt: Ts | null;
}
