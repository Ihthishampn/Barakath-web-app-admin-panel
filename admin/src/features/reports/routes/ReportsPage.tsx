import { useState } from 'react';
import { formatMoneyCompact } from '@barkath/shared';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import {
  computeKpis,
  computeTopProducts,
  computeTrend,
  downloadReportCsv,
  rangeLabel,
  REPORT_RANGES,
  useReportCustomers,
  useReportOrders,
  useReportOrderRequests,
  useReportProducts,
  type ReportRange,
} from '../api/reports';

const TREND_BAR =
  'w-full rounded-t-[6px] bg-gradient-to-b from-brand-primary to-brand-primary-dark';

/** KPI card — matches the prototype exactly (rounded-xl, p-4). */
function KpiStat({
  label,
  value,
  delta,
  tone,
  loading,
}: {
  label: string;
  value: string;
  delta: string;
  tone: 'success' | 'error' | 'muted';
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-card p-4">
      <div className="font-ui text-xs font-medium text-text-tertiary">{label}</div>
      <div className="mt-[9px] font-display text-2xl font-extrabold leading-none text-text-primary">
        {loading ? <span className="text-text-tertiary">—</span> : value}
      </div>
      <div
        className={cn(
          'mt-[7px] font-ui text-[11px] font-bold',
          tone === 'success' && 'text-success',
          tone === 'error' && 'text-error',
          tone === 'muted' && 'text-text-tertiary',
        )}
      >
        {delta}
      </div>
    </div>
  );
}

const fmtDelta = (pct: number | null): { text: string; tone: 'success' | 'error' | 'muted' } =>
  pct == null
    ? { text: 'vs previous period', tone: 'muted' }
    : { text: `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}%`, tone: pct >= 0 ? 'success' : 'error' };

export function ReportsPage() {
  const [range, setRange] = useState<ReportRange>('12M');
  const orders = useReportOrders();
  const products = useReportProducts();
  const customers = useReportCustomers();
  const requests = useReportOrderRequests();

  const loading = orders.loading || products.loading || customers.loading || requests.loading;
  // A failed read settles with `loading: false` and an empty array, so every
  // figure on this page used to render as a confident ₹0 / 0 orders / 0% refunds
  // — indistinguishable from a genuinely empty shop — and Export CSV happily
  // wrote those zeros to a file the finance team then works from. An errored read
  // is "unknown", not "zero": it keeps the same "—" placeholder the cards already
  // show while loading, and the export stays disabled until real data lands.
  const readFailed =
    orders.error != null || products.error != null || customers.error != null || requests.error != null;
  const unavailable = loading || readFailed;

  const kpis = computeKpis(orders.data, customers.data, requests.data, range);
  const trend = computeTrend(orders.data, range);
  const top = computeTopProducts(orders.data, products.data, range);

  const revenueDelta = fmtDelta(kpis.revenueDeltaPct);
  const ordersDelta = fmtDelta(kpis.ordersDeltaPct);
  const customersDelta = fmtDelta(kpis.customersDeltaPct);
  // Refund rate is inverted: a *falling* rate is the positive outcome.
  const refundDelta =
    kpis.refundRateDeltaPp == null
      ? { text: 'vs previous period', tone: 'muted' as const }
      : {
          text: `${kpis.refundRateDeltaPp <= 0 ? '▼' : '▲'} ${Math.abs(kpis.refundRateDeltaPp)}%`,
          tone: kpis.refundRateDeltaPp <= 0 ? ('success' as const) : ('error' as const),
        };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold leading-tight tracking-[-0.02em] text-text-primary">
            Reports &amp; Analytics
          </h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">{rangeLabel(range)}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            className="h-[42px]"
            onClick={() => downloadReportCsv(range, kpis, trend, top)}
            disabled={unavailable}
          >
            Export CSV
          </Button>
          {/* Date-range preset control */}
          <div className="flex gap-1.5">
            {REPORT_RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  'rounded-pill px-3 py-2 font-ui text-[13px] transition-colors',
                  range === r
                    ? 'bg-brand-primary font-bold text-white'
                    : 'border border-border-default font-semibold text-text-tertiary hover:border-brand-primary hover:text-brand-primary',
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-4 gap-4">
        <KpiStat
          label="Total revenue"
          value={formatMoneyCompact(kpis.totalRevenuePaise)}
          delta={revenueDelta.text}
          tone={revenueDelta.tone}
          loading={unavailable}
        />
        <KpiStat
          label="Orders"
          value={kpis.orders.toLocaleString('en-IN')}
          delta={ordersDelta.text}
          tone={ordersDelta.tone}
          loading={unavailable}
        />
        <KpiStat
          label="New customers"
          value={kpis.newCustomers.toLocaleString('en-IN')}
          delta={customersDelta.text}
          tone={customersDelta.tone}
          loading={unavailable}
        />
        <KpiStat
          label="Refund rate"
          value={`${kpis.refundRatePct}%`}
          delta={refundDelta.text}
          tone={refundDelta.tone}
          loading={unavailable}
        />
      </div>

      {/* Revenue trend + Top products */}
      <div className="grid grid-cols-[2fr_1fr] gap-4">
        {/* Revenue by month */}
        <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
          <div className="mb-[18px] font-display text-[15px] font-bold text-text-primary">
            {range === '12M' ? 'Revenue by month' : 'Revenue trend'}
          </div>
          <div className="flex h-[200px] items-end gap-2.5">
            {unavailable ? (
              <div className="flex h-full flex-1 items-center justify-center font-ui text-[13px] text-text-tertiary">
                —
              </div>
            ) : (
              trend.map((b, i) => (
                <div key={i} className="flex h-full flex-1 items-end" title={formatMoneyCompact(b.paise)}>
                  <div className={TREND_BAR} style={{ height: `${b.heightPct}%` }} />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Top products */}
        <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
          <div className="mb-4 font-display text-[15px] font-bold text-text-primary">Top products</div>
          {/* "No sales data yet" is a statement of fact, so it waits for a read
              that actually succeeded. */}
          {unavailable ? (
            <p className="py-8 text-center font-ui text-[13px] text-text-tertiary">—</p>
          ) : top.length === 0 ? (
            <p className="py-8 text-center font-ui text-[13px] text-text-tertiary">No sales data yet</p>
          ) : (
            top.map((p) => (
              <div
                key={p.productId}
                className="flex items-center gap-3 border-b border-border-subtle py-[9px] last:border-0"
              >
                <span className="w-4 font-display text-xs font-extrabold text-text-tertiary">
                  {p.rank}
                </span>
                <span className="flex-1 font-ui text-[13px] font-semibold text-text-primary">
                  {p.name}
                </span>
                <span className="font-display text-[13px] font-extrabold text-brand-gold-strong">
                  {formatMoneyCompact(p.revenuePaise)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
