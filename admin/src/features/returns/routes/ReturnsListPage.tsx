import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { RiArrowLeftLine, RiCloseLine, RiErrorWarningLine } from '@remixicon/react';
import { formatMoneyInt, type OrderRequest } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { exportCsv } from '@/lib/exportCsv';
import { cfError } from '@/lib/cfError';
import { cn } from '@/lib/cn';
import { dateTimeShort, timeAgo } from '@/lib/format';
import { matchesSearch } from '@/lib/search';
import { useSearchStore } from '@/stores/searchStore';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { useCanView } from '@/features/auth/useCanView';
import { noPermissionTitle, useCanDo } from '@/features/auth/useCan';
import { useCustomersList } from '@/features/customers/api/customers';
import { useReturns } from '@/features/settings/api/settings';
import {
  approveReturn,
  countReturns,
  plannedRefundTargetLabel,
  refundAmountPaise,
  rejectReturn,
  returnTabOf,
  useReturnsList,
  type ReturnTab,
} from '../api/returns';

const TABS: { key: ReturnTab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const PAGE = 10;

export function ReturnsListPage() {
  const { data: requests, loading, error } = useReturnsList();
  // Customer names are a nicety here (the request carries the uid), but
  // `customers` is gated on the customers module while this screen is gated on
  // refunds. Rules are not filters — firing the query without the permission
  // fails the listener outright — so a refunds-only sub-admin skips it and sees
  // the uid instead of an empty queue.
  const { data: customers } = useCustomersList(useCanView('customers'));
  // Whether approving actually moves money. Default ON for a missing doc —
  // the same default the settings form and adminApproveOrderRequest apply.
  const { data: returnsSettings } = useReturns();
  const autoRefundToWallet = returnsSettings?.autoRefundToWallet !== false;
  const { query } = useSearchStore();
  const [tab, setTab] = useState<ReturnTab>('pending');
  const [page, setPage] = useState(1);
  const [review, setReview] = useState<OrderRequest | null>(null);
  const [approve, setApprove] = useState<OrderRequest | null>(null);
  const [reject, setReject] = useState<OrderRequest | null>(null);
  // Both adminApproveOrderRequest and adminRejectOrderRequest call
  // requireModule(req, 'refunds', 'approve') — one permission, both decisions.
  const canDecide = useCanDo('refunds', 'approve');

  const counts = useMemo(() => countReturns(requests), [requests]);
  const nameByUid = useMemo(() => new Map(customers.map((c) => [c.uid, c.name])), [customers]);
  const customerName = (r: OrderRequest) => nameByUid.get(r.customerId) ?? r.customerId;

  const rows = useMemo(() => {
    let list = requests.filter((r) => returnTabOf(r.status) === tab);
    if (query.trim()) {
      list = list.filter((r) => matchesSearch(query, [r.shortId, r.orderShortId, customerName(r), r.reasonLabel]));
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, tab, query, nameByUid]);
  const pageRows = paginate(rows, page, PAGE);

  // Keep the open review drawer in sync with live data (status flips after an action).
  const liveReview = review ? requests.find((r) => r.id === review.id) ?? review : null;

  const onExport = () => {
    if (requests.length === 0) return toast.info('Nothing to export.');
    exportCsv(
      'barkath-refunds.csv',
      requests.map((r) => ({
        Request: r.shortId,
        Order: r.orderShortId,
        Customer: customerName(r),
        Reason: r.reasonLabel,
        To: plannedRefundTargetLabel(r, autoRefundToWallet),
        AmountPaise: refundAmountPaise(r),
        Status: r.status,
      })),
    );
    toast.success('Exported refunds.csv');
  };

  const doApprove = async () => {
    if (!approve) return;
    try {
      const res = await approveReturn(approve.id);
      // Only claim a refund when the server actually credited one — with
      // auto-refund to wallet off nothing has been paid yet.
      toast.success(
        res.creditedToWallet
          ? `Refund approved for ${approve.shortId}`
          : `${approve.shortId} approved — pay ${formatMoneyInt(res.amountPaise || refundAmountPaise(approve))} back manually`,
      );
      setApprove(null);
      setReview(null);
    } catch (e) {
      toast.error(cfError(e, 'approve the refund'));
    }
  };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Return requests</h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">
            {counts.pending} pending · {counts.approved} approved · {counts.rejected} rejected
          </p>
        </div>
        <Button variant="primary" className="h-[42px]" onClick={onExport}>Export</Button>
      </div>

      {/* Read error — surfaced instead of a misleading empty state */}
      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-error-subtle bg-error-subtle px-4 py-3">
          <RiErrorWarningLine size={18} className="mt-[1px] shrink-0 text-error" />
          <div className="font-ui text-[13px] text-text-primary">
            <span className="font-bold">Couldn’t load return requests.</span>{' '}
            <span className="text-text-secondary">
              {error.code === 'permission-denied'
                ? 'This account doesn’t have permission to read them — sign in again as an admin.'
                : (error.message ?? 'Please retry in a moment.')}
            </span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex gap-2">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                setPage(1);
              }}
              className={cn(
                'rounded-pill px-3 py-1.5 font-ui text-xs font-bold transition-colors',
                active
                  ? 'bg-brand-primary text-white'
                  : 'border border-border-default bg-surface-card text-text-secondary hover:border-brand-primary hover:text-brand-primary',
              )}
            >
              {t.label} {counts[t.key]}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Request', 'Order', 'Customer', 'Reason', 'To', 'Amount', 'Requested', 'Action'].map((h, i) => (
                <th key={i} className={cn('whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary', h === 'Amount' ? 'text-right' : 'text-left')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && requests.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center font-ui text-[13px] text-text-tertiary">
                  {requests.length === 0
                    ? (error ? 'Return requests couldn’t be loaded.' : 'No return requests yet.')
                    : `No ${tab} requests.`}
                </td>
              </tr>
            ) : (
              pageRows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setReview(r)}
                  className="cursor-pointer hover:bg-surface-app"
                >
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-bold text-text-primary">{r.shortId}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{r.orderShortId}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{customerName(r)}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{r.reasonLabel}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{plannedRefundTargetLabel(r, autoRefundToWallet)}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 text-right font-ui text-[13px] font-bold text-text-primary">{formatMoneyInt(refundAmountPaise(r))}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[12px] text-text-tertiary">{timeAgo(r.createdAt?.toDate?.())}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {returnTabOf(r.status) === 'pending' ? (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={!canDecide}
                          title={canDecide ? undefined : noPermissionTitle('refunds', 'approve')}
                          onClick={() => setApprove(r)}
                        >
                          Approve
                        </Button>
                        <button
                          onClick={() => setReject(r)}
                          disabled={!canDecide}
                          title={canDecide ? undefined : noPermissionTitle('refunds', 'approve')}
                          className="font-ui text-xs font-bold text-error hover:underline disabled:opacity-40 disabled:no-underline"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <Badge tone={returnTabOf(r.status) === 'approved' ? 'success' : 'error'}>
                        {returnTabOf(r.status) === 'approved' ? 'Refunded' : 'Rejected'}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && <Pagination page={page} total={rows.length} pageSize={PAGE} onPage={setPage} noun="requests" />}

      {/* Review drawer — full context for a decision */}
      {liveReview && (
        <ReviewDrawer
          request={liveReview}
          customerName={customerName(liveReview)}
          autoRefundToWallet={autoRefundToWallet}
          canDecide={canDecide}
          onClose={() => setReview(null)}
          onApprove={() => setApprove(liveReview)}
          onReject={() => setReject(liveReview)}
        />
      )}

      {/* Approve confirm — states plainly whether this actually moves money */}
      <ConfirmDialog
        open={!!approve}
        variant="success"
        title="Approve return & refund?"
        body={
          approve ? (
            autoRefundToWallet ? (
              <>
                {formatMoneyInt(refundAmountPaise(approve))} will be credited to{' '}
                <strong className="text-text-primary">{customerName(approve)}</strong>’s{' '}
                {plannedRefundTargetLabel(approve, autoRefundToWallet)} for order {approve.orderShortId}. This cannot be undone.
              </>
            ) : (
              <>
                Auto-refund to wallet is off, so no money moves:{' '}
                {formatMoneyInt(refundAmountPaise(approve))} is recorded as owed to{' '}
                <strong className="text-text-primary">{customerName(approve)}</strong> for order {approve.orderShortId} and you
                must pay it back to their original payment method yourself. This cannot be undone.
              </>
            )
          ) : null
        }
        confirmLabel="Approve & refund"
        onConfirm={doApprove}
        onCancel={() => setApprove(null)}
      />

      {/* Reject with reason */}
      {reject && (
        <RejectModal
          request={reject}
          customerName={customerName(reject)}
          onClose={() => setReject(null)}
          onDone={() => {
            setReject(null);
            setReview(null);
          }}
        />
      )}
    </div>
  );
}

// ── Review drawer ────────────────────────────────────────────────────
function ReviewDrawer({
  request: r,
  customerName,
  autoRefundToWallet,
  canDecide,
  onClose,
  onApprove,
  onReject,
}: {
  request: OrderRequest;
  customerName: string;
  autoRefundToWallet: boolean;
  /** Caller holds `refunds.approve` — the drawer's two buttons are off without it. */
  canDecide: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const pending = returnTabOf(r.status) === 'pending';
  const approved = returnTabOf(r.status) === 'approved';
  const it = r.itemSnapshot;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-full w-full max-w-[440px] flex-col border-l border-border-subtle bg-surface-card shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <RiArrowLeftLine size={16} className="text-brand-primary" />
              <h2 className="font-display text-lg font-extrabold text-text-primary">Return {r.shortId}</h2>
            </div>
            <p className="mt-0.5 font-ui text-[12px] text-text-tertiary">
              Order {r.orderShortId} · requested {timeAgo(r.createdAt?.toDate?.())}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-text-tertiary hover:bg-surface-app hover:text-text-primary">
            <RiCloseLine size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Status */}
          <div className="mb-5 flex items-center gap-2">
            <Badge tone={pending ? 'gold' : approved ? 'success' : 'error'}>
              {pending ? 'Pending review' : approved ? 'Refunded' : 'Rejected'}
            </Badge>
          </div>

          {/* Item */}
          <SectionLabel>Item</SectionLabel>
          <div className="mb-5 rounded-xl border border-border-subtle p-3.5">
            <div className="font-ui text-[14px] font-bold text-text-primary">{it.productName}</div>
            <div className="mt-0.5 font-ui text-[12px] text-text-secondary">
              {[it.variantLabel, `Qty ${it.quantity}`].filter(Boolean).join(' · ')}
            </div>
            <div className="mt-2 font-ui text-[12px] text-text-tertiary">
              Paid {formatMoneyInt(it.priceAtPurchasePaise)} / unit
            </div>
          </div>

          {/* Reason */}
          <SectionLabel>Reason</SectionLabel>
          <div className="mb-5">
            <div className="font-ui text-[14px] font-semibold text-text-primary">{r.reasonLabel}</div>
            {r.note && <p className="mt-1.5 font-ui text-[13px] leading-relaxed text-text-secondary">“{r.note}”</p>}
          </div>

          {/* Customer */}
          <SectionLabel>Customer</SectionLabel>
          <div className="mb-5 font-ui text-[14px] font-semibold text-text-primary">{customerName}</div>

          {/* Refund */}
          <SectionLabel>Refund</SectionLabel>
          <div className="mb-5 rounded-xl border border-border-subtle p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-ui text-[13px] text-text-secondary">Amount</span>
              <span className="font-ui text-[15px] font-extrabold text-text-primary">{formatMoneyInt(refundAmountPaise(r))}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="font-ui text-[13px] text-text-secondary">Destination</span>
              <span className="font-ui text-[13px] font-semibold text-text-primary">{plannedRefundTargetLabel(r, autoRefundToWallet)}</span>
            </div>
            {pending && (
              <p className="mt-3 font-ui text-[12px] leading-relaxed text-text-tertiary">
                {autoRefundToWallet
                  ? 'Approving credits this amount to the customer’s wallet immediately and can’t be undone.'
                  : 'Auto-refund to wallet is off: approving records the refund as owed but moves no money — you pay this amount back to the original payment method yourself. It can’t be undone.'}
              </p>
            )}
            {r.rejectionReason && (
              <p className="mt-3 font-ui text-[12px] leading-relaxed text-error">Rejected: {r.rejectionReason}</p>
            )}
          </div>

          {/* Timeline */}
          {Array.isArray(r.statusHistory) && r.statusHistory.length > 0 && (
            <>
              <SectionLabel>Timeline</SectionLabel>
              <div className="flex flex-col gap-3">
                {r.statusHistory.map((h, i) => (
                  <div key={i} className="flex gap-2.5">
                    <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-primary" />
                    <div>
                      <div className="font-ui text-[13px] font-semibold capitalize text-text-primary">{h.status.replace(/_/g, ' ')}</div>
                      {h.note && <div className="font-ui text-[12px] text-text-secondary">{h.note}</div>}
                      <div className="mt-[1px] font-ui text-[11px] text-text-tertiary">{dateTimeShort(h.at?.toDate?.())}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        {pending && (
          <div className="flex items-center gap-2.5 border-t border-border-subtle px-6 py-4">
            <Button
              variant="primary"
              className="flex-1"
              disabled={!canDecide}
              title={canDecide ? undefined : noPermissionTitle('refunds', 'approve')}
              onClick={onApprove}
            >
              Approve &amp; refund
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              disabled={!canDecide}
              title={canDecide ? undefined : noPermissionTitle('refunds', 'approve')}
              onClick={onReject}
            >
              Reject
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 font-ui text-[10px] font-extrabold uppercase tracking-[0.1em] text-text-tertiary">{children}</div>
  );
}

// ── Reject modal ─────────────────────────────────────────────────────
function RejectModal({
  request,
  customerName,
  onClose,
  onDone,
}: {
  request: OrderRequest;
  customerName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim()) return toast.error('Please add a reason for the customer.');
    try {
      setBusy(true);
      await rejectReturn(request.id, reason.trim());
      toast.success(`${request.shortId} rejected`);
      onDone();
    } catch (e) {
      toast.error(cfError(e, 'reject the request'));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center p-4" style={{ background: 'var(--scrim)' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-[420px] rounded-2xl border border-border-subtle bg-surface-card p-7 shadow-lg">
        <h2 className="font-display text-lg font-extrabold text-text-primary">Reject return {request.shortId}?</h2>
        <p className="mt-1.5 font-ui text-[13px] text-text-secondary">
          {customerName}’s request for order {request.orderShortId} will be declined. They’ll see the reason below.
        </p>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Reason for rejection…"
          className="mt-4 w-full resize-y rounded-lg border border-border-default bg-surface-card px-3 py-2.5 font-ui text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none"
        />
        <div className="mt-4 flex justify-end gap-2.5">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>Reject request</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
