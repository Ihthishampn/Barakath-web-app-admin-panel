'use client';
/**
 * Wallet / affiliate / spin — cloud-function wiring + presentation helpers.
 *
 * Money, wallet and spin are ALL server-authoritative: the client never writes
 * these documents. Each call below is wrapped so an undeployed backend fails
 * gracefully with a sonner toast rather than an unhandled rejection.
 */
import { httpsCallable } from 'firebase/functions';
import type {
  DiscountType,
  UserCoupon,
  UserCouponStatus,
  WalletTransaction,
} from '@barkath/shared';
import { functions } from '@/lib/firebase';
import { openRazorpayCheckout } from '@/components/checkout/checkout';
import type { RemixiconComponentType } from '@remixicon/react';
import {
  RiArrowDownLine,
  RiArrowUpLine,
  RiGiftLine,
  RiShoppingBag3Line,
  RiRefund2Line,
  RiWalletLine,
} from '@remixicon/react';

/** Shown when a wallet/rewards backend call cannot reach a deployed function. */
export const WALLET_CF_MSG = 'This goes live once the rewards/wallet service is deployed.';

// ── Cloud functions (deployed) ──────────────────────────────────────
export type TopUpResult = { status: 'credited' | 'cancelled' | 'failed'; amountPaise?: number };

/**
 * Wallet top-up: create a Razorpay order server-side → open the Razorpay modal
 * → verify the payment server-side (which credits the wallet). Returns the
 * outcome so the caller can toast appropriately.
 */
export async function callTopUpWallet(
  amountPaise: number,
  prefill?: { name?: string; email?: string; contact?: string },
): Promise<TopUpResult> {
  const create = httpsCallable<{ amountPaise: number }, { razorpayOrderId: string; keyId: string; amountPaise: number }>(
    functions,
    'topUpWallet',
  );
  const { data } = await create({ amountPaise });

  const pay = await openRazorpayCheckout({
    keyId: data.keyId,
    razorpayOrderId: data.razorpayOrderId,
    amountPaise: data.amountPaise,
    name: 'Barakath Wallet',
    description: 'Wallet top-up',
    prefill,
  });
  if (!pay) return { status: 'cancelled' };

  const verify = httpsCallable<
    { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
    { credited: boolean; amountPaise: number }
  >(functions, 'verifyTopUp');
  const v = await verify({
    razorpayOrderId: pay.razorpay_order_id,
    razorpayPaymentId: pay.razorpay_payment_id,
    razorpaySignature: pay.razorpay_signature,
  });
  return v.data.credited ? { status: 'credited', amountPaise: v.data.amountPaise } : { status: 'failed' };
}

export async function callRequestWithdrawal(args: {
  amountPaise: number;
  bankAccountId: string;
}): Promise<void> {
  const fn = httpsCallable<typeof args, { withdrawalId: string }>(functions, 'requestWithdrawal');
  await fn(args);
}

export interface SpinResult {
  /** id of the exact winning slice — lets the wheel land precisely. */
  sliceId?: string;
  label: string;
  secondaryLabel: string;
  couponCode: string | null;
  prizeType: string;
}

export async function callExecuteSpin(campaignId: string): Promise<SpinResult> {
  const fn = httpsCallable<{ campaignId: string }, SpinResult>(functions, 'executeSpin');
  const { data } = await fn({ campaignId });
  return data;
}

// ── Formatting ──────────────────────────────────────────────────────
/** Firestore Timestamp | null → "5 Jul 2026" (empty string when missing). */
export function formatDay(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return '';
  return ts.toDate().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Short "5 Jul" for tight ledger rows. */
export function formatDayShort(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return '';
  return ts.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Discount headline for a coupon card, e.g. "₹30 off · min ₹150". */
export function couponHeadline(c: {
  discountType: DiscountType;
  discountValuePaise: number | null;
  discountPercent: number | null;
  discountMaxCapPaise: number | null;
  minCartValuePaise: number;
}): string {
  const rupees = (p: number) => `₹${Math.round(p / 100).toLocaleString('en-IN')}`;
  if (c.discountType === 'free_shipping') return 'Free delivery · any order';
  if (c.discountType === 'percent') {
    const base = `${c.discountPercent ?? 0}% off`;
    return c.discountMaxCapPaise ? `${base} · max ${rupees(c.discountMaxCapPaise)}` : base;
  }
  const base = `${rupees(c.discountValuePaise ?? 0)} off`;
  return c.minCartValuePaise > 0 ? `${base} · min ${rupees(c.minCartValuePaise)}` : base;
}

/**
 * The status to DISPLAY for a personal coupon. The backend never eagerly writes
 * `status: 'expired'` (a daily `couponExpirySweep` reconciles it), so a coupon
 * can still read `active` after its `expiresAt`. Compute expiry on read here so
 * the Active/Used/Expired buckets are correct instantly — matching the App and
 * the checkout validator, which both reject an expired coupon regardless.
 */
export function couponDisplayStatus(c: Pick<UserCoupon, 'status' | 'expiresAt'>): UserCouponStatus {
  if (c.status === 'used') return 'used';
  const exp = c.expiresAt?.toMillis?.();
  if (c.status === 'expired' || (exp !== undefined && exp < Date.now())) return 'expired';
  return 'active';
}

/** Human source label for a spent/earned coupon. */
export function couponSourceLabel(source: UserCoupon['source']): string {
  switch (source) {
    case 'spin':
      return 'Won on Spin & Win';
    case 'welcome':
      return 'Welcome offer';
    case 'referral_bonus':
      return 'Referral bonus';
    case 'admin_grant':
      return 'Gifted to you';
    default:
      return 'Coupon';
  }
}

// ── Wallet transaction visuals ──────────────────────────────────────
export interface TxVisual {
  Icon: RemixiconComponentType;
  bg: string;
  fg: string;
  amountClass: string;
}

/**
 * Icon + tint for a wallet ledger row, keyed off source/type (prototype §wallet).
 *
 * The amount colour is driven by `type` ALONE — money in is green, money out is
 * red — so the sign and the colour can never disagree. Deriving it per-source
 * used to paint a debit green whenever the source happened to be a usually-
 * incoming one (a cashback clawback, a reversed top-up), which read as a credit.
 * The disc icon/tint stays per-source: that is what identifies the row's kind.
 */
export function txVisual(tx: Pick<WalletTransaction, 'source' | 'type'>): TxVisual {
  const credit = tx.type === 'credit';
  const amountClass = credit ? 'text-success' : 'text-error';
  switch (tx.source) {
    case 'refund':
      return { Icon: RiRefund2Line, bg: 'bg-success-subtle', fg: 'text-success', amountClass };
    case 'spin_reward':
    case 'cashback':
      return {
        Icon: RiGiftLine,
        bg: 'bg-brand-gold-subtle',
        fg: 'text-brand-gold-strong',
        amountClass,
      };
    case 'topup':
      return {
        Icon: RiWalletLine,
        bg: 'bg-brand-primary-subtle',
        fg: 'text-brand-primary',
        amountClass,
      };
    case 'withdrawal':
      return { Icon: RiArrowUpLine, bg: 'bg-neutral-200', fg: 'text-text-secondary', amountClass };
    default:
      // order payment / adjustment
      return credit
        ? { Icon: RiArrowDownLine, bg: 'bg-success-subtle', fg: 'text-success', amountClass }
        : {
            Icon: RiShoppingBag3Line,
            bg: 'bg-neutral-200',
            fg: 'text-text-secondary',
            amountClass,
          };
  }
}
