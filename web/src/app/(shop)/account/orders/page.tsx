'use client';
import { useMemo, useState } from 'react';
import type { Order } from '@barkath/shared';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { AccountShell } from '@/components/account/AccountShell';
import { OrderCard } from '@/components/account/OrderCard';
import { EmptyOrders, ErrorState, OrderCardSkeleton } from '@/components/account/AccountStates';
import { isOpen, useOrders } from '@/components/account/orders';

/**
 * Status filters, mirroring the Flutter app's My-orders tabs (All / Active /
 * Delivered / Cancelled). Filtering happens on the already-loaded list — the
 * query is a single `customerId` read with no `orderBy`, deliberately
 * index-free, so slicing it here costs nothing extra.
 */
type Tab = 'all' | 'active' | 'delivered' | 'cancelled';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

const matchesTab = (o: Order, tab: Tab): boolean => {
  if (tab === 'all') return true;
  if (tab === 'active') return isOpen(o.status);
  if (tab === 'delivered') return o.status === 'delivered';
  return o.status === 'cancelled';
};

export default function OrdersPage() {
  const customer = useAuth((s) => s.customer);
  const { data: orders, loading, error } = useOrders(customer?.uid);
  const [tab, setTab] = useState<Tab>('all');

  const counts = useMemo(
    () =>
      TABS.reduce<Record<Tab, number>>(
        (acc, t) => {
          acc[t.key] = orders.filter((o) => matchesTab(o, t.key)).length;
          return acc;
        },
        { all: 0, active: 0, delivered: 0, cancelled: 0 },
      ),
    [orders],
  );

  const shown = useMemo(() => orders.filter((o) => matchesTab(o, tab)), [orders, tab]);

  return (
    <AccountShell title="My orders">
      {/* Filter chips — the same pill treatment the listing's stock filters use. */}
      {!loading && !error && orders.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  'rounded-pill px-4 py-1.5 font-ui text-[13px] font-bold transition-colors',
                  on
                    ? 'bg-brand-primary text-white'
                    : 'border border-border-default text-text-secondary hover:bg-neutral-200',
                )}
              >
                {t.label}{' '}
                <span className={on ? 'text-white/70' : 'text-text-tertiary'}>({counts[t.key]})</span>
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-4">
          <OrderCardSkeleton />
          <OrderCardSkeleton />
          <OrderCardSkeleton />
        </div>
      ) : error ? (
        <ErrorState
          message="We couldn't load your orders. Please try again."
          onRetry={() => window.location.reload()}
        />
      ) : orders.length === 0 ? (
        <EmptyOrders />
      ) : shown.length === 0 ? (
        // The account HAS orders, just none in this filter — don't offer the
        // "start shopping" empty state as if they had never ordered.
        <div className="grid place-items-center rounded-2xl border border-dashed border-border-default bg-surface-card px-8 py-16 text-center font-ui text-sm text-text-tertiary">
          No {TABS.find((t) => t.key === tab)!.label.toLowerCase()} orders.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {shown.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </div>
      )}
    </AccountShell>
  );
}
