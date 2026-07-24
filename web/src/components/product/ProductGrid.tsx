'use client';
import type { Product } from '@barkath/shared';
import { ProductCard } from './ProductCard';
import { cn } from '@/lib/cn';

/** Reusable responsive product grid with loading / empty / error states. */
export function ProductGrid({
  products,
  loading = false,
  error = false,
  emptyLabel = 'No products yet',
  cols = 4,
}: {
  products: Product[];
  loading?: boolean;
  error?: boolean;
  emptyLabel?: string;
  /** desktop column count (grid collapses on small screens) */
  cols?: 4 | 5;
}) {
  // Honour the prototype's fixed column counts (listing = 4, related/search = 5)
  // instead of auto-filling, so wide screens don't over-column.
  const gridCls = cn(
    'grid grid-cols-2 gap-5 sm:grid-cols-3',
    cols === 5 ? 'md:grid-cols-4 lg:grid-cols-5' : 'md:grid-cols-3 lg:grid-cols-4',
  );

  if (loading && products.length === 0) {
    return (
      <div className={gridCls}>
        {Array.from({ length: cols === 5 ? 5 : 8 }).map((_, i) => (
          <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-neutral-200" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid place-items-center rounded-2xl border border-dashed border-border-default bg-surface-card py-16 text-center font-ui text-sm text-text-tertiary">
        Couldn&apos;t load products. Please try again.
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="grid place-items-center rounded-2xl border border-dashed border-border-default bg-surface-card py-16 text-center font-ui text-sm text-text-tertiary">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className={gridCls}>
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
