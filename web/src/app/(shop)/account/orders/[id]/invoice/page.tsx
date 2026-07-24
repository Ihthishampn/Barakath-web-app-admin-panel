'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { RiArrowLeftLine, RiDownloadLine, RiTimeLine } from '@remixicon/react';
import { formatMoney2dp, type Order, type OrderItem } from '@barkath/shared';
import { AccountShell } from '@/components/account/AccountShell';
import { ErrorState, OrderNotFound, Skeleton } from '@/components/account/AccountStates';
import { useOrder, useOrderItems, fmtDate } from '@/components/account/orders';

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { order, loading, error, notFound } = useOrder(id);
  const { data: items } = useOrderItems(id, order);

  return (
    <AccountShell title="Invoice">
      <Link
        href={`/account/orders/${id}`}
        className="mb-4 inline-flex items-center gap-1.5 font-ui text-sm font-semibold text-text-secondary hover:text-text-primary"
      >
        <RiArrowLeftLine size={16} /> Back to order
      </Link>

      {loading ? (
        <Skeleton className="h-96 max-w-[640px] rounded-2xl" />
      ) : error ? (
        <ErrorState />
      ) : notFound || !order ? (
        <OrderNotFound />
      ) : (
        <Invoice order={order} items={items} />
      )}
    </AccountShell>
  );
}

function Invoice({ order, items }: { order: Order; items: OrderItem[] }) {
  const lines =
    items.length > 0
      ? items.map((it) => ({
          key: it.id,
          name: it.productDisplayTitle || it.productName,
          qty: it.quantity,
          pricePaise: it.lineTotalPaise,
        }))
      : (order.itemsSummary ?? []).map((it, i) => ({
          key: `${it.productId}-${i}`,
          name: it.productName,
          qty: it.quantity,
          pricePaise: null as number | null,
        }));

  // `spinRewardPaise` is deliberately NOT added: placeOrder derives it FROM the
  // same coupon discount — `spinRewardPaise = userCouponId && userCouponSource
  // === 'spin' ? Math.max(0, discountPaise) : 0` (functions/src/orders/checkout.ts)
  // — so on a spin order it EQUALS discountPaise and only labels that money as
  // a reward. Adding both double-counted the discount and the document stopped
  // adding up (line total − savings ≠ Total paid). Mirrors
  // app/lib/features/orders/data/order.dart (`deductionPaise`).
  const savings = order.discountPaise + order.walletUsedPaise;

  return (
    <div className="max-w-[640px] rounded-2xl border border-border-subtle bg-surface-card p-8">
      <div className="mb-5 flex items-start justify-between border-b border-border-subtle pb-5">
        <Image src="/images/logo.png" alt="Barakath" width={120} height={36} className="h-9 w-auto object-contain" />
        <div className="text-right">
          <div className="font-display text-base font-extrabold text-text-primary">Invoice</div>
          <div className="mt-1 font-ui text-xs text-text-tertiary">
            {order.shortId} · {fmtDate(order.placedAt, { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        </div>
      </div>

      <dl className="flex flex-col gap-2.5 font-ui text-sm">
        {lines.map((l) => (
          <div key={l.key} className="flex items-center justify-between">
            <span className="text-text-secondary">
              {l.name} × {l.qty}
            </span>
            <span className="text-text-primary">
              {l.pricePaise != null ? formatMoney2dp(l.pricePaise) : '—'}
            </span>
          </div>
        ))}

        {order.deliveryPaise > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Delivery</span>
            <span className="text-text-primary">{formatMoney2dp(order.deliveryPaise)}</span>
          </div>
        )}
        {/* Cash on delivery is withdrawn, but orders placed while it existed
            were charged this — without the row their invoice cannot be
            reconciled against Total paid. Zero (and absent) on every new order. */}
        {order.codSurchargePaise > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">COD charge</span>
            <span className="text-text-primary">{formatMoney2dp(order.codSurchargePaise)}</span>
          </div>
        )}
        {order.taxPaise > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Tax</span>
            <span className="text-text-primary">{formatMoney2dp(order.taxPaise)}</span>
          </div>
        )}
        {savings > 0 && (
          <div className="flex items-center justify-between text-success">
            <span>Discounts + wallet</span>
            <span>−{formatMoney2dp(savings)}</span>
          </div>
        )}

        <div className="my-1.5 h-px bg-border-subtle" />

        <div className="flex items-center justify-between font-display text-lg font-extrabold text-text-primary">
          <span>Total paid</span>
          <span>{formatMoney2dp(order.amountPaidPaise || order.totalPaise)}</span>
        </div>
      </dl>

      <div className="mt-6">
        {order.invoiceUrl ? (
          <a href={order.invoiceUrl} target="_blank" rel="noopener noreferrer">
            <span className="inline-flex h-11 items-center gap-2 rounded-pill bg-brand-primary px-5 font-ui text-sm font-bold text-white transition-colors hover:bg-brand-primary-dark">
              <RiDownloadLine size={17} /> Download PDF
            </span>
          </a>
        ) : (
          <div className="flex items-center gap-2 rounded-xl bg-surface-app px-4 py-3 font-ui text-sm text-text-secondary">
            <RiTimeLine size={17} className="flex-none text-text-tertiary" />
            Your PDF invoice generates once the order is delivered.
          </div>
        )}
      </div>
    </div>
  );
}
