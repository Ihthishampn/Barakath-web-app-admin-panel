/**
 * Server-side catalogue reads for metadata, JSON-LD and the sitemap.
 *
 * `generateMetadata` runs on the server, before any client component has
 * mounted, so it cannot use the client Firebase SDK in `lib/firebase.ts` (that
 * module is a browser singleton and its reads would never be cached by Next).
 * Products and categories are public — `firestore.rules` allows an
 * unauthenticated read of both — so this reads them straight off the Firestore
 * REST API with the same public web API key the browser uses. Every request
 * goes through `fetch` with a revalidate window, so Next's data cache serves
 * repeat crawls without touching Firestore.
 *
 * NOTHING in this file is imported by a client component.
 */

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '';
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '';
const REST = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/**
 * Public origin used for canonical URLs, Open Graph and the sitemap.
 *
 * Falls back to the origin both clients already share for referral links
 * (`REFERRAL_SHARE_BASE` in lib/affiliate.ts). Set NEXT_PUBLIC_SITE_URL to
 * override it per environment.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://barakath.com').replace(/\/$/, '');

/** How long a metadata read may be served from Next's data cache. */
const REVALIDATE_SECONDS = 300;

// ── Firestore REST value decoding ──────────────────────────────────────────
interface FsValue {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
  arrayValue?: { values?: FsValue[] };
  mapValue?: { fields?: Record<string, FsValue> };
}

interface FsDoc {
  name?: string;
  fields?: Record<string, FsValue>;
}

function decodeValue(v: FsValue): unknown {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.arrayValue !== undefined) return (v.arrayValue.values ?? []).map(decodeValue);
  if (v.mapValue !== undefined) return decodeFields(v.mapValue.fields);
  return null;
}

function decodeFields(fields?: Record<string, FsValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = decodeValue(v);
  return out;
}

/** Document id from a REST resource name. */
const idOf = (name?: string): string => (name ?? '').split('/').pop() ?? '';

async function restGet(path: string, params: Record<string, string | string[]> = {}): Promise<unknown | null> {
  if (!PROJECT_ID || !API_KEY) return null;
  const qs = new URLSearchParams({ key: API_KEY });
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((one) => qs.append(k, one));
    else qs.append(k, v);
  }
  try {
    const res = await fetch(`${REST}/${path}?${qs}`, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    // Metadata must never take a page down: a failed read falls back to the
    // site defaults.
    return null;
  }
}

// ── Shapes this file needs (a deliberate subset of the shared types) ───────
export interface SeoImage {
  url?: string;
  alt?: string;
  isPrimary?: boolean;
  order?: number;
}

export interface SeoProduct {
  id: string;
  name: string;
  displayTitle: string;
  description: string;
  slug: string;
  seoTitle: string;
  seoDescription: string;
  status: string;
  visibility: string;
  categorySlug: string;
  images: SeoImage[];
  mrpPaise: number;
  offerPricePaise: number;
  stock: number;
  hasVariants: boolean;
  variants: { stock?: number }[];
  rating: number;
  ratingCount: number;
  updatedAt?: string;
}

export interface SeoCategory {
  id: string;
  slug: string;
  name: string;
  displayName: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
  visibility: string;
  heroImageUrl: string | null;
  iconUrl: string | null;
  updatedAt?: string;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);

function toProduct(doc: FsDoc): SeoProduct {
  const f = decodeFields(doc.fields);
  return {
    id: str(f.id) || idOf(doc.name),
    name: str(f.name),
    displayTitle: str(f.displayTitle),
    description: str(f.description),
    slug: str(f.slug),
    seoTitle: str(f.seoTitle),
    seoDescription: str(f.seoDescription),
    status: str(f.status),
    visibility: str(f.visibility),
    categorySlug: str(f.categorySlug),
    images: Array.isArray(f.images) ? (f.images as SeoImage[]) : [],
    mrpPaise: num(f.mrpPaise),
    offerPricePaise: num(f.offerPricePaise),
    stock: num(f.stock),
    hasVariants: f.hasVariants === true,
    variants: Array.isArray(f.variants) ? (f.variants as { stock?: number }[]) : [],
    rating: num(f.rating),
    ratingCount: num(f.ratingCount),
    updatedAt: str(f.updatedAt) || undefined,
  };
}

function toCategory(doc: FsDoc): SeoCategory {
  const f = decodeFields(doc.fields);
  return {
    id: str(f.id) || idOf(doc.name),
    slug: str(f.slug) || idOf(doc.name),
    name: str(f.name),
    displayName: str(f.displayName),
    description: str(f.description),
    seoTitle: str(f.seoTitle),
    seoDescription: str(f.seoDescription),
    visibility: str(f.visibility),
    heroImageUrl: str(f.heroImageUrl) || null,
    iconUrl: str(f.iconUrl) || null,
    updatedAt: str(f.updatedAt) || undefined,
  };
}

/** One product by document id, or null when it is missing or not on sale. */
export async function getProductForSeo(id: string): Promise<SeoProduct | null> {
  const doc = (await restGet(`products/${encodeURIComponent(id)}`)) as FsDoc | null;
  if (!doc?.fields) return null;
  const p = toProduct(doc);
  if (p.status !== 'published' || p.visibility === 'hidden') return null;
  return p;
}

/**
 * One category by slug. Categories are keyed by their slug in production, so
 * try the direct read first and fall back to a scan of the (small) collection
 * for any that are not.
 */
export async function getCategoryForSeo(slug: string): Promise<SeoCategory | null> {
  const direct = (await restGet(`categories/${encodeURIComponent(slug)}`)) as FsDoc | null;
  if (direct?.fields) {
    const c = toCategory(direct);
    if (c.slug === slug && c.visibility !== 'hidden') return c;
  }
  const all = await listCategoriesForSeo();
  return all.find((c) => c.slug === slug) ?? null;
}

/** Every visible category (small collection — one page is always enough). */
export async function listCategoriesForSeo(): Promise<SeoCategory[]> {
  const res = (await restGet('categories', { pageSize: '300' })) as { documents?: FsDoc[] } | null;
  return (res?.documents ?? []).map(toCategory).filter((c) => c.visibility !== 'hidden');
}

/**
 * Every published product, paged through in full.
 *
 * Used only by the sitemap, and bounded so a runaway catalogue cannot make the
 * route hang. The REST list endpoint has no `where`, so drafts are filtered
 * after the read.
 */
export async function listProductsForSeo(max = 5000): Promise<SeoProduct[]> {
  const out: SeoProduct[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = (await restGet('products', {
      pageSize: '300',
      ...(pageToken ? { pageToken } : {}),
    })) as { documents?: FsDoc[]; nextPageToken?: string } | null;
    if (!res) break;
    for (const doc of res.documents ?? []) {
      const p = toProduct(doc);
      if (p.status === 'published' && p.visibility !== 'hidden') out.push(p);
    }
    pageToken = res.nextPageToken;
    if (!pageToken || out.length >= max) break;
  }
  return out.slice(0, max);
}

// ── Presentation helpers ───────────────────────────────────────────────────
/** Collapse whitespace and cut to a length search engines actually render. */
export function clampDescription(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).replace(/[\s,.;:—-]+$/, '')}…`;
}

/** Primary image URL for a product, if it has one. */
export function primaryImage(p: SeoProduct): string | null {
  const imgs = (p.images ?? []).filter((i) => !!i?.url);
  if (imgs.length === 0) return null;
  const primary = imgs.find((i) => i.isPrimary) ?? [...imgs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
  return primary?.url ?? null;
}

/** Selling price in paise — offer falls back to MRP (mirrors lib/catalog). */
export function seoSellingPaise(p: SeoProduct): number {
  return p.offerPricePaise || p.mrpPaise;
}

/** Anything sellable right now (mirrors components/catalog/stock.ts). */
export function seoInStock(p: SeoProduct): boolean {
  if (p.hasVariants) return (p.variants ?? []).some((v) => Number(v?.stock ?? 0) > 0);
  return p.stock > 0;
}
