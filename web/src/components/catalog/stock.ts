import type { Product, ProductVariant } from '@barkath/shared';

/**
 * Availability helpers shared by the surfaces that must agree about what is
 * sellable: the listing's "In stock" filter, the product card's quick-add and
 * the bag. They are deliberately in one place — the three used to disagree,
 * which let a card add a sold-out variant that only failed at reserveStock.
 *
 * Mirrors the Flutter app (app/lib/features/catalog/data/product.dart and
 * app/lib/features/checkout/data/checkout_repository.dart).
 */

/**
 * Is anything of this product sellable right now? A variant product's
 * top-level `stock` is not the figure the server checks — reserveStock resolves
 * stock per variant — so a variant product is in stock when ANY variant has
 * units left.
 */
export function inStock(p: Product): boolean {
  if (p.hasVariants) return p.variants.some((v) => v.stock > 0);
  return p.stock > 0;
}

/**
 * The first variant a quick-add may use. A variant product MUST go into the bag
 * with a variantId (placeOrder resolves stock per variant, so a variant-less
 * line for such a product is always rejected), and `variants[0]` can perfectly
 * well be the sold-out one — which is exactly how a dead bag line was created.
 * Undefined for a product without variants, and for one whose variants are all
 * sold out (the caller has already blocked the add by then).
 */
export function firstInStockVariant(p: Product): ProductVariant | undefined {
  if (!p.hasVariants) return undefined;
  return p.variants.find((v) => v.stock > 0);
}

/**
 * Units a bag line can still be sold, resolved from the live product doc.
 * Copied term-for-term from the server's own check in
 * functions/src/orders/reservations.ts (a product that is missing or not
 * 'published' is rejected; a variant line resolves `variants[].stock`, a plain
 * line the top-level `stock`), plus the hidden-visibility case the storefront
 * queries already exclude. `undefined` means the doc is gone — zero units.
 */
export function lineStock(p: Product | undefined, variantId: string | null): number {
  if (!p || p.status !== 'published' || p.visibility === 'hidden') return 0;
  if (variantId) {
    const v = p.variants?.find((x) => x.id === variantId);
    return v ? Number(v.stock ?? 0) : 0;
  }
  return Number(p.stock ?? 0);
}
