import { RiCheckLine } from '@remixicon/react';
import { cn } from '@/lib/cn';
import type { OrderStatus } from '@barkath/shared';
import { statusMeta, type StatusTone } from './orders';

export const TONE_PILL: Record<StatusTone, string> = {
  gold: 'bg-brand-gold-subtle text-brand-gold-strong',
  brand: 'bg-brand-primary-subtle text-brand-primary',
  info: 'bg-info-subtle text-info',
  success: 'bg-success-subtle text-success',
  error: 'bg-error-subtle text-error',
};

/**
 * Order-status pill — pill-shaped, tone per status (prototype §orders).
 * "Delivered" is rendered as an inline check + label in success colour (not a
 * filled pill), matching the prototype.
 *
 * `delayed` overrides an open order's label/tone to a "Delayed" chip — a
 * past-due shipment reads as late instead of its stale in-flight status,
 * matching the detail banner and the app's badge.
 */
export function OrderStatusPill({
  status,
  delayed = false,
  className,
}: {
  status: OrderStatus;
  delayed?: boolean;
  className?: string;
}) {
  const meta = delayed ? { label: 'Delayed', tone: 'error' as StatusTone } : statusMeta(status);
  if (status === 'delivered') {
    return (
      <span className={cn('inline-flex items-center gap-1 font-ui text-[13px] font-bold text-success', className)}>
        <RiCheckLine size={15} /> {meta.label}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill px-2.5 py-1 font-ui text-xs font-bold',
        TONE_PILL[meta.tone],
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
