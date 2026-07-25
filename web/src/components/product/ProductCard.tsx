'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RiStarFill, RiHeartLine, RiHeartFill } from '@remixicon/react';
import { toast } from 'sonner';
import { formatMoney2dp, type Product } from '@barkath/shared';
import { sellingPaise } from '@/lib/catalog';
import { useIsWishlisted, toggleWishlist } from '@/lib/wishlist';
import { inStock } from '@/components/catalog/stock';

/**
 * Product card — mirrors the Figma home design (New arrivals / Best sellers).
 *
 * Layout: 128px tinted image with an uppercase category chip (top-left) and a
 * wishlist heart (top-right); then name, subtitle, and a bottom row pairing
 * price + rating against a square add-to-bag button.
 *
 * The card is a link, so the heart and add buttons preventDefault +
 * stopPropagation — otherwise tapping them would navigate to the product page.
 */
export function ProductCard({ product }: { product: Product }) {
  const img = product.images?.[0]?.url;
  const router = useRouter();
  const { wishlisted, signedIn } = useIsWishlisted(product.id);
  // Drives the "Out of stock" chip on the image — the card carries no add
  // control now, but it still shows availability.
  const sellable = inStock(product);

  const onHeart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!signedIn) {
      router.push('/signin');
      return;
    }
    // toggleWishlist writes Firestore and can reject (offline, denied). Left
    // unhandled it was an uncaught promise rejection and the heart simply did
    // nothing, with no way for the customer to tell it had failed.
    try {
      const result = await toggleWishlist(product);
      if (result === 'added') toast.success('Added to wishlist');
      else if (result === 'removed') toast.success('Removed from wishlist');
    } catch {
      toast.error("Couldn't update your wishlist. Please try again.");
    }
  };

  return (
    <Link
      href={`/product/${product.id}`}
      className="group flex flex-col gap-[9px] rounded-[12px] border border-border bg-surface-card p-[11px] shadow-[0px_2px_4px_0px_rgba(27,28,29,0.04),0px_1px_2px_0px_rgba(95,74,46,0.04)] transition-shadow hover:shadow-md"
    >
      {/* Image */}
      <div
        className="relative h-[128px] w-full overflow-hidden rounded-[8px]"
        style={{ background: product.categoryTint || '#efeeea' }}
      >
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        )}
        {/* The top-left chip carries the category normally and the sold-out
            state when there is one — same chip, in the error-subtle/error pair
            the storefront already uses for "out of stock" (the stock bar on the
            product details screen). */}
        {!sellable ? (
          <span className="absolute left-[8px] top-[8px] rounded-pill bg-error-subtle px-[8px] py-[4px] font-ui text-[10px] font-extrabold uppercase tracking-[0.3px] text-error">
            Out of stock
          </span>
        ) : (
          product.categorySlug && (
            <span
              className="absolute left-[8px] top-[8px] rounded-pill bg-white/90 px-[8px] py-[4px] font-ui text-[10px] font-extrabold uppercase tracking-[0.3px]"
              style={{ color: chipColor(product.categorySlug) }}
            >
              {product.categorySlug}
            </span>
          )
        )}
        <button
          onClick={onHeart}
          aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
          className="absolute right-[7px] top-[7px] grid h-[30px] w-[30px] place-items-center rounded-pill bg-white/90 transition-colors hover:bg-white"
        >
          {wishlisted ? (
            <RiHeartFill size={16} className="text-error" />
          ) : (
            <RiHeartLine size={16} className="text-text-secondary" />
          )}
        </button>
      </div>

      {/* Name + subtitle */}
      <div className="flex flex-col gap-[2px]">
        <div className="line-clamp-1 font-ui text-[14px] font-bold leading-[17.5px] text-text-primary">
          {product.name}
        </div>
        <div className="line-clamp-1 font-ui text-[12px] font-normal text-text-secondary">
          {subtitleOf(product)}
        </div>
      </div>

      {/* Price + rating vs add button */}
      {/* No add-to-bag control on the card — adding happens on the product
          page. The card just shows price + rating. */}
      <div className="mt-auto flex min-w-0 flex-col gap-[3px]">
        <span className="font-display text-[16px] font-extrabold text-brand-gold-strong">
          {formatMoney2dp(sellingPaise(product))}
        </span>
        {/* Rating is always shown — review-derived, 1.0 ★ · 0 reviews baseline. */}
        <span className="flex items-center gap-[3px] font-ui text-[11px] font-bold text-text-secondary">
          <RiStarFill size={11} className="text-brand-gold" />
          {product.rating.toFixed(1)}
          <span className="font-medium text-text-tertiary">
            ({product.ratingCount})
          </span>
        </span>
      </div>
    </Link>
  );
}

/**
 * The design alternates the chip between brand green and gold. Derive it from
 * the category slug so a given category always reads the same across rails —
 * an index-based alternation would flip the same product between sections.
 */
function chipColor(slug: string): string {
  const sum = [...slug].reduce((a, c) => a + c.charCodeAt(0), 0);
  return sum % 2 === 0 ? 'var(--brand-primary)' : 'var(--brand-gold-strong)';
}

/** Design shows a short spec line, e.g. "100ml · Body mist". */
function subtitleOf(p: Product): string {
  const variant = p.variants?.[0]?.label;
  return [variant, p.subCategorySlug].filter(Boolean).join(' · ') || p.categorySlug || '';
}
