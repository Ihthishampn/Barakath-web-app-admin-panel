import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RiEqualizerLine, RiEyeLine, RiHistoryLine } from '@remixicon/react';
import { Button } from '@/components/ui/Button';
import { noPermissionTitle, useCanDo } from '@/features/auth/useCan';
import { Badge } from '@/components/ui/StatusBadge';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { exportCsv } from '@/lib/exportCsv';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { matchesSearch } from '@/lib/search';
import { useSearchStore } from '@/stores/searchStore';
import { buildSkuRows, stockStats, stockStatus, useInventoryProducts } from '../api/inventory';
import { StockHistoryModal } from '../components/StockHistoryModal';

const PAGE = 10;

/**
 * Page buttons with ellipsis truncation (design: `1 2 3 … 25`).
 * Shows a 3-page window around the current page, always anchored by page 1 and
 * the last page, with `…` bridging any gap.
 */
function pageItems(current: number, total: number): (number | '…')[] {
  if (total <= 6) return Array.from({ length: total }, (_, i) => i + 1);
  const items: (number | '…')[] = [];
  const end = Math.min(total, Math.max(1, current - 1) + 2);
  const start = Math.max(1, end - 2);
  if (start > 1) items.push(1);
  if (start > 2) items.push('…');
  for (let i = start; i <= end; i++) items.push(i);
  if (end < total - 1) items.push('…');
  if (end < total) items.push(total);
  return items;
}

export function InventoryListPage() {
  const navigate = useNavigate();
  const { data: products, loading } = useInventoryProducts();
  const { query } = useSearchStore();
  const [page, setPage] = useState(1);
  // adminAdjustStock calls requireModule(req, 'inventory', 'edit').
  const canAdjust = useCanDo('inventory', 'edit');
  const [history, setHistory] = useState<{ productId: string; productName: string } | null>(null);

  const allRows = useMemo(() => buildSkuRows(products), [products]);
  const rows = useMemo(
    () => (query.trim() ? allRows.filter((r) => matchesSearch(query, [r.productName, r.sku, r.variantLabel])) : allRows),
    [allRows, query],
  );
  const stats = stockStats(allRows);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * PAGE;
  const pageRows = rows.slice(start, start + PAGE);

  const onExport = () => {
    if (rows.length === 0) return toast.info('Nothing to export.');
    exportCsv(
      'barkath-inventory.csv',
      rows.map((r) => ({
        Product: r.productName,
        SKU: r.sku,
        Variant: r.variantLabel,
        InStock: r.stock,
        Status: stockStatus(r).label,
      })),
    );
    toast.success('Exported inventory.csv');
  };

  return (
    <div className="px-7 py-6">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Inventory</h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">
            Stock levels across {products.length} products
          </p>
        </div>
        <div className="flex gap-2.5">
          <Button
            variant="outline"
            className="h-[42px]"
            disabled={!canAdjust}
            title={canAdjust ? undefined : noPermissionTitle('inventory', 'edit')}
            onClick={() => navigate('/inventory/adjust')}
          >
            Adjust stock
          </Button>
          <Button variant="primary" className="h-[42px]" onClick={onExport}>
            Export
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="mb-4 grid grid-cols-4 gap-4">
        <StatCard label="In stock" value={stats.inStock} tone="text-success" />
        <StatCard label="Low stock" value={stats.low} tone="text-brand-gold-strong" />
        <StatCard label="Out of stock" value={stats.out} tone="text-error" />
        <StatCard label="Total SKUs" value={stats.total} tone="text-text-primary" />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-md border border-border-subtle bg-surface-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Product', 'SKU', 'Variant', 'In stock', 'Status', 'Updated', ''].map((h, i) => (
                <th key={i} className="whitespace-nowrap border-b border-border-subtle px-4 py-3 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">Loading…</td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">{allRows.length === 0 ? 'No SKUs yet.' : `No SKUs match “${query}”.`}</td></tr>
            ) : (
              pageRows.map((r) => {
                const st = stockStatus(r);
                return (
                  <tr key={r.key} className="hover:bg-surface-app">
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-bold text-text-primary">{r.productName}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{r.sku}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{r.variantLabel}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{r.stock}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3"><Badge tone={st.tone}>{st.label}</Badge></td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-tertiary">{timeAgo(r.updatedAt?.toDate())}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                      <DropdownMenu
                        items={[
                          { label: 'Adjust stock', icon: <RiEqualizerLine size={15} />, disabled: !canAdjust, onClick: () => navigate('/inventory/adjust') },
                          { label: 'View product', icon: <RiEyeLine size={15} />, onClick: () => navigate(`/products/${r.productId}`) },
                          { label: 'View stock history', icon: <RiHistoryLine size={15} />, onClick: () => setHistory({ productId: r.productId, productName: r.productName }) },
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

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between">
        <span className="font-ui text-xs font-medium text-text-tertiary">
          {rows.length === 0 ? 'No results' : `Showing ${start + 1}–${Math.min(start + PAGE, rows.length)} of ${rows.length}`}
        </span>
        <div className="flex gap-1.5">
          <PageBtn label="‹" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={current === 1} />
          {pageItems(current, pageCount).map((n, i) =>
            n === '…' ? (
              <span
                key={`gap-${i}`}
                className="inline-flex h-8 min-w-8 items-center justify-center font-ui text-xs font-bold text-text-tertiary"
              >
                …
              </span>
            ) : (
              <PageBtn key={n} label={String(n)} active={n === current} onClick={() => setPage(n)} />
            ),
          )}
          <PageBtn label="›" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={current === pageCount} />
        </div>
      </div>

      {history && (
        <StockHistoryModal
          productId={history.productId}
          productName={history.productName}
          onClose={() => setHistory(null)}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-card p-4">
      <div className="font-ui text-xs font-medium text-text-tertiary">{label}</div>
      <div className={cn('mt-2.5 font-display text-2xl font-extrabold leading-none', tone)}>
        {value.toLocaleString('en-IN')}
      </div>
    </div>
  );
}

function PageBtn({ label, active, disabled, onClick }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center rounded-[7px] border px-2 font-ui text-xs font-bold disabled:opacity-40',
        active ? 'border-brand-primary bg-brand-primary text-white' : 'border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-app',
      )}
    >
      {label}
    </button>
  );
}
