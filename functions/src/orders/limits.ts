/**
 * Cart and order ceilings — SERVER-SIDE AUTHORITY.
 *
 * Nothing capped a cart or an order before this: a client (or a direct callable
 * invocation) could ask for 10,000 units of one product, or an order worth more
 * than the business could ever fulfil, and placeOrder would happily decrement
 * the stock and open a gateway order for it. Both storefronts mirror these
 * numbers so the customer is stopped early with the same wording, but the
 * mirrors are a courtesy — this file is the rule.
 *
 * Every message below is written to be shown to a customer VERBATIM: both
 * clients surface a `failed-precondition` HttpsError's message directly.
 */
import { HttpsError } from 'firebase-functions/v2/https';

/** Distinct product+variant lines a single order may contain. */
export const MAX_CART_LINES = 50;
/** Units of any ONE product+variant line. */
export const MAX_QTY_PER_LINE = 10;
/** Total units across the whole order. */
export const MAX_UNITS_PER_ORDER = 100;
/** Grand total ceiling, in paise (₹2,00,000). */
export const MAX_ORDER_TOTAL_PAISE = 20_000_000;

/** Formats a paise ceiling the way the storefronts print money. */
function inRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

export interface QuantityLine {
  productId: string;
  variantId?: string | null;
  qty: number;
}

/**
 * Enforce the LINE-shaped limits (count, per-line quantity, total units).
 *
 * Quantities are aggregated per product+variant first: a client is free to send
 * the same line twice, and checking each element in isolation let 20 units
 * through as two lines of 10. Called by placeOrder AND reserveStock — the
 * reservation takes real stock out of the catalogue before any money moves, so
 * an uncapped hold is an uncapped denial of stock to everyone else.
 *
 * The order-total ceiling is NOT checked here: reserveStock has no pricing, and
 * placeOrder can only know the total once the coupon has been re-asserted
 * against the locked documents. See assertOrderTotalLimit.
 */
export function assertCartLimits(lines: QuantityLine[]): void {
  const byLine = new Map<string, number>();
  let units = 0;
  for (const l of lines) {
    const qty = Number(l.qty ?? 0);
    if (qty <= 0) continue;
    const key = `${l.productId}#${l.variantId ?? ''}`;
    byLine.set(key, (byLine.get(key) ?? 0) + qty);
    units += qty;
  }

  if (byLine.size > MAX_CART_LINES) {
    throw new HttpsError(
      'failed-precondition',
      `You can order up to ${MAX_CART_LINES} different items at a time. Please remove a few and try again.`,
    );
  }
  for (const qty of byLine.values()) {
    if (qty > MAX_QTY_PER_LINE) {
      throw new HttpsError(
        'failed-precondition',
        `You can order up to ${MAX_QTY_PER_LINE} units of any one item. Please reduce the quantity and try again.`,
      );
    }
  }
  if (units > MAX_UNITS_PER_ORDER) {
    throw new HttpsError(
      'failed-precondition',
      `You can order up to ${MAX_UNITS_PER_ORDER} units in a single order. Please split it into smaller orders.`,
    );
  }
}

/** Enforce the order-value ceiling on the final, priced grand total. */
export function assertOrderTotalLimit(totalPaise: number): void {
  if (totalPaise > MAX_ORDER_TOTAL_PAISE) {
    throw new HttpsError(
      'failed-precondition',
      `Orders above ${inRupees(MAX_ORDER_TOTAL_PAISE)} cannot be placed online. Please split it into smaller orders or contact support.`,
    );
  }
}
