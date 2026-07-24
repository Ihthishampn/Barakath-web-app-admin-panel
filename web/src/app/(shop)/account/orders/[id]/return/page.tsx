'use client';
import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { RiArrowLeftLine } from '@remixicon/react';
import { RETURN_REASONS, type Order, type OrderItem } from '@barkath/shared';
import { AccountShell } from '@/components/account/AccountShell';
import { Button } from '@/components/ui/Button';
import { ErrorState, OrderNotFound, Thumb, Skeleton } from '@/components/account/AccountStates';
import { cn } from '@/lib/cn';
import {
  useOrder,
  useOrderItems,
  requestReturn,
  returnWindow,
} from '@/components/account/orders';
import { useReturnSettings } from '@/lib/siteSettings';

export default function ReturnPage() {
  const { id } = useParams<{ id: string }>();
  const { order, loading, error, notFound } = useOrder(id);
  const { data: items, loading: itemsLoading } = useOrderItems(id, order);
  // Mirror the order screen's gate so a direct URL can't bypass the window.
  const { data: returnSettings, loading: settingsLoading } = useReturnSettings();
  const rw = order ? returnWindow(order, returnSettings?.windowDays) : null;

  return (
    <AccountShell title="Return request">
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
      ) : settingsLoading ? (
        <Skeleton className="h-96 max-w-[640px] rounded-2xl" />
      ) : !rw?.open ? (
        <div className="max-w-[640px] rounded-2xl border border-dashed border-border-default bg-surface-card px-6 py-14 text-center">
          <p className="font-display text-base font-extrabold text-text-primary">
            {rw && rw.windowDays > 0 ? 'This order is past its return window' : 'Returns are unavailable'}
          </p>
          <p className="mt-2 font-ui text-sm text-text-secondary">
            {rw && rw.windowDays > 0
              ? `Returns can be raised within ${rw.windowDays} days of delivery.`
              : 'Returns are currently turned off. Please contact support if you need help.'}
          </p>
        </div>
      ) : (
        <Suspense fallback={<Skeleton className="h-96 max-w-[640px] rounded-2xl" />}>
          <ReturnForm order={order} items={items} itemsLoading={itemsLoading} />
        </Suspense>
      )}
    </AccountShell>
  );
}

function ReturnForm({
  order,
  items,
  itemsLoading,
}: {
  order: Order;
  items: OrderItem[];
  itemsLoading: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const preItemId = search.get('itemId');

  // Only items that haven't already been returned/requested are eligible. A
  // MISSING returnStatus (legacy subcollection items) counts as eligible —
  // matching hasReturnableItem() and the server's own gate.
  const eligible = useMemo(
    () => items.filter((it) => !it.returnStatus || it.returnStatus === 'none' || it.returnStatus === 'rejected'),
    [items],
  );

  const [itemId, setItemId] = useState<string>(preItemId ?? '');
  const [reasonKey, setReasonKey] = useState<string>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedItem =
    items.find((it) => it.id === (itemId || preItemId)) ?? eligible[0] ?? items[0] ?? null;

  const showPicker = !preItemId && eligible.length > 1;

  const submit = async () => {
    // When the picker is on, nothing is preselected — requiring an explicit
    // choice stops a silent return against whichever item happens to be first.
    const targetItemId = itemId || (showPicker ? '' : selectedItem?.id);
    if (!targetItemId) {
      toast.error('Select an item to return.');
      return;
    }
    if (!reasonKey) {
      toast.error('Choose a reason for the return.');
      return;
    }
    setBusy(true);
    const res = await requestReturn({ orderId: order.id, itemId: targetItemId, reasonKey, note });
    setBusy(false);
    if (res.ok) {
      toast.success('Return request submitted.');
      router.push(`/account/orders/${order.id}`);
    } else {
      // The server's reasons (window closed, already requested…) are permanent,
      // so show them rather than inviting a pointless retry.
      toast.error(res.message || "We couldn't submit your return just now. Please try again.");
    }
  };

  if (itemsLoading && items.length === 0) {
    return <Skeleton className="h-96 max-w-[640px] rounded-2xl" />;
  }

  if (eligible.length === 0 && items.length > 0) {
    return (
      <div className="max-w-[640px] rounded-2xl border border-border-subtle bg-surface-card p-6 font-ui text-sm text-text-secondary">
        Every item in this order already has a return in progress. Check the order for its status.
      </div>
    );
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-4 rounded-2xl border border-border-subtle bg-surface-card p-6">
      {/* Product context */}
      {selectedItem && !showPicker && (
        <div className="flex items-center gap-3.5">
          <Thumb src={selectedItem.imageUrl} tint={selectedItem.categoryTint} alt={selectedItem.productName} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-ui text-sm font-bold text-text-primary">
              {selectedItem.productDisplayTitle || selectedItem.productName}
            </p>
            <p className="mt-0.5 font-ui text-xs text-text-tertiary">Order {order.shortId}</p>
          </div>
        </div>
      )}

      {/* Item picker (multiple eligible) */}
      {showPicker && (
        <div>
          <p className="mb-2.5 font-ui text-[13px] font-bold text-text-primary">Which item?</p>
          <div className="flex flex-col gap-2.5">
            {eligible.map((it) => (
              <label
                key={it.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors',
                  itemId === it.id ? 'border-brand-primary bg-brand-primary-subtle' : 'border-border-subtle',
                )}
              >
                <input
                  type="radio"
                  name="return-item"
                  className="sr-only"
                  checked={itemId === it.id}
                  onChange={() => setItemId(it.id)}
                />
                <Thumb src={it.imageUrl} tint={it.categoryTint} alt={it.productName} className="h-11 w-11" />
                <span className="min-w-0 flex-1 truncate font-ui text-sm font-semibold text-text-primary">
                  {it.productDisplayTitle || it.productName}
                </span>
                <Radio checked={itemId === it.id} />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Reason */}
      <div>
        <p className="mb-2.5 font-ui text-[13px] font-bold text-text-primary">Reason</p>
        <div className="flex flex-col gap-2.5">
          {RETURN_REASONS.map((r) => (
            <label
              key={r.key}
              className="flex cursor-pointer items-center gap-2.5 font-ui text-sm font-medium text-text-secondary"
            >
              <input
                type="radio"
                name="return-reason"
                className="sr-only"
                checked={reasonKey === r.key}
                onChange={() => setReasonKey(r.key)}
              />
              <Radio checked={reasonKey === r.key} />
              {r.label}
            </label>
          ))}
        </div>
      </div>

      {/* Note */}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note (optional)…"
        rows={3}
        className="w-full resize-y rounded-xl border border-border-default bg-surface-card px-4 py-3 font-ui text-sm text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none"
      />

      <Button theme="primary" size="l" block onClick={() => void submit()} disabled={busy}>
        {busy ? 'Submitting…' : 'Submit request'}
      </Button>
    </div>
  );
}

/** Faux radio dot matching the prototype's ring/filled styling. */
function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid h-[18px] w-[18px] flex-none place-items-center rounded-full border-[1.5px] transition-colors',
        checked ? 'border-brand-primary' : 'border-border-default',
      )}
    >
      {checked && <span className="h-2.5 w-2.5 rounded-full bg-brand-primary" />}
    </span>
  );
}
