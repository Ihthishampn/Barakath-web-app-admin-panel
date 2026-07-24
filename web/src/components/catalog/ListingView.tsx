'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { RiArrowDownSLine, RiCheckLine, RiFilterLine, RiSearchEyeLine, RiStarLine } from '@remixicon/react';
import { formatMoneyInt, type Category } from '@barkath/shared';
import { usePublishedCatalog, useCategories, sellingPaise, hasDiscount } from '@/lib/catalog';
import { ProductGrid } from '@/components/product/ProductGrid';
import { Pagination } from './Pagination';
import { inStock } from './stock';
import { cn } from '@/lib/cn';

type SortKey = 'popularity' | 'price_asc' | 'price_desc' | 'rating' | 'newest';
type StockFilter = 'all' | 'in_stock' | 'on_sale';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'popularity', label: 'Popularity' },
  { key: 'price_asc', label: 'Price: Low to High' },
  { key: 'price_desc', label: 'Price: High to Low' },
  { key: 'rating', label: 'Rating' },
  { key: 'newest', label: 'Newest' },
];

const PAGE_SIZE = 12;

/** Price slider granularity: ₹1 in paise. Fine enough to feel continuous, coarse
 *  enough that a keyboard arrow key actually moves the handle. */
const PRICE_STEP = 100;

/**
 * The catalogue listing screen. Renders every published product with a filter
 * sidebar, quick chips, sort and pagination. When `categorySlug` is given the
 * set is pre-filtered to that category (the /c/[slug] route).
 */
export function ListingView({ categorySlug }: { categorySlug?: string }) {
  // Cursor-paged over the WHOLE published catalogue (no 200-product ceiling),
  // and scoped server-side when a category is being viewed so the page reads
  // only the products it can actually show.
  const { data: allProducts, loading, error } = usePublishedCatalog(categorySlug ?? null);
  const { data: categories, loading: catLoading } = useCategories();

  const category: Category | undefined = useMemo(
    () => categories.find((c) => c.slug === categorySlug),
    [categories, categorySlug],
  );

  // A /c/<slug> that names no category at all — an old link, a typo, or a
  // category that has since been removed or hidden.
  const unknownCategory = !!categorySlug && !catLoading && !category;

  // Already scoped by the query when a category is active.
  const scoped = allProducts;

  // Sidebar "Category" facet: subcategories inside a category, else top categories.
  const facets = useMemo(() => {
    if (category) {
      return category.subCategories
        .filter((s) => s.visibility === 'visible')
        .map((s) => ({ slug: s.slug, name: s.name, count: scoped.filter((p) => p.subCategorySlug === s.slug).length }))
        .filter((f) => f.count > 0);
    }
    return categories
      .map((c) => ({ slug: c.slug, name: c.name, count: allProducts.filter((p) => p.categorySlug === c.slug).length }))
      .filter((f) => f.count > 0);
  }, [category, categories, scoped, allProducts]);

  const [picked, setPicked] = useState<string[]>([]);
  const [minRating, setMinRating] = useState<number>(0);
  const [stock, setStock] = useState<StockFilter>('all');
  const [sort, setSort] = useState<SortKey>('popularity');
  const [sortOpen, setSortOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [mobileFilters, setMobileFilters] = useState(false);

  const priceBounds = useMemo(() => {
    if (scoped.length === 0) return { min: 0, max: 0 };
    const prices = scoped.map(sellingPaise);
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [scoped]);

  // Slider domain, in paise. Snapped outwards to whole rupees so the ₹1 step
  // grid lines up with both ends — an input whose max is off-grid can never be
  // dragged to its real maximum, which would silently drop the priciest product.
  const sliderMin = Math.floor(priceBounds.min / PRICE_STEP) * PRICE_STEP;
  const sliderMaxRaw = Math.ceil(priceBounds.max / PRICE_STEP) * PRICE_STEP;
  // Degenerate set (one product, or every price identical) collapses the domain
  // to a point: a range input with min === max has a dead thumb and every
  // percentage below would divide by zero. Widen by one step — the filter still
  // admits everything, and the labels clamp back to the real bounds.
  const sliderMax = sliderMaxRaw > sliderMin ? sliderMaxRaw : sliderMin + PRICE_STEP;

  const [range, setRange] = useState<[number, number]>([0, 0]);
  // Bounds the selection was last aligned to. Switching category/sub-category
  // swaps the whole data set, and a range carried over from the old one can sit
  // entirely outside the new bounds — which would hide every product with no
  // visible cause. Re-sync during render (not in an effect) so `filtered` below
  // never commits a pass computed from a stale range.
  const [syncedTo, setSyncedTo] = useState<[number, number]>([0, 0]);
  if (syncedTo[0] !== sliderMin || syncedTo[1] !== sliderMax) {
    setSyncedTo([sliderMin, sliderMax]);
    setRange([sliderMin, sliderMax]);
  }

  // Handle positions as a share of the domain. The widening above guarantees a
  // non-zero span, but the divide stays guarded so no future tweak to the domain
  // can hand the fill a NaN width.
  const span = sliderMax - sliderMin;
  const loPct = span > 0 ? (range[0] - sliderMin) / span : 0;
  const hiPct = span > 0 ? (range[1] - sliderMin) / span : 1;

  const filtered = useMemo(() => {
    let list = scoped.slice();
    if (picked.length > 0) {
      const facetKey = category ? 'subCategorySlug' : 'categorySlug';
      list = list.filter((p) => picked.includes(p[facetKey as 'subCategorySlug' | 'categorySlug']));
    }
    if (minRating > 0) list = list.filter((p) => p.rating >= minRating);
    if (stock === 'in_stock') list = list.filter(inStock);
    if (stock === 'on_sale') list = list.filter(hasDiscount);
    // Price range — compare against sellingPaise so the filter matches the price
    // printed on the card (offer price when there is one, else MRP).
    list = list.filter((p) => {
      const price = sellingPaise(p);
      return price >= range[0] && price <= range[1];
    });

    switch (sort) {
      case 'price_asc':
        list.sort((a, b) => sellingPaise(a) - sellingPaise(b));
        break;
      case 'price_desc':
        list.sort((a, b) => sellingPaise(b) - sellingPaise(a));
        break;
      case 'rating':
        list.sort((a, b) => b.rating - a.rating);
        break;
      case 'newest':
        list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        break;
      default:
        list.sort((a, b) => (b.soldCount ?? 0) - (a.soldCount ?? 0));
    }
    return list;
  }, [scoped, picked, minRating, stock, sort, category, range]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  const heading = category ? category.name : categorySlug ? cap(categorySlug) : 'All products';
  const resetPage = () => setPage(1);

  function toggle(slug: string) {
    setPicked((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug]));
    resetPage();
  }

  // The two thumbs share one track, so each clamps against the other rather than
  // crossing over (dragging min past max just parks it on max, and vice versa).
  function setLowPrice(paise: number) {
    setRange(([, hi]) => [Math.min(paise, hi), hi]);
    resetPage();
  }
  function setHighPrice(paise: number) {
    setRange(([lo]) => [lo, Math.max(paise, lo)]);
    resetPage();
  }

  // Unknown category: show a real not-found instead of the full listing chrome
  // headed "<Slug> · 0 products", which read like a real but empty aisle.
  if (unknownCategory) return <CategoryNotFound slug={categorySlug!} categories={categories} />;

  return (
    <div className="mx-auto max-w-page px-4 sm:px-10">
      {/* breadcrumb + heading */}
      <div className="pb-2 pt-6">
        <div className="mb-2.5 font-ui text-[13px] font-medium text-text-tertiary">
          <Link href="/" className="hover:text-text-secondary">Home</Link> ·{' '}
          <span className="font-bold text-text-primary">{heading}</span>
        </div>
        <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.02em] text-text-primary">
          {heading}{' '}
          <span className="font-ui text-[15px] font-medium text-text-tertiary">
            · {filtered.length} product{filtered.length === 1 ? '' : 's'}
          </span>
        </h1>
      </div>

      <div className="flex flex-col gap-8 pb-12 pt-6 lg:flex-row">
        {/* mobile filter toggle */}
        <button
          type="button"
          onClick={() => setMobileFilters((v) => !v)}
          className="inline-flex w-fit items-center gap-2 rounded-pill border border-border-default px-4 py-2.5 font-ui text-[13px] font-bold text-text-primary lg:hidden"
        >
          <RiFilterLine size={16} /> Filters
        </button>

        {/* filter sidebar */}
        <aside
          className={cn(
            'w-full flex-none flex-col gap-6 lg:flex lg:w-[250px]',
            mobileFilters ? 'flex' : 'hidden',
          )}
        >
          {/* Category / sub-category facet */}
          <div className="rounded-lg border border-border-subtle bg-surface-card p-5">
            <div className="mb-4 font-display text-[15px] font-extrabold text-text-primary">Category</div>
            {facets.length === 0 ? (
              <div className="font-ui text-[13px] text-text-tertiary">No filters available.</div>
            ) : (
              <div className="flex flex-col gap-3">
                {facets.map((f) => {
                  const on = picked.includes(f.slug);
                  return (
                    <label key={f.slug} className="flex cursor-pointer items-center gap-2.5 font-ui text-[14px] font-medium text-text-secondary">
                      <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(f.slug)} />
                      <span
                        className={cn(
                          'inline-flex h-[18px] w-[18px] items-center justify-center rounded-[5px]',
                          on ? 'bg-brand-primary text-white' : 'border-[1.5px] border-border-default',
                        )}
                      >
                        {on && <RiCheckLine size={12} />}
                      </span>
                      {f.name} <span className="text-text-tertiary">({f.count})</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Price range — two native range inputs overlaid on the track (see
              .bk-range in globals.css); the fill below tracks the two thumbs. */}
          <div className="rounded-lg border border-border-subtle bg-surface-card p-5">
            <div className="mb-4 font-display text-[15px] font-extrabold text-text-primary">Price range</div>
            <div className="relative mx-1 my-3.5 h-[5px] rounded-pill bg-neutral-200">
              {/* Offsets are measured in thumb-centre space: a native thumb never
                  overhangs the input, so its centre travels 8px…(100% − 8px). */}
              <div
                className="absolute inset-y-0 rounded-pill bg-brand-primary"
                style={{
                  left: `calc((100% - 16px) * ${loPct} + 8px)`,
                  right: `calc((100% - 16px) * ${1 - hiPct} + 8px)`,
                }}
              />
              <input
                type="range"
                aria-label="Minimum price"
                min={sliderMin}
                max={sliderMax}
                step={PRICE_STEP}
                value={range[0]}
                onChange={(e) => setLowPrice(Number(e.target.value))}
                className="bk-range absolute inset-x-0 top-1/2 m-0 h-4 w-full -translate-y-1/2"
              />
              <input
                type="range"
                aria-label="Maximum price"
                min={sliderMin}
                max={sliderMax}
                step={PRICE_STEP}
                value={range[1]}
                onChange={(e) => setHighPrice(Number(e.target.value))}
                className="bk-range absolute inset-x-0 top-1/2 m-0 h-4 w-full -translate-y-1/2"
              />
            </div>
            {/* Selected values, clamped back into the real data bounds so the
                rupee-rounded (and, when degenerate, widened) domain can never
                print a price no product actually has. */}
            <div className="mt-2 flex justify-between font-ui text-[12px] font-semibold text-text-secondary">
              <span>{formatMoneyInt(Math.max(range[0], priceBounds.min))}</span>
              <span>{formatMoneyInt(Math.min(range[1], priceBounds.max))}</span>
            </div>
          </div>

          {/* Rating */}
          <div className="rounded-lg border border-border-subtle bg-surface-card p-5">
            <div className="mb-4 font-display text-[15px] font-extrabold text-text-primary">Rating</div>
            <div className="flex flex-col gap-3">
              {[4.5, 4.0].map((r) => {
                const on = minRating === r;
                return (
                  <label key={r} className="flex cursor-pointer items-center gap-2.5 font-ui text-[14px] font-medium text-text-secondary">
                    <input
                      type="radio"
                      name="rating"
                      className="sr-only"
                      checked={on}
                      onChange={() => {
                        setMinRating(on ? 0 : r);
                        resetPage();
                      }}
                    />
                    <span
                      className={cn(
                        'inline-flex h-[18px] w-[18px] items-center justify-center rounded-full',
                        on ? 'border-[5px] border-brand-primary' : 'border-[1.5px] border-border-default',
                      )}
                    />
                    <RiStarLine size={14} className="text-brand-gold" />
                    {r.toFixed(1)} &amp; up
                  </label>
                );
              })}
            </div>
          </div>
        </aside>

        {/* grid + sort */}
        <div className="min-w-0 flex-1">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex gap-2">
              {([
                ['all', 'All'],
                ['in_stock', 'In stock'],
                ['on_sale', 'On sale'],
              ] as [StockFilter, string][]).map(([key, label]) => {
                const on = stock === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setStock(key);
                      resetPage();
                    }}
                    className={cn(
                      'rounded-pill px-4 py-1.5 font-ui text-[13px] font-bold transition-colors',
                      on
                        ? 'bg-brand-primary text-white'
                        : 'border border-border-default text-text-secondary hover:bg-neutral-200',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* sort */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setSortOpen((v) => !v)}
                className="flex items-center gap-2 rounded-pill border border-border-default px-4 py-2.5 font-ui text-[13px] font-bold text-text-primary"
              >
                Sort: {SORTS.find((s) => s.key === sort)!.label}
                <RiArrowDownSLine size={16} className="text-text-tertiary" />
              </button>
              {sortOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                  <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-lg border border-border-subtle bg-surface-card py-1 shadow-lg">
                    {SORTS.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => {
                          setSort(s.key);
                          setSortOpen(false);
                          resetPage();
                        }}
                        className={cn(
                          'block w-full px-4 py-2.5 text-left font-ui text-[13px] transition-colors hover:bg-neutral-200',
                          s.key === sort ? 'font-bold text-brand-primary' : 'text-text-secondary',
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <ProductGrid
            products={pageItems}
            loading={loading}
            error={error}
            emptyLabel={
              scoped.length === 0 ? 'No products yet' : 'No products match these filters.'
            }
            cols={4}
          />

          <Pagination page={clampedPage} total={totalPages} onChange={setPage} />
        </div>
      </div>
    </div>
  );
}

/**
 * `/c/<unknown-slug>`. Uses the same dashed empty-state card the grid and the
 * home rails use, plus the categories that DO exist so the dead end is also a
 * way back in.
 */
function CategoryNotFound({ slug, categories }: { slug: string; categories: Category[] }) {
  return (
    <div className="mx-auto max-w-page px-4 sm:px-10">
      <div className="pb-2 pt-6">
        <div className="mb-2.5 font-ui text-[13px] font-medium text-text-tertiary">
          <Link href="/" className="hover:text-text-secondary">Home</Link> ·{' '}
          <Link href="/categories" className="hover:text-text-secondary">Categories</Link> ·{' '}
          <span className="font-bold text-text-primary">{cap(slug)}</span>
        </div>
        <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.02em] text-text-primary">
          Category not found
        </h1>
      </div>

      <div className="pb-12 pt-6">
        <div className="grid place-items-center rounded-2xl border border-dashed border-border-default bg-surface-card px-6 py-16 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-surface-app text-text-tertiary">
            <RiSearchEyeLine size={26} />
          </span>
          <p className="mt-4 font-display text-lg font-extrabold text-text-primary">
            We don&apos;t have a “{cap(slug)}” section
          </p>
          <p className="mt-1.5 max-w-sm font-ui text-sm text-text-secondary">
            This link may be out of date. Browse everything we sell, or pick a category below.
          </p>
          <Link
            href="/listing"
            className="mt-6 inline-flex h-11 items-center rounded-pill bg-brand-primary px-6 font-ui text-sm font-bold text-white hover:bg-brand-primary-dark"
          >
            Shop all products
          </Link>
          {categories.length > 0 && (
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {categories.map((c) => (
                <Link
                  key={c.id}
                  href={`/c/${c.slug}`}
                  className="rounded-pill border border-border-default px-4 py-1.5 font-ui text-[13px] font-bold text-text-secondary transition-colors hover:bg-neutral-200"
                >
                  {c.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function cap(s: string): string {
  const t = s.replace(/[-_]/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
