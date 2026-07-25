/**
 * Single source of truth for the price ladder used anywhere connected money
 * fields appear (product variants, etc.). The tiers must satisfy:
 *
 *   Price  ≥  Offer  ≥  Referral
 *
 * (Affiliate commission is no longer part of the ladder — it is a separate
 * product-level amount OR percentage, validated on its own.)
 *
 * Each field is checked against the nearest higher tier that is actually set,
 * falling back up the ladder, so partially-filled rows still validate sensibly.
 * Keep every pricing screen calling this — do not re-inline the rules.
 */
export type PriceInput = number | '' | null | undefined;

export interface PriceLadder {
  price: PriceInput;
  offer: PriceInput;
  referral: PriceInput;
}

export type PriceField = keyof PriceLadder;
export type PriceErrors = Partial<Record<PriceField, string>>;

const num = (v: PriceInput): number | null =>
  v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v);

/** Returns a message per field that violates the ladder (empty object = valid). */
export function validatePriceLadder(r: PriceLadder): PriceErrors {
  const price = num(r.price);
  const offer = num(r.offer);
  const referral = num(r.referral);
  const errs: PriceErrors = {};

  if (price != null && price <= 0) errs.price = 'Price must be greater than ₹0.';

  if (offer != null && price != null && offer > price) {
    errs.offer = 'Offer can’t exceed Price.';
  }

  const refCeil = offer ?? price;
  if (referral != null && refCeil != null && referral > refCeil) {
    errs.referral = `Referral can’t exceed ${offer != null ? 'Offer' : 'Price'}.`;
  }

  return errs;
}

/** First human-readable ladder error across a set of rows, or null if all valid. */
export function firstLadderError(rows: PriceLadder[]): string | null {
  for (const r of rows) {
    const e = validatePriceLadder(r);
    const msg = e.price ?? e.offer ?? e.referral;
    if (msg) return msg;
  }
  return null;
}
