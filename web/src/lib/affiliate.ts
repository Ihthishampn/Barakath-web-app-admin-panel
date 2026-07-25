import type { SettingsAffiliate } from '@barkath/shared';

/**
 * Base URL every shared referral link is built on — `{base}/r/{CODE}`, served
 * by src/app/r/[code]/page.tsx.
 *
 * ONE constant, so the day the real domain is decided it changes here and
 * nowhere else. The value is the domain both clients already shipped
 * (`https://barakath.com/r/{CODE}`, hard-coded in three places before this) —
 * deliberately NOT a new one; the Flutter app is aligning to the same string.
 */
export const REFERRAL_SHARE_BASE = 'https://barakath.com';

/** The link a customer shares. Codes are upper-case and URL-safe already. */
export function referralShareLink(code: string): string {
  return `${REFERRAL_SHARE_BASE}/r/${encodeURIComponent(code)}`;
}

/** Same link without its scheme — for the compact sidebar display. */
export function referralShareLinkShort(code: string): string {
  return referralShareLink(code).replace(/^https?:\/\//, '');
}

/**
 * A code captured from `/r/{CODE}`, carried across to whichever screen ends up
 * asking for it.
 *
 * `/r/{CODE}` sends a signed-out visitor to /register?ref=CODE, but the two
 * sign-up screens are not a single flow — a visitor who taps "Sign in" and then
 * lands on /create-profile would otherwise arrive with an empty friend's-code
 * field and the referral would be lost for good (it can only be entered at
 * sign-up). sessionStorage, so it dies with the tab and never leaks into a
 * later, unrelated registration.
 */
const REFERRAL_STASH_KEY = 'barakath.referral';

export function stashReferralCode(code: string): void {
  try {
    if (code) sessionStorage.setItem(REFERRAL_STASH_KEY, code);
  } catch {
    /* private mode — the ?ref= query string still covers the common path */
  }
}

export function readStashedReferralCode(): string {
  try {
    return sessionStorage.getItem(REFERRAL_STASH_KEY) ?? '';
  } catch {
    return '';
  }
}

export function clearStashedReferralCode(): void {
  try {
    sessionStorage.removeItem(REFERRAL_STASH_KEY);
  } catch {
    /* ignore */
  }
}

/** Codes are stored upper-case (see referralCode() in functions/src/affiliate). */
export function normaliseReferralCode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

/**
 * Affiliate presentation helpers.
 *
 * Commission rates are stored as a FRACTION (0.05 = 5%) — the Cloud Functions
 * normalise on write (`functions/src/affiliate/commissions.ts` normaliseRate),
 * but legacy docs written before that may still hold a whole percent (5). We
 * mirror the server's `> 1 ? n / 100 : n` rule so both forms display the same.
 */

/** Stored rate (fraction, or a legacy whole percent) → fraction. */
export function normaliseCommissionRate(raw: number | null | undefined): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1 ? n / 100 : n;
}

/**
 * Stored rate → the number to render before a "%" sign.
 * Rounded to 2dp so 0.025 reads "2.5" and floating-point noise
 * (0.05 * 100 = 5.000000000000001) never reaches the UI.
 */
export function commissionRatePercent(raw: number | null | undefined): string {
  const pct = normaliseCommissionRate(raw) * 100;
  return String(Math.round(pct * 100) / 100);
}

/**
 * Withdrawal processing fee, mirroring `requestWithdrawal`
 * (functions/src/affiliate/requests.ts) EXACTLY so the "You receive" figure the
 * customer confirms matches the payout the server actually records. The server
 * stays authoritative — this is display correctness only.
 *
 * No settings/affiliate doc → zero fee, matching the server's `?? 0` defaults.
 * A zero/blank amount charges nothing: there is no request to levy a fee on yet.
 */
export function withdrawalFeePaise(
  amountPaise: number,
  settings: SettingsAffiliate | null | undefined,
): number {
  if (!settings || amountPaise <= 0) return 0;
  const feeValue = Number(settings.processingFeeValue ?? 0);
  const feeMin = Number(settings.processingFeeMinPaise ?? 0);
  const fee =
    (settings.processingFeeType ?? 'fixed') === 'percent'
      ? Math.round((amountPaise * feeValue) / 100)
      : feeValue;
  return Math.max(Number.isFinite(fee) ? fee : 0, Number.isFinite(feeMin) ? feeMin : 0);
}
