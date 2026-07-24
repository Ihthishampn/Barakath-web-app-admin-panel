/**
 * Barkath — money helpers. The paise contract (tech-arch §8.5):
 * every stored money value is an integer number of paise; field names end in `Paise`.
 * Formatting happens only at the render boundary. Never floats in storage.
 */
import { LOCALE } from './enums.js';

const MINUS = '−'; // U+2212 minus sign

/** ₹XX.XX — 2 decimals. Precise commitment moments (totals, invoice, hero balances). */
export function formatMoney2dp(paise: number): string {
  return `₹${(paise / 100).toLocaleString(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** ₹X,XXX — integer rupees, Indian grouping. Overview counts, wallet breakdown cards. */
export function formatMoneyInt(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString(LOCALE)}`;
}

/** +₹X / −₹X (real minus sign). Signed ledger amounts. */
export function formatMoneySigned(
  paise: number,
  type: 'credit' | 'debit',
  decimals: 0 | 2 = 0,
): string {
  const sign = type === 'credit' ? '+' : MINUS;
  const abs = Math.abs(paise) / 100;
  const body = abs.toLocaleString(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${sign}₹${body}`;
}

/** Compact aggregates: ₹2.84 Cr, ₹48.2L, ₹1,472 (admin dashboards). */
export function formatMoneyCompact(paise: number): string {
  const rupees = paise / 100;
  const abs = Math.abs(rupees);
  if (abs >= 1e7) return `₹${(rupees / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(rupees / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `₹${(rupees / 1e3).toFixed(1)}K`;
  return `₹${Math.round(rupees).toLocaleString(LOCALE)}`;
}

export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);
export const paiseToRupees = (paise: number): number => paise / 100;

/** Discount %, rounded to nearest integer (tech-arch §8.5). */
export function discountPercent(mrpPaise: number, offerPaise: number): number {
  if (mrpPaise <= 0) return 0;
  return Math.round(((mrpPaise - offerPaise) / mrpPaise) * 100);
}

/** Inclusive-tax split: extract the tax portion from a tax-inclusive total. */
export function inclusiveTaxPaise(totalPaise: number, gstRatePercent: number): number {
  return Math.round(totalPaise - totalPaise / (1 + gstRatePercent / 100));
}
