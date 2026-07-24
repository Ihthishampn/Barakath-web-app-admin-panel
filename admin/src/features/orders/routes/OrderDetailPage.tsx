import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { RiArrowDownLine } from '@remixicon/react';
import { formatMoney2dp, type Order, type OrderStatus } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { cap, dateTimeShort } from '@/lib/format';
import { cfError } from '@/lib/cfError';
import { noPermissionTitle, useCan } from '@/features/auth/useCan';
// The payments screen owns the method label and the status pill; reusing them
// keeps this card and the Payments list telling the same story about one order.
import { methodLabel, paymentStatusPill } from '@/features/payments/api/payments';
import {
  assignRider,
  changeOrderStatus,
  effectiveOrderPaymentStatus,
  generateInvoice,
  nextStatuses,
  useOrder,
  useOrderItems,
  useOrderTimeline,
} from '../api/orders';

const prettyStatus = (s: OrderStatus) => cap(s);

export function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: order, loading, error } = useOrder(id ?? null);
  // Items come from the order doc's embedded `items` array when present; the hook
  // falls back to the subcollection for legacy orders. Deriving from the already
  // loaded order avoids a second read.
  const { data: items } = useOrderItems(order);
  const { data: timeline } = useOrderTimeline(id ?? null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [courier, setCourier] = useState('');
  const [trackingId, setTrackingId] = useState('');
  const [riderName, setRiderName] = useState('');
  const [riderPhone, setRiderPhone] = useState('');
  const menuWrapRef = useRef<HTMLDivElement>(null);
  // adminChangeOrderStatus, adminAssignRider and adminGenerateInvoice all call
  // requireModule(req, 'orders', 'edit'), so one permission covers every
  // control on this screen.
  const canEditOrders = useCan()('orders', 'edit');
  // Seed the shipment inputs once per order — the doc is live, and a snapshot
  // arriving mid-edit must not overwrite what the operator is typing.
  const shipSeeded = useRef<string | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuWrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!order || shipSeeded.current === order.id) return;
    shipSeeded.current = order.id;
    setCourier(order.courier ?? '');
    setTrackingId(order.trackingId ?? '');
    setRiderName(order.rider?.name ?? '');
    setRiderPhone(order.rider?.phone ?? '');
  }, [order]);

  if (loading && !order) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="h-7 w-7 text-brand-primary" />
      </div>
    );
  }
  if (!order) {
    return (
      <div className="px-7 py-6">
        {/* A failed read also yields a null doc — telling the operator the order
            does not exist would invite them to re-place it. */}
        <p className="font-ui text-sm text-text-tertiary">
          {error
            ? error.code === 'permission-denied'
              ? 'Couldn’t load this order — this account doesn’t have permission to read it. Sign in again as an admin.'
              : 'Couldn’t load this order. Please retry in a moment.'
            : 'Order not found.'}
        </p>
        <button onClick={() => navigate('/orders')} className="mt-3 font-ui text-[13px] font-semibold text-brand-primary hover:underline">
          ‹ Back to orders
        </button>
      </div>
    );
  }

  const transitions = nextStatuses(order.status);

  const applyStatus = async (status: OrderStatus) => {
    try {
      setBusy(true);
      await changeOrderStatus({ orderId: order.id, status });
      toast.success(`Status updated to ${prettyStatus(status)}`);
      // Only close on success — a failed call leaves the dialog up so the
      // operator sees the toast against the action they asked for.
      setConfirmCancel(false);
    } catch (e) {
      toast.error(cfError(e, 'update the status'));
    } finally {
      setBusy(false);
    }
  };

  const onSetStatus = async (status: OrderStatus) => {
    setMenuOpen(false);
    // 'cancelled' is terminal (nextStatuses returns nothing from it) and the
    // server runs the whole money path behind it — restock, wallet refund,
    // coupon release, commission reversal — none of which the panel can undo.
    // A menu row one line off from the intended status must not do all that on
    // a single click, so it goes behind the same confirm every other
    // money-moving action here uses.
    if (status === 'cancelled') {
      setConfirmCancel(true);
      return;
    }
    await applyStatus(status);
  };

  // Blank clears a field server-side, so compare trimmed against the stored value.
  const cancelled = order.status === 'cancelled';
  // What the restock actually returns is units, not order lines.
  const restockUnits = items.reduce((n, it) => n + (it.quantity ?? 0), 0);
  const shipDirty =
    courier.trim() !== (order.courier ?? '') ||
    trackingId.trim() !== (order.trackingId ?? '') ||
    riderName.trim() !== (order.rider?.name ?? '') ||
    riderPhone.trim() !== (order.rider?.phone ?? '');

  const onSaveShipment = async () => {
    try {
      setShipping(true);
      await assignRider({
        orderId: order.id,
        courier: courier.trim() || null,
        trackingId: trackingId.trim() || null,
        riderName: riderName.trim() || null,
        riderPhone: riderPhone.trim() || null,
      });
      toast.success('Shipment details saved');
    } catch (e) {
      toast.error(cfError(e, 'save the shipment details'));
    } finally {
      setShipping(false);
    }
  };

  const onInvoice = async () => {
    // An invoice generated before the order was cancelled still bills the full
    // amount as payable, and nothing clears invoiceUrl on cancellation — so
    // regenerate it instead of reopening it. The storage path is derived from
    // the order, so the refreshed (refunded) document overwrites the stale one
    // the customer's Invoice screen links to.
    const staleAfterCancel =
      !!order.cancelledAt && (order.invoiceGeneratedAt?.toMillis() ?? 0) < order.cancelledAt.toMillis();
    if (order.invoiceUrl && !staleAfterCancel) {
      window.open(order.invoiceUrl, '_blank', 'noopener');
      return;
    }
    try {
      setInvoicing(true);
      const url = await generateInvoice(order.id);
      window.open(url, '_blank', 'noopener');
      toast.success('Invoice generated');
    } catch (e) {
      toast.error(cfError(e, 'generate the invoice'));
    } finally {
      setInvoicing(false);
    }
  };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
          Order {order.shortId}
        </h1>
        <div className="flex gap-2.5">
          <div ref={menuWrapRef} className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              disabled={busy || transitions.length === 0 || !canEditOrders}
              title={canEditOrders ? undefined : noPermissionTitle('orders', 'edit')}
              className="flex h-[42px] items-center gap-2 rounded-sm bg-brand-primary px-4 font-ui text-[13px] font-bold text-white hover:bg-brand-primary-dark disabled:opacity-60"
            >
              {busy ? <Spinner className="h-4 w-4 text-white" /> : null}
              Update status: <span className="font-extrabold">{prettyStatus(order.status)}</span>
              <RiArrowDownLine size={16} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-[46px] z-20 w-[220px] rounded-[10px] border border-border-default bg-surface-card p-1.5 shadow-lg">
                {transitions.length === 0 ? (
                  <div className="px-3 py-2.5 font-ui text-[13px] text-text-tertiary">No further changes.</div>
                ) : (
                  transitions.map((s) => (
                    <button
                      key={s}
                      onClick={() => void onSetStatus(s)}
                      className="block w-full rounded-[7px] px-3 py-2.5 text-left font-ui text-[13px] font-semibold text-text-secondary hover:bg-surface-app hover:text-text-primary"
                    >
                      {prettyStatus(s)}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {/* Generating an invoice is a server write (it stamps invoiceUrl on
              the order), so it needs orders.edit too — but an ALREADY generated
              invoice is just a link, and opening it is a read. */}
          <Button
            variant="outline"
            className="h-[42px]"
            loading={invoicing}
            disabled={!canEditOrders && !order.invoiceUrl}
            title={canEditOrders || order.invoiceUrl ? undefined : noPermissionTitle('orders', 'edit')}
            onClick={onInvoice}
          >
            Invoice
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-[1fr_320px] gap-5">
        {/* LEFT */}
        <div className="flex flex-col gap-4">
          {/* Items */}
          <Card title="Items">
            {items.length === 0 ? (
              <p className="font-ui text-xs text-text-tertiary">No items.</p>
            ) : (
              items.map((it) => (
                <div key={it.id} className="flex items-center gap-3 border-b border-border-subtle py-2.5 last:border-0">
                  <span
                    className="h-10 w-10 flex-none rounded-[7px] bg-cover bg-center"
                    style={{
                      backgroundColor: it.categoryTint || '#eee',
                      backgroundImage: it.imageUrl ? `url(${it.imageUrl})` : undefined,
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-ui text-[13px] font-bold text-text-primary">{it.productName}</div>
                    <div className="mt-[3px] font-ui text-[11px] text-text-tertiary">
                      {it.variantLabel ? `${it.variantLabel}${it.quantity > 1 ? ` · ×${it.quantity}` : ''}` : it.quantity > 1 ? `×${it.quantity}` : '—'}
                    </div>
                  </div>
                  <span className="font-display text-[13px] font-extrabold text-brand-gold-strong">
                    {formatMoney2dp(it.lineTotalPaise)}
                  </span>
                </div>
              ))
            )}
          </Card>

          {/* Shipment · AWB */}
          <Card title="Shipment · AWB">
            <div className="grid grid-cols-2 gap-3.5">
              <EditField label="Courier" value={courier} onChange={setCourier} disabled={cancelled || !canEditOrders} />
              <EditField label="AWB number" value={trackingId} onChange={setTrackingId} disabled={cancelled || !canEditOrders} />
              <EditField label="Rider" value={riderName} onChange={setRiderName} disabled={cancelled || !canEditOrders} />
              <EditField label="Rider phone" value={riderPhone} onChange={setRiderPhone} disabled={cancelled || !canEditOrders} />
              <ReadField label="ETA" value={order.expectedDeliveryDate ? dateTimeShort(order.expectedDeliveryDate.toDate()) : null} />
            </div>
            {/* The server rejects shipment edits on a cancelled order. */}
            <div className="mt-3.5 flex justify-end">
              <Button
                variant="primary"
                className="h-[38px]"
                loading={shipping}
                disabled={cancelled || !shipDirty || !canEditOrders}
                title={canEditOrders ? undefined : noPermissionTitle('orders', 'edit')}
                onClick={onSaveShipment}
              >
                Save shipment
              </Button>
            </div>
          </Card>
        </div>

        {/* RIGHT */}
        <div className="flex flex-col gap-4">
          {/* Payment — method, settled status and the money that makes up the total */}
          <PaymentCard order={order} />

          {/* Timeline */}
          <Card title="Timeline">
            {timeline.length === 0 ? (
              <p className="font-ui text-xs text-text-tertiary">No history yet.</p>
            ) : (
              <div>
                {timeline.map((t, i) => (
                  <div key={t.id} className="flex gap-3 pb-3.5 last:pb-0">
                    <div className="flex flex-col items-center">
                      <span className="h-[11px] w-[11px] flex-none rounded-full bg-brand-primary" />
                      {i < timeline.length - 1 && <span className="mt-0.5 w-0.5 flex-1 bg-border-subtle" />}
                    </div>
                    <div>
                      <div className="font-ui text-[12px] font-bold text-text-primary">{prettyStatus(t.status)}</div>
                      <div className="mt-[3px] font-ui text-[11px] text-text-tertiary">{dateTimeShort(t.at?.toDate())}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Customer */}
          <Card title="Customer">
            <div className="font-ui text-[13px] font-bold text-text-primary">{order.customerName}</div>
            <div className="mt-1.5 font-ui text-[12px] leading-relaxed text-text-secondary">
              {formatAddress(order)}
              <br />
              {order.customerPhone}
            </div>
          </Card>
        </div>
      </div>

      {/* Cancel confirm — spells out what the server does before it is done */}
      <ConfirmDialog
        open={confirmCancel}
        variant="danger"
        title="Cancel this order?"
        body={
          <>
            Order {order.shortId} will be cancelled and can’t be reopened.{' '}
            {order.amountPaidPaise > 0 ? (
              <>
                {formatMoney2dp(order.amountPaidPaise)} will be credited to{' '}
                <strong className="text-text-primary">{order.customerName}</strong>’s wallet
              </>
            ) : (
              <>Nothing has been paid, so no money moves</>
            )}
            , {restockUnits} unit{restockUnits === 1 ? '' : 's'} go back into stock, any coupon on it is
            released and any affiliate commission is reversed.
          </>
        }
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        onConfirm={() => applyStatus('cancelled')}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}

// ── local bits ─────────────────────────────────────────────────────
/**
 * How the order was paid and what it is made of.
 *
 * The detail screen used to show no payment information at all — not the
 * method, not the status, not a single money line — so an operator opening a
 * historical COD order could not tell it was COD, whether the cash had been
 * collected, or that its total carried a COD surcharge. Every figure here comes
 * off the order document itself (no extra read, nothing recomputed), so it can
 * never disagree with what the customer was charged.
 */
function PaymentCard({ order }: { order: Order }) {
  const pill = paymentStatusPill(effectiveOrderPaymentStatus(order));
  const cod = order.codSurchargePaise ?? 0;
  const discount = order.discountPaise ?? 0;
  const wallet = order.walletUsedPaise ?? 0;
  const tax = order.taxPaise ?? 0;
  return (
    <Card title="Payment">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-ui text-[13px] font-bold text-text-primary">{methodLabel(order.paymentMethod)}</span>
        <Badge tone={pill.tone}>{pill.label}</Badge>
      </div>
      <MoneyRow label="Subtotal" paise={order.subtotalPaise ?? 0} />
      {/* Zero-value lines are noise on most orders, so each optional component
          only appears when it actually moved money. `spinRewardPaise` is already
          inside `discountPaise` (see reports.ts) — showing it too would read as a
          second, separate discount. */}
      {discount > 0 && <MoneyRow label="Discount" paise={-discount} />}
      <MoneyRow label="Delivery" paise={order.deliveryPaise ?? 0} />
      {/* Historical COD orders only. New orders are online/wallet, so this stays
          absent — but it must never be dropped, or their total won't add up. */}
      {cod > 0 && <MoneyRow label="COD surcharge" paise={cod} />}
      {tax > 0 && <MoneyRow label="Tax" paise={tax} />}
      <MoneyRow label="Total" paise={order.totalPaise ?? 0} strong />
      {/* Wallet money was taken at checkout, so `amountPaidPaise` alone under-
          states what the customer parted with — show the split. */}
      {wallet > 0 && <MoneyRow label="Wallet used" paise={-wallet} />}
      <MoneyRow label="Amount paid" paise={order.amountPaidPaise ?? 0} />
    </Card>
  );
}

/** One label/amount line, matching the Items card's row rhythm. */
function MoneyRow({ label, paise, strong }: { label: string; paise: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border-subtle py-2 last:border-0">
      <span className={cn('font-ui text-[12px]', strong ? 'font-bold text-text-primary' : 'text-text-secondary')}>
        {label}
      </span>
      <span
        className={cn(
          'font-display text-[13px] font-extrabold',
          strong ? 'text-text-primary' : paise < 0 ? 'text-success' : 'text-text-secondary',
        )}
      >
        {/* A negative component is money coming off the total — render it with a
            real minus sign rather than a bare parenthesis-free number. */}
        {paise < 0 ? `− ${formatMoney2dp(Math.abs(paise))}` : formatMoney2dp(paise)}
      </span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
      <div className="mb-3.5 font-display text-sm font-bold text-text-primary">{title}</div>
      {children}
    </div>
  );
}

/** Editable twin of ReadField — same frame, so the card reads identically. */
function EditField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-ui text-xs font-bold text-text-primary">{label}</span>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="rounded-sm border border-border-default px-[13px] py-[11px] font-ui text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none disabled:opacity-60"
      />
    </label>
  );
}

function ReadField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-ui text-xs font-bold text-text-primary">{label}</span>
      <div className="rounded-sm border border-border-default px-[13px] py-[11px] font-ui text-[13px] text-text-primary">
        {value || '—'}
      </div>
    </div>
  );
}

function formatAddress(order: { deliveryAddress?: { line1?: string; line2?: string | null; city?: string; pincode?: string } }): string {
  const a = order.deliveryAddress;
  if (!a) return '—';
  return [a.line1, a.line2, [a.city, a.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}
