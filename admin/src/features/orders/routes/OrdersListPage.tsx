import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RiEyeLine, RiFileCopyLine } from '@remixicon/react';
import { formatMoneyInt, type AdminOrderTab, type Order } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Badge, OrderStatusBadge } from '@/components/ui/StatusBadge';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { exportCsv } from '@/lib/exportCsv';
import { cn } from '@/lib/cn';
import { matchesSearch } from '@/lib/search';
import { useSearchStore } from '@/stores/searchStore';
// One definition of "COD / Wallet / Online" for the whole panel — the payments
// screen owns it, and a second copy here would inevitably drift.
import { methodLabel } from '@/features/payments/api/payments';
import {
  ORDER_TABS,
  countByTab,
  paymentPill,
  tabOf,
  useOrdersList,
} from '../api/orders';

const PAGE = 10;

export function OrdersListPage() {
  const navigate = useNavigate();
  const { data: orders, loading, error } = useOrdersList();
  const { query } = useSearchStore();
  const [tab, setTab] = useState<AdminOrderTab>('all');
  const [page, setPage] = useState(1);

  const counts = useMemo(() => countByTab(orders), [orders]);
  const pending = useMemo(
    () => orders.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled').length,
    [orders],
  );
  const rows = useMemo(() => {
    let list = tab === 'all' ? orders : orders.filter((o) => tabOf(o.status) === tab);
    if (query.trim()) list = list.filter((o) => matchesSearch(query, [o.shortId, o.customerName], o.searchIndex));
    return list;
  }, [orders, tab, query]);
  const pageRows = paginate(rows, page, PAGE);

  const onExport = () => {
    if (orders.length === 0) return toast.info('Nothing to export.');
    exportCsv(
      'barkath-orders.csv',
      orders.map((o) => ({
        Order: o.shortId,
        Customer: o.customerName,
        Items: o.itemsCount,
        // Method and payment state are separate facts: the pill collapses them
        // ("Paid" for a settled COD order), which loses the only record that the
        // order was collected in cash. COD is closed to new orders but the
        // historical rows still have to reconcile against the cash book.
        Method: methodLabel(o.paymentMethod),
        Payment: paymentPill(o).label,
        Status: o.status,
        CodSurchargePaise: o.codSurchargePaise ?? 0,
        TotalPaise: o.totalPaise,
      })),
    );
    toast.success('Exported orders.csv');
  };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Orders</h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">
            {orders.length.toLocaleString('en-IN')} orders · {pending} pending
          </p>
        </div>
        <Button variant="outline" className="h-[42px]" onClick={onExport}>
          Export
        </Button>
      </div>

      {/* Status tabs (chips) */}
      <div className="mb-4 flex flex-wrap gap-2">
        {ORDER_TABS.map((t) => {
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
              {t.label} {counts[t.key].toLocaleString('en-IN')}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Order', 'Customer', 'Items', 'Payment', 'Status', 'Total', ''].map((h, i) => (
                <th
                  key={i}
                  className={cn(
                    'whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary',
                    h === 'Total' ? 'text-right' : 'text-left',
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && orders.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center font-ui text-[13px] text-text-tertiary">
                  {/* A failed read leaves data empty, which used to read as
                      "No orders yet." — say the read failed instead. */}
                  {error
                    ? error.code === 'permission-denied'
                      ? 'Couldn’t load orders — this account doesn’t have permission to read them. Sign in again as an admin.'
                      : 'Couldn’t load orders. Please retry in a moment.'
                    : orders.length === 0
                      ? 'No orders yet.'
                      : 'No orders in this tab.'}
                </td>
              </tr>
            ) : (
              pageRows.map((o) => {
                const pay = paymentPill(o);
                return (
                  <tr
                    key={o.id}
                    onClick={() => navigate(`/orders/${o.id}`)}
                    className="cursor-pointer transition-colors hover:bg-surface-app"
                  >
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-bold text-text-primary">
                      {o.shortId}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                      {o.customerName}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                      {o.itemsCount}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                      <Badge tone={pay.tone}>{pay.label}</Badge>
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 text-right font-ui text-[13px] font-bold text-text-primary">
                      {formatMoneyInt(o.totalPaise)}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                      <DropdownMenu
                        items={[
                          { label: 'View order', icon: <RiEyeLine size={15} />, onClick: () => navigate(`/orders/${o.id}`) },
                          {
                            label: 'Copy order ID',
                            icon: <RiFileCopyLine size={15} />,
                            onClick: () => {
                              void navigator.clipboard?.writeText(o.shortId);
                              toast.success(`${o.shortId} copied`);
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

      {rows.length > 0 && <Pagination page={page} total={rows.length} pageSize={PAGE} onPage={setPage} noun="orders" />}
    </div>
  );
}
