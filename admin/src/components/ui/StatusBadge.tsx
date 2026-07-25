import type { OrderStatus } from '@barkath/shared';
import { cn } from '@/lib/cn';

type Tone = 'success' | 'info' | 'gold' | 'error' | 'neutral';

const TONE_CLASS: Record<Tone, string> = {
  success: 'text-success bg-success-subtle',
  info: 'text-info bg-info-subtle',
  gold: 'text-brand-gold-strong bg-brand-gold-subtle',
  error: 'text-error bg-error-subtle',
  neutral: 'text-text-secondary bg-neutral-200',
};

/** Admin order badge label + tone (tech-arch §1.6a; colors from prototype). */
const ORDER_BADGE: Record<OrderStatus, { label: string; tone: Tone }> = {
  // Unpaid online order — placed but not yet paid, so not accepted. Sits in the
  // Accepted admin tab; the sweep cancels it if the payment never lands.
  pending_payment: { label: 'Payment pending', tone: 'error' },
  accepted: { label: 'Accepted', tone: 'gold' },
  packing: { label: 'Packing', tone: 'gold' },
  packed: { label: 'Packed', tone: 'gold' },
  shipped: { label: 'Shipped', tone: 'info' },
  out_for_delivery: { label: 'Out for delivery', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'error' },
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] rounded-[6px] px-[9px] py-[5px] font-ui text-[11px] font-bold',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { label, tone } = ORDER_BADGE[status];
  return <Badge tone={tone}>{label}</Badge>;
}
