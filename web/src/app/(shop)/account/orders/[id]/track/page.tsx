'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { RiArrowLeftLine, RiTruckLine, RiCheckLine } from '@remixicon/react';
import type { Order, OrderStatus, OrderTimelineEntry } from '@barkath/shared';
import { AccountShell } from '@/components/account/AccountShell';
import { ErrorState, OrderNotFound, Skeleton } from '@/components/account/AccountStates';
import { useOrder, useTimeline, statusMeta, fmtDateLong, fmtDateTime } from '@/components/account/orders';

/** Canonical happy-path order flow — drives the pending/upcoming steps. */
const FLOW: OrderStatus[] = ['accepted', 'packing', 'packed', 'shipped', 'out_for_delivery', 'delivered'];
type StepState = 'done' | 'current' | 'pending';

/** One vertical-stepper row (done = filled check, current = ring, pending = greyed). */
function StepRow({
  label,
  time,
  note,
  state,
  error = false,
  last,
}: {
  label: string;
  time?: string;
  note?: string | null;
  state: StepState;
  error?: boolean;
  last: boolean;
}) {
  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      {!last && (
        // Connector between dots. The segment BELOW a step is green only when
        // that step is `done` — the leg out of the CURRENT step leads to a
        // stage the order has not reached, so it stays grey (Figma 82:3784:
        // green stops at "Out for delivery", grey continues to "Delivered").
        // 2px wide at left-[11px] centres it under the 24px dot; top-7/bottom-0
        // spans exactly dot-bottom to next-dot-top instead of overflowing.
        <span
          className={`absolute bottom-0 left-[11px] top-7 w-0.5 rounded-pill ${
            state === 'done' ? 'bg-brand-primary' : 'bg-border-default'
          }`}
          aria-hidden
        />
      )}
      <span
        className={`relative z-10 mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full ${
          error
            ? 'bg-error text-white'
            : state === 'done'
              ? 'bg-brand-primary text-white'
              : // The CURRENT status has been REACHED — the order IS at this
                // stage — so it is filled with a check like a completed step,
                // with a highlight ring to mark it as the latest. It used to be
                // an empty ring with no check, so a delivered order showed
                // "Delivered" as an un-filled dot while the last filled dot sat
                // on "Out for delivery" — reading as one status behind.
                state === 'current'
                ? 'bg-brand-primary text-white ring-2 ring-brand-primary/30 ring-offset-2 ring-offset-surface-card'
                : 'border-2 border-border-default bg-surface-card'
        }`}
      >
        {(state === 'done' || state === 'current' || error) && <RiCheckLine size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`font-ui text-sm font-bold ${state === 'pending' ? 'text-text-tertiary' : 'text-text-primary'}`}>
          {label}
        </p>
        {time && <p className="mt-0.5 font-ui text-xs text-text-tertiary">{time}</p>}
        {note && <p className="mt-1 font-ui text-[13px] text-text-secondary">{note}</p>}
      </div>
    </li>
  );
}

export default function TrackPage() {
  const { id } = useParams<{ id: string }>();
  const { order, loading, error, notFound } = useOrder(id);
  const { data: timeline, loading: tlLoading } = useTimeline(id);

  return (
    <AccountShell title="Track order">
      <Link
        href={`/account/orders/${id}`}
        className="mb-4 inline-flex items-center gap-1.5 font-ui text-sm font-semibold text-text-secondary hover:text-text-primary"
      >
        <RiArrowLeftLine size={16} /> Back to order
      </Link>

      {loading ? (
        <div className="flex max-w-[520px] flex-col gap-6">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : error ? (
        <ErrorState />
      ) : notFound || !order ? (
        <OrderNotFound />
      ) : (
        <Tracking order={order} timeline={timeline} tlLoading={tlLoading} />
      )}
    </AccountShell>
  );
}

function Tracking({
  order,
  timeline,
  tlLoading,
}: {
  order: Order;
  timeline: OrderTimelineEntry[];
  tlLoading: boolean;
}) {
  const delivered = order.status === 'delivered';
  const cancelled = order.status === 'cancelled';

  return (
    <div className="max-w-[520px]">
      {/* Arrival hero */}
      {!cancelled && (
        <div
          className="mb-6 rounded-2xl p-6 text-white"
          style={{ background: 'linear-gradient(120deg,var(--brand-primary),var(--brand-primary-dark))' }}
        >
          <div className="font-ui text-xs font-medium opacity-85">
            {delivered ? 'Delivered on' : 'Arriving by'}
          </div>
          <div className="mt-1.5 font-display text-3xl font-extrabold leading-tight">
            {fmtDateLong(delivered ? order.deliveredAt : order.expectedDeliveryDate)}
          </div>
          {order.rider?.name && !delivered && (
            <div className="mt-2.5 flex items-center gap-1.5 font-ui text-[13px] font-medium opacity-90">
              <RiTruckLine size={16} /> Rider {order.rider.name}
              {order.rider.currentDistanceKm != null ? ` · ${order.rider.currentDistanceKm} km away` : ''}
            </div>
          )}
        </div>
      )}

      {/* Vertical timeline */}
      <div className="rounded-2xl border border-border-subtle bg-surface-card p-6">
        {tlLoading && timeline.length === 0 ? (
          <div className="flex flex-col gap-5">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-6 w-1/2" />
          </div>
        ) : cancelled ? (
          <ol className="relative">
            {timeline.map((entry, i) => (
              <StepRow
                key={entry.id}
                label={statusMeta(entry.status).label}
                time={fmtDateTime(entry.at)}
                note={entry.note}
                state="done"
                error={entry.status === 'cancelled'}
                last={i === timeline.length - 1}
              />
            ))}
          </ol>
        ) : (
          <ol className="relative">
            {FLOW.map((status, i) => {
              const currentIdx = FLOW.indexOf(order.status);
              const entry = timeline.find((t) => t.status === status);
              const state: StepState = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'pending';
              return (
                <StepRow
                  key={status}
                  label={statusMeta(status).label}
                  time={entry ? fmtDateTime(entry.at) : state === 'pending' ? 'Pending' : undefined}
                  note={entry?.note}
                  state={state}
                  last={i === FLOW.length - 1}
                />
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
