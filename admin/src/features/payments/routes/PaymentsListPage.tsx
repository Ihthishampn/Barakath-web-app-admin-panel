import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RiErrorWarningLine, RiEyeLine, RiFileCopyLine } from '@remixicon/react';
import { formatMoneyCompact, formatMoneyInt, type Payment } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/StatusBadge';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { cap } from '@/lib/format';
import { exportCsv } from '@/lib/exportCsv';
import { cn } from '@/lib/cn';
import { matchesSearch } from '@/lib/search';
import { useSearchStore } from '@/stores/searchStore';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { useOrdersList } from '@/features/orders/api/orders';
import { useTax } from '@/features/settings/api/settings';
import { effectivePaymentStatus, methodLabel, netAmountPaise, paymentStatusPill, usePaymentsList } from '../api/payments';

const PAGE = 10;

/** CSV money: plain rupees with paise, never raw paise — accountants import this. */
const rupees = (paise: number) => ((paise ?? 0) / 100).toFixed(2);
/** CSV date: unambiguous dd/mm/yyyy, the format Indian filing tools expect. */
const csvDate = (d: Date | undefined) => (d ? d.toLocaleDateString('en-GB') : '');

export function PaymentsListPage() {
  const navigate = useNavigate();
  const { data: payments, loading, error } = usePaymentsList();
  const { data: orders } = useOrdersList();
  const { data: tax } = useTax();
  const { query } = useSearchStore();
  const [page, setPage] = useState(1);

  // The whole order, not just its shortId: the settled-COD rule and the GST
  // export both need the order's status, date, customer and tax breakdown.
  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);
  const statusOf = (p: Payment) => effectivePaymentStatus(p, orderById.get(p.orderId));

  const stats = useMemo(() => {
    const now = new Date();
    let monthTotal = 0;
    let failed = 0;
    for (const p of payments) {
      const status = statusOf(p);
      if (status === 'failed') failed++;
      // Money the store actually kept: collected rows (including delivered COD)
      // less anything refunded back out of them.
      if (status === 'captured' || status === 'partial_refund') {
        const d = p.createdAt?.toDate?.();
        if (d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) monthTotal += netAmountPaise(p);
      }
    }
    return { monthTotal, failed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, orderById]);

  const orderLabel = (p: Payment) => orderById.get(p.orderId)?.shortId ?? p.orderId;

  const rows = useMemo(() => {
    if (!query.trim()) return payments;
    return payments.filter((p) =>
      matchesSearch(query, [p.gatewayRef ?? p.id, orderLabel(p), methodLabel(p.method), statusOf(p)]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, query, orderById]);
  const pageRows = paginate(rows, page, PAGE);

  const onExport = (gst = false) => {
    // A GST filing needs every sale the store collected — delivered COD very
    // much included — and never a payment that was refunded in full.
    const rows = gst
      ? payments.filter((p) => statusOf(p) === 'captured' || statusOf(p) === 'partial_refund')
      : payments;
    if (rows.length === 0) return toast.info('Nothing to export.');
    exportCsv(
      gst ? 'barkath-gst-invoices.csv' : 'barkath-payments.csv',
      gst
        ? rows.map((p) => {
            const o = orderById.get(p.orderId);
            const totalPaise = o?.totalPaise ?? p.amountPaise;
            const taxPaise = o?.taxPaise ?? 0;
            return {
              // The order's shortId is the invoice serial the customer-facing
              // invoice (functions/src/orders/invoice.ts) prints, so the export
              // and the document agree.
              InvoiceNo: o?.shortId ?? p.orderId,
              InvoiceDate: csvDate(o?.placedAt?.toDate?.() ?? p.createdAt?.toDate?.()),
              Customer: o?.customerName ?? '',
              // Destination state decides the CGST/SGST vs IGST split; the split
              // itself is left to the filing tool because settings/tax records
              // the supplier's city and country but not its state.
              PlaceOfSupply: o?.deliveryAddress?.state ?? '',
              SupplierGSTIN: tax?.gstin ?? '',
              TaxableValue: rupees(Math.max(0, totalPaise - taxPaise)),
              GSTRate: ((tax?.gstRate ?? 0) * 100).toFixed(2),
              TaxAmount: rupees(taxPaise),
              InvoiceTotal: rupees(totalPaise),
              // Credit-note value: an approved return reduces what was kept, but
              // the invoice itself still stands at its original amount.
              RefundedAmount: rupees(p.amountPaise - netAmountPaise(p)),
              PaymentMethod: methodLabel(p.method),
              TxnID: p.gatewayRef ?? p.id,
            };
          })
        : rows.map((p) => ({
            TxnID: p.gatewayRef ?? p.id,
            Order: orderLabel(p),
            Method: methodLabel(p.method),
            Gateway: p.gateway ? cap(p.gateway) : '',
            Status: statusOf(p),
            AmountPaise: p.amountPaise,
          })),
    );
    toast.success(gst ? 'Exported gst-invoices.csv' : 'Exported payments.csv');
  };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Payments</h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">
            {formatMoneyCompact(stats.monthTotal)} this month · {stats.failed} failed
          </p>
        </div>
        <div className="flex gap-2.5">
          <Button variant="outline" className="h-[42px]" onClick={() => onExport(true)}>GST invoices</Button>
          <Button variant="primary" className="h-[42px]" onClick={() => onExport(false)}>Export</Button>
        </div>
      </div>

      {/* Read error — surfaced instead of an empty state that reads as "₹0 taken" */}
      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-error-subtle bg-error-subtle px-4 py-3">
          <RiErrorWarningLine size={18} className="mt-[1px] shrink-0 text-error" />
          <div className="font-ui text-[13px] text-text-primary">
            <span className="font-bold">Couldn’t load payments.</span>{' '}
            <span className="text-text-secondary">
              {error.code === 'permission-denied'
                ? 'This account doesn’t have permission to read them — sign in again as an admin.'
                : (error.message ?? 'Please retry in a moment.')}
            </span>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Txn ID', 'Order', 'Method', 'Gateway', 'Status', 'Amount', ''].map((h, i) => (
                <th key={i} className={cn('whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary', h === 'Amount' ? 'text-right' : 'text-left')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && payments.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center font-ui text-[13px] text-text-tertiary">{payments.length === 0 ? (error ? 'Payments couldn’t be loaded.' : 'No payments yet.') : `No payments match “${query}”.`}</td></tr>
            ) : (
              pageRows.map((p) => {
                const pill = paymentStatusPill(statusOf(p));
                return (
                  <tr key={p.id} className="hover:bg-surface-app">
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-bold text-text-primary">{p.gatewayRef ?? p.id}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{orderLabel(p)}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{methodLabel(p.method)}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{p.gateway ? cap(p.gateway) : '—'}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3"><Badge tone={pill.tone}>{pill.label}</Badge></td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 text-right font-ui text-[13px] font-bold text-text-primary">{formatMoneyInt(p.amountPaise)}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                      <DropdownMenu
                        items={[
                          { label: 'View order', icon: <RiEyeLine size={15} />, onClick: () => navigate(`/orders/${p.orderId}`) },
                          {
                            label: 'Copy txn ID',
                            icon: <RiFileCopyLine size={15} />,
                            onClick: () => {
                              void navigator.clipboard?.writeText(p.gatewayRef ?? p.id);
                              toast.success('Txn ID copied');
                            },
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && <Pagination page={page} total={rows.length} pageSize={PAGE} onPage={setPage} noun="payments" />}
    </div>
  );
}
