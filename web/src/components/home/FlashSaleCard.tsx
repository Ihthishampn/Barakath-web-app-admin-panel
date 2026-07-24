import Link from 'next/link';
import { formatMoney2dp, type Product } from '@barkath/shared';
import { discountPct, sellingPaise, hasDiscount } from '@/lib/catalog';

/**
 * Flash-sale card — mirrors the Figma home design. Deliberately simpler than
 * ProductCard: a taller 150px image carrying only the discount badge, then the
 * name and a sale/original price pair. No wishlist or add-to-bag affordance —
 * the design routes these straight through to the product page.
 */
export function FlashSaleCard({ product }: { product: Product }) {
  const img = product.images?.[0]?.url;
  const off = discountPct(product);

  return (
    <Link
      href={`/product/${product.id}`}
      className="group flex flex-col gap-[5px] rounded-[16px] border border-border bg-surface-card p-[13px] transition-shadow hover:shadow-md"
    >
      <div
        className="relative h-[150px] w-full overflow-hidden rounded-[12px]"
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
        {off > 0 && (
          <span className="absolute left-[8px] top-[8px] rounded-[6px] bg-error px-[8px] py-[4px] font-ui text-[11px] font-extrabold text-white">
            -{off}%
          </span>
        )}
      </div>

      <div className="line-clamp-1 font-ui text-[14px] font-semibold leading-[18.2px] text-text-primary">
        {product.name}
      </div>

      <div className="flex items-baseline gap-[8px]">
        <span className="font-display text-[16px] font-extrabold text-brand-gold-strong">
          {formatMoney2dp(sellingPaise(product))}
        </span>
        {hasDiscount(product) && (
          <span className="font-ui text-[12px] font-medium text-text-tertiary line-through">
            {formatMoney2dp(product.mrpPaise)}
          </span>
        )}
      </div>
    </Link>
  );
}
