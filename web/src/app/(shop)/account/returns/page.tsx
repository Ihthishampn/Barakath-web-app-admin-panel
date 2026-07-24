'use client';
/**
 * My returns — the customer's own `orderRequests`.
 *
 * These records existed but had no list of their own: the only way to see one
 * was to open the exact order it belonged to, and the `#RP-xxxxxx` id the admin
 * quotes when they get in touch was never shown to the customer at all.
 *
 * The query filters on `customerId` only and sorts on the client. That is
 * deliberate — a server-side `orderBy('createdAt')` drops any request written
 * before the field existed, which would hide precisely the oldest, most likely
 * to be chased requests.
 */
import { useMemo } from 'react';
import Link from 'next/link';
import { collection, query, where } from 'firebase/firestore';
import { RiArrowRightSLine, RiRefreshLine } from '@remixicon/react';
import { formatMoney2dp, type OrderRequest, type OrderRequestStatus } from '@barkath/shared';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { useCollection } from '@/lib/useCollection';
import { cn } from '@/lib/cn';
import { AccountShell } from '@/components/account/AccountShell';
import { ErrorState, Skeleton, Thumb } from '@/components/account/AccountStates';
import { TONE_PILL } from '@/components/account/OrderStatusPill';
import { fmtDate, type StatusTone } from '@/components/account/orders';

/**
 * Customer-facing wording + tone for each request status, reusing the order
 * pill's tone map so a return badge looks like every other status badge.
 */
const STATUS_META: Record<OrderRequestStatus, { label: string; tone: StatusTone }> = {
  pending: { label: 'Requested', tone: 'gold' },
  under_review: { label: 'Being reviewed', tone: 'info' },
  approved: { label: 'Approved', tone: 'info' },
  rejected: { label: 'Declined', tone: 'error' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'error' },
};

function statusMeta(status: OrderRequestStatus | string): { label: string; tone: StatusTone } {
  return (
    STATUS_META[status as OrderRequestStatus] ?? {
      label: String(status ?? 'Update').replace(/_/g, ' '),
      tone: 'info',
    }
  );
}

export default function ReturnsPage() {
  const customer = useAuth((s) => s.customer);
  const uid = customer?.uid;

  const { data, loading, error } = useCollection<OrderRequest>(
    () => (uid ? query(collection(db, 'orderRequests'), where('customerId', '==', uid)) : null),
    [uid],
  );

  const requests = useMemo(
    () => [...data].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)),
    [data],
  );

  return (
    <AccountShell title="My returns">
      {loading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      ) : error ? (
        <ErrorState
          message="We couldn't load your returns. Please try again."
          onRetry={() => window.location.reload()}
        />
      ) : requests.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-border-subtle bg-surface-card px-8 py-16 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-brand-primary-subtle text-brand-primary">
            <RiRefreshLine size={26} />
          </span>
          <p className="mt-4 font-display text-lg font-extrabold text-text-primary">No returns yet</p>
          <p className="mt-1.5 max-w-sm font-ui text-sm text-text-secondary">
            If something isn&apos;t right with a delivered order, you can raise a return from the
            order itself.
          </p>
          <Link
            href="/account/orders"
            className="mt-5 inline-flex h-11 items-center rounded-pill bg-brand-primary px-6 font-ui text-sm font-bold text-white hover:bg-brand-primary-dark"
          >
            Go to my orders
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {requests.map((r) => (
            <RequestCard key={r.id} request={r} />
          ))}
        </div>
      )}
    </AccountShell>
  );
}

function RequestCard({ request: r }: { request: OrderRequest }) {
  const meta = statusMeta(r.status);
  const item = r.itemSnapshot;
  // Money only moved when `refundedAt` is stamped — an approval with a manual
  // gateway refund leaves it null and that customer is still waiting.
  const refunded = !!r.refundedAt && r.refundAmountPaise != null;

  return (
    <Link
      href={`/account/orders/${r.orderId}`}
      className="block rounded-2xl border border-border-subtle bg-surface-card p-5 transition-shadow hover:shadow-md"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {/* The id support quotes. It was previously invisible to the customer. */}
          <span className="font-ui text-[15px] font-bold text-text-primary">{r.shortId}</span>
          <span
            className={cn(
              'inline-flex items-center rounded-pill px-2.5 py-1 font-ui text-[11px] font-extrabold',
              TONE_PILL[meta.tone],
            )}
          >
            {meta.label}
          </span>
        </div>
        <span className="font-ui text-[13px] font-medium text-text-tertiary">
          Raised {fmtDate(r.createdAt)} · order {r.orderShortId}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3.5">
        <Thumb tint={null} alt={item?.productName ?? ''} />
        <div className="min-w-[8rem] flex-1">
          <p className="truncate font-ui text-sm font-bold text-text-primary">
            {item?.productName ?? 'Item'}
            {item?.variantLabel ? ` · ${item.variantLabel}` : ''}
          </p>
          <p className="mt-0.5 font-ui text-[13px] font-medium leading-snug text-text-secondary">
            {r.reasonLabel || 'Return requested'}
            {item?.quantity ? ` · Qty ${item.quantity}` : ''}
          </p>
          {r.status === 'rejected' && r.rejectionReason && (
            <p className="mt-1 font-ui text-[12px] text-error">{r.rejectionReason}</p>
          )}
          {refunded && (
            <p className="mt-1 font-ui text-[12px] font-semibold text-success">
              {formatMoney2dp(r.refundAmountPaise ?? 0)} refunded
              {r.refundMethod === 'wallet' ? ' to your wallet' : ''} on {fmtDate(r.refundedAt)}
            </p>
          )}
        </div>
        <span className="flex items-center gap-1 font-ui text-[13px] font-bold text-brand-primary">
          View order <RiArrowRightSLine size={16} />
        </span>
      </div>
    </Link>
  );
}
