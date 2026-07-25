'use client';
import type { UserCoupon } from '@barkath/shared';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { couponDisplayStatus, couponHeadline, couponSourceLabel, couponUsageLabel, formatDay } from './actions';

/**
 * A dashed-border coupon ticket (prototype §coupons / §couponWallet).
 * `active` coupons get the gold ticket treatment; used/expired are muted.
 */
export function CouponCard({
  coupon,
  onApply,
}: {
  coupon: UserCoupon;
  onApply?: (coupon: UserCoupon) => void;
}) {
  // Display status computes expiry on read (see couponDisplayStatus), so a
  // coupon past its expiresAt renders muted even before the sweep flips it.
  const status = couponDisplayStatus(coupon);
  const active = status === 'active';
  const freeShip = coupon.discountType === 'free_shipping';
  const usageLabel = couponUsageLabel(coupon);

  // A friendly countdown for active coupons — "Ends today / tomorrow / in N days"
  // — so the customer sees urgency, with the exact date alongside it.
  const endsIn = endsInLabel(coupon.expiresAt);
  const footer =
    status === 'used'
      ? `Used ${formatDay(coupon.usedAt)}`
      : status === 'expired'
        ? `Expired ${formatDay(coupon.expiresAt)}`
        : coupon.source === 'spin'
          ? `${couponSourceLabel(coupon.source)} · ${endsIn}`
          : endsIn;

  return (
    <div
      className={cn(
        'relative flex items-center gap-4 rounded-xl border border-dashed p-[18px]',
        active
          ? 'border-brand-gold-border bg-brand-gold-subtle'
          : 'border-border-default opacity-60',
      )}
    >
      {/* "0/2" — how many of the per-customer allowance are spent. Only shown
          when the coupon actually has a limit (couponUsageLabel is null for
          an unlimited promotional coupon). */}
      {usageLabel && (
        <span
          className={cn(
            'absolute right-2.5 top-2.5 rounded-pill border px-2 py-0.5 font-ui text-[11px] font-extrabold',
            active
              ? 'border-brand-gold-border bg-white text-brand-gold-strong'
              : 'border-border-default bg-white text-text-tertiary',
          )}
        >
          {usageLabel}
        </span>
      )}
      <div
        className={cn(
          'flex-none font-display text-[22px] font-extrabold leading-none tracking-tight',
          active
            ? freeShip
              ? 'text-brand-primary'
              : 'text-brand-gold-strong'
            : 'text-text-tertiary',
        )}
      >
        {coupon.code}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate font-ui text-sm font-bold',
            active ? 'text-brand-gold-strong' : 'text-text-primary',
          )}
        >
          {coupon.title || couponHeadline(coupon)}
        </div>
        <div className="mt-1 truncate font-ui text-xs font-medium text-text-tertiary">{footer}</div>
      </div>
      {active && onApply && (
        <Button theme="gold" size="s" onClick={() => onApply(coupon)}>
          Apply
        </Button>
      )}
    </div>
  );
}

/**
 * "Ends today / tomorrow / in N days · <date>" for an active coupon's expiry.
 * Falls back to the plain date if the timestamp is missing.
 *
 * Counted in calendar days, not elapsed hours: measuring hours makes the number
 * depend on the time of day the coupon was granted, so one issued at 14:32
 * reads "8 days" all morning and flips to "7" mid-afternoon. Flooring both ends
 * to local midnight holds the number steady through the day and drops it by
 * exactly one each midnight — which is how customers read it.
 */
function endsInLabel(expiresAt: UserCoupon['expiresAt']): string {
  const ms = expiresAt?.toMillis?.();
  if (!ms) return 'No expiry';
  const days = daysUntil(ms);
  const on = formatDay(expiresAt);
  if (days <= 0) return `Ends today · ${on}`;
  if (days === 1) return `Ends tomorrow · ${on}`;
  return `Ends in ${days} days · ${on}`;
}

/** Whole calendar days from today until `ms` (0 = today, negative = past). */
function daysUntil(ms: number): number {
  const end = new Date(ms);
  const now = new Date();
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((endDay - today) / 86_400_000);
}
