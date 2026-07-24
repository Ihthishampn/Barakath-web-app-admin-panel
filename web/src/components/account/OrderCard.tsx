'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { formatMoney2dp as money, type Order } from '@barkath/shared';
import { OrderStatusPill } from './OrderStatusPill';
import { Thumb } from './AccountStates';
import { fmtDate, fmtDateLong, isOpen, reorder } from './orders';

/**
 * Order summary card — the row used on the account dashboard and order history
 * list (prototype §account / §orders). The whole card links to the detail; the
 * inline action buttons stop propagation so they navigate independently.
 */
export function OrderCard({ order }: { order: Order }) {
  const router = useRouter();
  const href = `/account/orders/${order.id}`;
  const delivered = order.status === 'delivered';
  const cancelled = order.status === 'cancelled';
  const thumbs = order.itemsSummary?.slice(0, 3) ?? [];
  const countLabel = `${order.itemsCount} item${order.itemsCount === 1 ? '' : 's'}`;
  // An online order sits at paymentStatus 'pending' until verifyPayment lands,
  // so a dismissed or declined gateway sheet leaves it owing money with nothing
  // on this card to say so. The actual retry lives on the detail page.
  const unpaid =
    order.paymentMethod === 'razorpay' &&
    isOpen(order.status) &&
    (order.paymentStatus === 'pending' || order.paymentStatus === 'failed');

  const subline = delivered
    ? `${countLabel} · delivered ${fmtDate(order.deliveredAt)}`
    : cancelled
      ? `${countLabel} · order cancelled`
      : `${countLabel} · arriving ${fmtDateLong(order.expectedDeliveryDate)}`;

  return (
    <div
      onClick={() => router.push(href)}
      className="cursor-pointer rounded-2xl border border-border-subtle bg-surface-card p-5 transition-shadow hover:shadow-md"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-ui text-[15px] font-bold text-text-primary">{order.shortId}</span>
          <OrderStatusPill status={order.status} />
          {unpaid && (
            <span className="inline-flex items-center rounded-pill bg-error-subtle px-2.5 py-1 font-ui text-[11px] font-extrabold text-error">
              {order.paymentStatus === 'failed' ? 'Payment failed' : 'Payment pending'}
            </span>
          )}
        </div>
        <span className="font-ui text-[13px] font-medium text-text-tertiary">
          Placed {fmtDate(order.placedAt)} · {money(order.totalPaise)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3.5">
        {thumbs.map((it, i) => (
          <Thumb key={`${it.productId}-${i}`} src={it.imageUrl} tint={it.categoryTint} alt={it.productName} />
        ))}
        <p className="min-w-[8rem] flex-1 font-ui text-[13px] font-medium leading-snug text-text-secondary">
          {subline}
        </p>

        <div className="flex flex-wrap items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
          {delivered ? (
            <>
              <Link
                href={`/account/orders/${order.id}/return`}
                className="inline-flex h-[38px] items-center rounded-pill border border-border-default px-4 font-ui text-[13px] font-bold text-text-primary hover:bg-neutral-200"
              >
                Return
              </Link>
              <button
                onClick={async () => {
                  try {
                    const { added, skipped } = await reorder(order.id);
                    if (added > 0) {
                      toast.success(`${added} item${added === 1 ? '' : 's'} added to your bag`, {
                        // Lines left out because the bag/order caps would be
                        // crossed — say so rather than quietly dropping them.
                        description: skipped > 0 ? `${skipped} item${skipped === 1 ? '' : 's'} wouldn't fit in your bag.` : undefined,
                      });
                      router.push('/bag');
                    } else if (skipped > 0) {
                      toast.error("Your bag is full — these items wouldn't fit.");
                    } else {
                      toast.message('Nothing to reorder from this order.');
                    }
                  } catch {
                    toast.error("Couldn't reorder right now. Please try again.");
                  }
                }}
                className="inline-flex h-[38px] items-center rounded-pill px-4 font-ui text-[13px] font-bold text-brand-primary hover:bg-brand-primary-subtle"
              >
                Reorder
              </button>
            </>
          ) : (
            <>
              {unpaid && (
                <Link
                  href={href}
                  className="inline-flex h-[38px] items-center rounded-pill bg-brand-primary px-4 font-ui text-[13px] font-bold text-white hover:bg-brand-primary-dark"
                >
                  Pay now
                </Link>
              )}
              {isOpen(order.status) && (
                <Link
                  href={`/account/orders/${order.id}/track`}
                  className="inline-flex h-[38px] items-center rounded-pill border border-brand-primary px-4 font-ui text-[13px] font-bold text-brand-primary hover:bg-brand-primary-subtle"
                >
                  Track order
                </Link>
              )}
              <Link
                href={`/account/orders/${order.id}/invoice`}
                className="inline-flex h-[38px] items-center rounded-pill px-4 font-ui text-[13px] font-bold text-text-secondary hover:bg-surface-app"
              >
                Invoice
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
