'use client';
import Link from 'next/link';
import { RiArrowRightLine } from '@remixicon/react';
import { useAuth } from '@/lib/auth';
import { AccountShell } from '@/components/account/AccountShell';
import { OrderCard } from '@/components/account/OrderCard';
import { EmptyOrders, ErrorState, OrderCardSkeleton } from '@/components/account/AccountStates';
import { useOrders } from '@/components/account/orders';

export default function AccountHomePage() {
  const customer = useAuth((s) => s.customer);
  const { data: orders, loading, error } = useOrders(customer?.uid);
  const recent = orders.slice(0, 3);

  return (
    <AccountShell title="My orders">
      {loading ? (
        <div className="flex flex-col gap-4">
          <OrderCardSkeleton />
          <OrderCardSkeleton />
        </div>
      ) : error ? (
        <ErrorState message="We couldn't load your orders. Please try again." />
      ) : orders.length === 0 ? (
        <EmptyOrders />
      ) : (
        <div className="flex flex-col gap-4">
          {recent.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
          {orders.length > recent.length && (
            <Link
              href="/account/orders"
              className="inline-flex items-center gap-1.5 self-start font-ui text-sm font-bold text-brand-primary hover:underline"
            >
              View all {orders.length} orders <RiArrowRightLine size={16} />
            </Link>
          )}
        </div>
      )}
    </AccountShell>
  );
}
