'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import {
  RiAddLine,
  RiSubtractLine,
  RiHeartLine,
  RiHeartFill,
  RiStarLine,
  RiInformationLine,
  RiArrowLeftLine,
  RiSearchLine,
} from '@remixicon/react';
import {
  formatMoney2dp,
  discountPercent,
  type Product,
  type ProductVariant,
  type SettingsDelivery,
} from '@barkath/shared';
import { db } from '@/lib/firebase';
import { addToCartError, useCart } from '@/lib/cart';
import { useAuth } from '@/lib/auth';
import { useCategories, useCategoryProducts, useProductsByIds } from '@/lib/catalog';
import { usePaginatedReviews, REVIEW_PREVIEW_COUNT } from '@/lib/reviews';
import { useDeliverySettings } from '@/lib/siteSettings';
import { useIsWishlisted, toggleWishlist } from '@/lib/wishlist';
import { Button } from '@/components/ui/Button';
import { ProductGrid } from '@/components/product/ProductGrid';
import { useMyProductReviews } from '@/components/reviews/ReviewForm';
import { PublicReviewCard, OwnReviewCard } from '@/components/reviews/ReviewCards';
import { lineStock } from '@/components/catalog/stock';
import { cn } from '@/lib/cn';

interface FetchState {
  product: Product | null;
  loading: boolean;
  error: boolean;
}

function useProduct(id: string): FetchState {
  const [state, setState] = useState<FetchState>({ product: null, loading: true, error: false });
  useEffect(() => {
    let alive = true;
    setState({ product: null, loading: true, error: false });
    getDoc(doc(db, 'products', id))
      .then((snap) => {
        if (!alive) return;
        if (snap.exists()) setState({ product: snap.data() as Product, loading: false, error: false });
        else setState({ product: null, loading: false, error: false });
      })
      .catch(() => alive && setState({ product: null, loading: false, error: true }));
    return () => {
      alive = false;
    };
  }, [id]);
  return state;
}

export function ProductDetail({ id }: { id: string }) {
  const { product, loading, error } = useProduct(id);

  if (loading) return <DetailSkeleton />;
  if (error) return <DetailMessage title="Something went wrong" body="We couldn't load this product. Please try again." />;
  if (!product || product.status !== 'published') {
    return <DetailMessage title="Product not found" body="This product may be unavailable or no longer sold." />;
  }
  return <DetailBody product={product} />;
}

function DetailBody({ product }: { product: Product }) {
  const router = useRouter();
  const { wishlisted, signedIn } = useIsWishlisted(product.id);
  const [wishBusy, setWishBusy] = useState(false);
  // The signed-in customer decides whether the affiliate strip is shown at all —
  // referral/commission figures are seller economics, not shopper copy.
  const customer = useAuth((s) => s.customer);
  const { data: delivery } = useDeliverySettings();
  // Breadcrumb shows the category's admin-set NAME; the slug is only the fallback
  // for a product whose category doc has since been removed/hidden.
  const { data: categories } = useCategories();
  const categoryName =
    categories.find((c) => c.slug === product.categorySlug)?.name || cap(product.categorySlug);

  async function onToggleWishlist() {
    if (wishBusy) return;
    setWishBusy(true);
    try {
      const res = await toggleWishlist(product);
      if (res === 'unauthed') {
        toast.message('Sign in to save items to your wishlist.');
        router.push('/signin');
      } else if (res === 'added') {
        toast.success('Saved to your wishlist');
      } else {
        toast.message('Removed from your wishlist');
      }
    } catch {
      toast.error("Couldn't update your wishlist. Please try again.");
    } finally {
      setWishBusy(false);
    }
  }

  const add = useCart((s) => s.add);
  const cartLines = useCart((s) => s.lines);
  const variants = product.hasVariants ? product.variants.filter((v) => v.visibility === 'visible') : [];
  const [variantId, setVariantId] = useState<string | null>(variants[0]?.id ?? null);
  const [qty, setQty] = useState(1);
  const [activeImg, setActiveImg] = useState(0);
  // Cursor position over the hero, in %, driving the hover-zoom the design's
  // pill advertises. Null while the pointer is away, so the image sits at
  // `cover` and nothing shifts on a touch device that never hovers.
  const [zoomAt, setZoomAt] = useState<{ x: number; y: number } | null>(null);

  const variant: ProductVariant | undefined = variants.find((v) => v.id === variantId) ?? variants[0];

  const mrpPaise = variant ? variant.mrpPaise : product.mrpPaise;
  const offerPaise = variant ? variant.offerPricePaise : product.offerPricePaise;
  const pricePaise = offerPaise > 0 && offerPaise < mrpPaise ? offerPaise : mrpPaise;
  const discounted = pricePaise < mrpPaise;
  const off = discounted ? discountPercent(mrpPaise, pricePaise) : 0;

  // Availability comes from the shared helper the bag and the listing use, so
  // this page can never call sellable something reserveStock would reject. A
  // variant product with no visible variant has nothing to sell at all.
  const stock = product.hasVariants && !variant ? 0 : lineStock(product, variant?.id ?? null);
  const outOfStock = stock <= 0;

  // `add` ADDS to whatever this line already holds, so the stepper has to be
  // capped at what is still un-bagged — not at the raw stock. Without this, a
  // customer with 5 of a 6-stock item in their bag could add another 5 and only
  // discover it on the bag screen, where the line reads "Only 6 left" and
  // checkout is blocked with no hint of which add caused it.
  const inBagQty = cartLines
    .filter((l) => l.productId === product.id && l.variantId === (variant?.id ?? null))
    .reduce((n, l) => n + l.qty, 0);
  const addableQty = Math.max(0, stock - inBagQty);
  /** Nothing left to add, but the product itself is not out of stock. */
  const allInBag = !outOfStock && addableQty === 0;
  /** The SELECTED variant is in the bag → the CTA becomes a remove toggle. */
  const inBag = inBagQty > 0;

  // Affiliate economics resolve variant-first then product-level, mirroring the
  // commission accrual order documented on Product.referralPricePaise.
  const referralPaise = variant?.referralPricePaise ?? product.referralPricePaise ?? null;
  const commissionPaise = variant?.commissionPaise ?? product.commissionPaise ?? null;
  // Show earnings only to a customer who is actually an enrolled affiliate — an
  // ordinary shopper must never see the referral price or the per-sale cut.
  const showAffiliate =
    customer?.affiliate?.enabled === true && product.isAffiliateEligible && referralPaise != null;

  const images = product.images?.length
    ? [...product.images].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.order - b.order)
    : [];
  const heroUrl = images[activeImg]?.url ?? images[0]?.url;

  /**
   * The CTA adds on the first press, then becomes a shortcut to the Bag — it
   * does NOT remove. "In bag" keys on the SELECTED variant, so each variant
   * shows its own Add / Go-to-bag state. Matches the product card and the app.
   */
  function handleCartCta() {
    if (inBag) {
      router.push('/bag');
      return;
    }
    handleAdd();
  }

  function handleAdd() {
    if (outOfStock) return;
    if (allInBag) {
      toast.message('Your bag already holds every unit we have of this.');
      return;
    }
    // The stepper is capped at `addableQty`, but the bag is shared live with the
    // Flutter app and other tabs — so re-clamp at the moment of the add rather
    // than trusting a ceiling that may have moved under us.
    const units = Math.min(qty, addableQty);
    // Bag/order caps, mirrored from the server. Stock is capped above; whichever
    // ceiling is lower is the one that bites.
    const limit = addToCartError(cartLines, product.id, variant?.id ?? null, units);
    if (limit) {
      toast.error(limit);
      return;
    }
    add(
      {
        productId: product.id,
        variantId: variant?.id ?? null,
        name: product.displayTitle || product.name,
        variantLabel: variant?.label ?? null,
        imageUrl: heroUrl ?? null,
        categoryTint: product.categoryTint || '#e6cfb4',
        categorySlug: product.categorySlug || null,
        pricePaise,
        mrpPaise,
      },
      units,
    );
    toast.success('Added to bag', {
      description: `${product.displayTitle || product.name}${variant ? ` · ${variant.label}` : ''} × ${units}`,
    });
  }

  return (
    <div className="mx-auto max-w-page px-4 sm:px-10">
      {/* breadcrumb — Home · Category · Product name */}
      <div className="flex items-center gap-3 pb-2 pt-5 font-ui text-[13px] font-medium text-text-tertiary">
        <Link href={`/c/${product.categorySlug}`} className="inline-flex items-center gap-1 hover:text-text-secondary lg:hidden">
          <RiArrowLeftLine size={15} /> Back
        </Link>
        <span className="hidden lg:inline">
          <Link href="/" className="hover:text-text-secondary">Home</Link> ·{' '}
          <Link href={`/c/${product.categorySlug}`} className="hover:text-text-secondary">{categoryName}</Link> ·{' '}
          <span className="font-bold text-text-primary">{product.name}</span>
        </span>
      </div>

      <div className="flex flex-col gap-8 pb-10 pt-6 lg:flex-row lg:gap-12">
        {/* gallery — vertical thumbnail rail + hero */}
        <div className="flex w-full gap-4 lg:w-[560px] lg:flex-none">
          <div className="flex flex-col gap-3">
            {(images.length ? images : [null]).slice(0, 4).map((im, i) => {
              const on = i === activeImg;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveImg(i)}
                  aria-label={im?.alt || `View image ${i + 1}`}
                  aria-pressed={on}
                  className={cn(
                    // The design gives the selected thumb a slightly larger, ringed
                    // box and dims the rest — hence two sizes rather than a border swap.
                    // bg-neutral-200 only shows through for a product with no
                    // tint and no image — never a raw placeholder colour.
                    'flex-none overflow-hidden rounded-xl bg-neutral-200 bg-cover bg-center transition',
                    on
                      ? 'h-[80px] w-[80px] border-2 border-brand-primary'
                      : 'h-[76px] w-[76px] opacity-70 hover:opacity-100',
                  )}
                  style={{
                    backgroundColor: product.categoryTint || undefined,
                    backgroundImage: im?.url ? `url(${im.url})` : undefined,
                  }}
                />
              );
            })}
          </div>
          <div
            className="relative aspect-square flex-1 overflow-hidden rounded-lg border border-border bg-neutral-200 bg-center lg:aspect-auto lg:h-[522px]"
            onMouseMove={(e) => {
              // Zoom origin follows the pointer so the magnified region is the one
              // under the cursor, which is what "Hover to zoom" promises.
              const r = e.currentTarget.getBoundingClientRect();
              setZoomAt({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
            }}
            onMouseLeave={() => setZoomAt(null)}
            style={{
              backgroundColor: product.categoryTint || undefined,
              backgroundImage: heroUrl ? `url(${heroUrl})` : undefined,
              // Only zoom when there is an image to zoom into; the tint-only
              // placeholder would just scale a flat colour.
              backgroundSize: zoomAt && heroUrl ? '200%' : 'cover',
              backgroundPosition: zoomAt && heroUrl ? `${zoomAt.x}% ${zoomAt.y}%` : 'center',
              transition: 'background-size 150ms ease-out',
            }}
          >
            {/* Admin's own "best seller" flag — no client-side guessing. */}
            {product.isBestSeller && (
              <span className="absolute left-4 top-4 rounded-pill bg-brand-gold-subtle px-[13px] py-1.5 font-ui text-[13px] font-bold text-brand-gold-strong">
                Best seller
              </span>
            )}
            {/* Pointer-only affordance: hidden where there is no hover to give. */}
            {heroUrl && (
              <span className="pointer-events-none absolute bottom-4 right-4 hidden items-center gap-1.5 rounded-pill bg-white/90 px-3 py-2 font-ui text-[12px] font-semibold text-text-secondary lg:inline-flex">
                <RiSearchLine size={14} /> Hover to zoom
              </span>
            )}
          </div>
        </div>

        {/* info column */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {product.ratingCount > 0 && (
            <div className="inline-flex items-center gap-1 font-ui text-[13px] font-bold text-text-secondary">
              <RiStarLine size={15} className="text-brand-gold" />
              {product.rating.toFixed(1)} · {product.ratingCount} review{product.ratingCount === 1 ? '' : 's'}
            </div>
          )}

          <h1 className="font-display text-[28px] font-extrabold leading-[1.1] tracking-[-0.02em] text-text-primary sm:text-[34px]">
            {product.displayTitle || product.name}
          </h1>

          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-display text-[32px] font-extrabold leading-none text-brand-gold-strong">
              {formatMoney2dp(pricePaise)}
            </span>
            {discounted && (
              <span className="font-ui text-[18px] font-medium leading-none text-text-tertiary line-through">
                {formatMoney2dp(mrpPaise)}
              </span>
            )}
            {off > 0 && <span className="font-ui text-[13px] font-bold text-success">{off}% off</span>}
          </div>

          {showAffiliate && (
            <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-brand-gold-border bg-brand-gold-subtle px-[17px] py-[13px]">
              <span className="flex-none rounded-[5px] bg-brand-gold-strong px-[7px] py-1 font-ui text-[9px] font-extrabold tracking-[0.06em] text-white">
                AFFILIATE
              </span>
              <span className="font-ui text-[13px] font-semibold leading-[1.4] text-brand-gold-strong">
                Referral price <b className="font-extrabold">{formatMoney2dp(referralPaise!)}</b>
                {commissionPaise != null && (
                  <> · you earn <b className="font-extrabold">{formatMoney2dp(commissionPaise)}</b> per sale</>
                )}
              </span>
            </div>
          )}

          {/* stock strip — truthful for the SELECTED variant */}
          <div
            className={cn(
              'flex items-start gap-2.5 rounded-sm px-[14px] py-3 font-ui text-[13px] leading-[1.45]',
              outOfStock ? 'bg-error-subtle text-error' : 'bg-success-subtle text-text-secondary',
            )}
          >
            <RiInformationLine size={18} className={cn('mt-px flex-none', !outOfStock && 'text-success')} />
            <span>{outOfStock ? 'Currently out of stock' : inStockLine(delivery)}</span>
          </div>

          {/* variants */}
          {variants.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <div className="font-ui text-[13px] font-bold text-text-primary">Size</div>
              <div className="flex flex-wrap gap-2.5">
                {variants.map((v) => {
                  const on = v.id === variant?.id;
                  const soldOut = v.stock <= 0;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      disabled={soldOut}
                      onClick={() => {
                        setVariantId(v.id);
                        setQty(1);
                      }}
                      className={cn(
                        // Selected chip carries a 2px ring, so its padding is 1px
                        // tighter to keep every chip the same height.
                        'rounded-[10px] font-ui text-[13px] font-bold transition-colors',
                        on
                          ? 'border-2 border-brand-primary bg-brand-primary-subtle px-5 py-3 text-brand-primary'
                          : 'border border-border px-[19px] py-[11px] text-text-secondary hover:border-brand-primary',
                        soldOut && 'cursor-not-allowed text-text-tertiary line-through opacity-60 hover:border-border',
                      )}
                    >
                      {v.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* qty + add to bag + wishlist */}
          <div className="mt-0.5 flex items-center gap-3">
            <div className="inline-flex flex-none items-center rounded-[10px] border border-border">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="grid h-12 w-11 place-items-center text-text-primary disabled:opacity-40"
                disabled={qty <= 1}
              >
                <RiSubtractLine size={18} />
              </button>
              <span className="w-9 text-center font-ui text-[16px] font-bold">{qty}</span>
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQty((q) => (addableQty > 0 ? Math.min(addableQty, q + 1) : q + 1))}
                className="grid h-12 w-11 place-items-center text-text-primary disabled:opacity-40"
                disabled={addableQty > 0 && qty >= addableQty}
              >
                <RiAddLine size={18} />
              </button>
            </div>
            <Button
              theme="primary"
              size="l"
              onClick={handleCartCta}
              // Out of stock blocks an ADD, but once it is in the bag the button
              // is a Go-to-bag shortcut and must stay tappable.
              disabled={outOfStock && !inBag}
              // Design's CTA is a 50px soft rectangle matching the stepper, not
              // the pill the Button defaults to. min-w-0 + tighter padding on
              // phones let it shrink beside the stepper instead of pushing the
              // row (and the page) into a horizontal scroll.
              className="h-[50px] min-w-0 flex-1 rounded-sm px-3 text-[16px] font-semibold sm:px-6"
            >
              {inBag
                ? 'Go to bag'
                : outOfStock
                  ? 'Out of stock'
                  : `Add to bag · ${formatMoney2dp(pricePaise * qty)}`}
            </Button>
            <button
              type="button"
              onClick={onToggleWishlist}
              disabled={wishBusy}
              aria-pressed={wishlisted}
              aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
              className={cn(
                'grid h-[54px] w-[54px] flex-none place-items-center rounded-xl border transition-colors disabled:opacity-60',
                wishlisted && signedIn
                  ? 'border-error bg-error-subtle text-error'
                  : 'border-border text-error hover:bg-error-subtle',
              )}
            >
              {wishlisted && signedIn ? <RiHeartFill size={22} /> : <RiHeartLine size={22} />}
            </button>
          </div>

          {product.description && (
            <p className="mt-3 font-ui text-[15px] leading-6 text-text-secondary">{product.description}</p>
          )}
        </div>
      </div>

      {/* related — the design places "You may also like" directly under the fold */}
      <RelatedProducts categorySlug={product.categorySlug} excludeId={product.id} />

      {/* specifications */}
      {product.specifications?.length > 0 && (
        <section className="pb-4">
          <h2 className="mb-4 font-display text-[22px] font-extrabold tracking-[-0.02em] text-text-primary">Specifications</h2>
          <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-card">
            {product.specifications.map((s, i) => (
              <div
                key={s.id || i}
                className={cn('flex gap-4 px-5 py-3.5 font-ui text-[14px]', i % 2 === 1 && 'bg-surface-app')}
              >
                <span className="w-40 flex-none font-semibold text-text-secondary">{s.key}</span>
                <span className="text-text-primary">{s.value}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* frequently bought together */}
      <FrequentlyBought ids={product.fbt} excludeId={product.id} />

      {/* reviews */}
      <ReviewsSection productId={product.id} rating={product.rating} ratingCount={product.ratingCount} />
    </div>
  );
}

function FrequentlyBought({ ids, excludeId }: { ids: string[]; excludeId: string }) {
  // Fetched by id rather than found inside a 200-product pool, so an
  // FBT pick outside that arbitrary slice no longer silently disappears.
  const wanted = useMemo(() => (ids ?? []).filter((id) => id !== excludeId), [ids, excludeId]);
  const { data: items, loading } = useProductsByIds(wanted);
  if (!ids?.length) return null;
  if (!loading && items.length === 0) return null;
  return (
    <section className="pb-4 pt-4">
      <h2 className="mb-5 font-display text-[24px] font-extrabold tracking-[-0.02em] text-text-primary">Frequently bought together</h2>
      <ProductGrid products={items} loading={loading} cols={5} emptyLabel="—" />
    </section>
  );
}

function RelatedProducts({ categorySlug, excludeId }: { categorySlug: string; excludeId: string }) {
  // Scoped to the category server-side (two equality clauses, no composite
  // index) instead of filtering a truncated catalogue dump, then ranked by
  // what actually sells.
  const { data: pool, loading } = useCategoryProducts(categorySlug, 24);
  const items = useMemo(
    () =>
      pool
        .filter((p) => p.id !== excludeId)
        .sort((a, b) => (b.soldCount ?? 0) - (a.soldCount ?? 0))
        .slice(0, 5),
    [pool, excludeId],
  );
  if (!loading && items.length === 0) return null;
  return (
    <section className="pb-12 pt-2">
      <h2 className="mb-5 font-display text-[24px] font-extrabold tracking-[-0.02em] text-text-primary">You may also like</h2>
      <ProductGrid products={items} loading={loading} cols={5} emptyLabel="—" />
    </section>
  );
}

/**
 * Reviews on the product page are READ-ONLY. A review may only be written for a
 * product the customer has actually received, so the entry point lives on the
 * delivered order (account/orders/[id]) — offering it here would just produce
 * writes the security rules reject.
 */
function ReviewsSection({ productId, rating, ratingCount }: { productId: string; rating: number; ratingCount: number }) {
  const customer = useAuth((s) => s.customer);
  // Preview only: the first few approved reviews via a cursor-paged query, so
  // the product page never pulls the whole review set. The full, incrementally
  // paginated list lives on the dedicated /product/[id]/reviews page.
  const { reviews, loading, hasMore } = usePaginatedReviews(productId, REVIEW_PREVIEW_COUNT);

  // The signed-in customer's OWN reviews for this product — ANY status, so one
  // submitted from an order is visible to its author here immediately (with a
  // "pending approval" badge) instead of vanishing until an admin approves it.
  const { data: myReviews } = useMyProductReviews(productId, customer?.uid);

  // Don't render the author's own review twice once it's approved and appears
  // in the public list.
  const myIds = new Set(myReviews.map((r) => r.id));
  const othersApproved = reviews.filter((r) => !myIds.has(r.id));
  // More approved reviews exist than this preview shows.
  const seeAll = hasMore || othersApproved.length >= REVIEW_PREVIEW_COUNT;

  return (
    <section className="border-t border-border-subtle py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-[24px] font-extrabold tracking-[-0.02em] text-text-primary">Reviews</h2>
          {ratingCount > 0 && (
            <span className="inline-flex items-center gap-1 font-ui text-[14px] font-bold text-text-secondary">
              <RiStarLine size={15} className="text-brand-gold" />
              {rating.toFixed(1)} · {ratingCount} rating{ratingCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {seeAll && (
          <Link
            href={`/product/${productId}/reviews`}
            className="flex-none font-ui text-[14px] font-bold text-brand-primary hover:underline"
          >
            See all
          </Link>
        )}
      </div>

      {/* The author's own reviews first, each with a status badge, so a review
          is visible the instant it's submitted (pending) rather than only after
          admin approval. */}
      {myReviews.length > 0 && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          {myReviews.map((r) => (
            <OwnReviewCard key={r.id} review={r} />
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-neutral-200" />
          ))}
        </div>
      ) : othersApproved.length === 0 ? (
        myReviews.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border-default bg-surface-card py-14 text-center font-ui text-sm text-text-tertiary">
            {/* No "be the first" invitation: this page can't take a review —
                only a customer with a delivered order can, from that order. */}
            No reviews yet. Reviews come from customers who have received this product.
          </div>
        ) : null
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {othersApproved.slice(0, REVIEW_PREVIEW_COUNT).map((r) => (
            <PublicReviewCard key={r.id} review={r} />
          ))}
        </div>
      )}
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-page px-4 pt-8 sm:px-10">
      <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
        <div className="h-[520px] w-full animate-pulse rounded-2xl bg-neutral-200 lg:w-[560px]" />
        <div className="flex-1 space-y-4">
          <div className="h-5 w-32 animate-pulse rounded bg-neutral-200" />
          <div className="h-10 w-3/4 animate-pulse rounded bg-neutral-200" />
          <div className="h-8 w-40 animate-pulse rounded bg-neutral-200" />
          <div className="h-11 w-full animate-pulse rounded bg-neutral-200" />
          <div className="h-[52px] w-full animate-pulse rounded bg-neutral-200" />
        </div>
      </div>
    </div>
  );
}

function DetailMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto grid max-w-page place-items-center px-4 py-24 text-center sm:px-10">
      <div className="max-w-md">
        <h1 className="font-display text-[24px] font-extrabold text-text-primary">{title}</h1>
        <p className="mt-2 font-ui text-[15px] text-text-secondary">{body}</p>
        <Link href="/listing" className="mt-6 inline-block">
          <Button theme="primary" size="m">Browse products</Button>
        </Link>
      </div>
    </div>
  );
}

/**
 * Stock-strip copy. The design reads "In stock · dispatched within 24 hours",
 * but nothing in the data models a dispatch SLA — so the clause becomes the
 * delivery window the admin actually configured in settings/delivery (the same
 * doc checkout quotes "Arrives by" from). No delivery doc, no promise.
 */
function inStockLine(delivery: SettingsDelivery | null): string {
  const min = Number(delivery?.deliveryDaysMin ?? 0);
  const max = Number(delivery?.deliveryDaysMax ?? 0);
  const lo = min > 0 ? min : max;
  const hi = max > 0 ? max : min;
  if (lo <= 0) return 'In stock';
  const range = lo === hi ? `${lo} day${lo === 1 ? '' : 's'}` : `${lo}–${hi} days`;
  return `In stock · delivered in ${range}`;
}

function cap(s: string | undefined): string {
  if (!s) return '';
  const t = s.replace(/[-_]/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
