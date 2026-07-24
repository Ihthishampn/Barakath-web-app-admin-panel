'use client';
import { formatMoney2dp } from '@barkath/shared';
import type { Summary } from './checkout';

function Row({
  label,
  value,
  tone = 'secondary',
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: 'secondary' | 'success';
}) {
  return (
    <div
      className={
        'flex items-center justify-between font-ui text-sm font-medium ' +
        (tone === 'success' ? 'text-success' : 'text-text-secondary')
      }
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/**
 * Order-summary card shared by Bag ("Total") and Checkout ("To pay").
 * Pass the total row label + the CTA (a Button) as children.
 */
export function OrderSummary({
  title,
  summary,
  totalLabel,
  couponLabel,
  children,
}: {
  title?: string;
  summary: Summary;
  totalLabel: string;
  couponLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-border-subtle bg-surface-card p-5">
      {title && <div className="mb-1.5 font-display text-base font-extrabold text-text-primary">{title}</div>}

      <Row label="Subtotal" value={formatMoney2dp(summary.subtotalPaise)} />

      {summary.discountPaise > 0 && (
        <Row tone="success" label={couponLabel ?? 'Coupon'} value={`−${formatMoney2dp(summary.discountPaise)}`} />
      )}

      <Row
        label="Delivery"
        value={summary.freeDelivery ? 'Free' : formatMoney2dp(summary.deliveryPaise)}
      />

      {summary.taxPaise > 0 && <Row label="GST" value={formatMoney2dp(summary.taxPaise)} />}

      {summary.walletUsedPaise > 0 && (
        <Row tone="success" label="Barakath Wallet" value={`−${formatMoney2dp(summary.walletUsedPaise)}`} />
      )}

      <div className="my-1 h-px bg-border-subtle" />

      <div className="flex items-center justify-between font-display text-xl font-extrabold text-text-primary">
        <span>{totalLabel}</span>
        <span>{formatMoney2dp(summary.payablePaise)}</span>
      </div>

      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
