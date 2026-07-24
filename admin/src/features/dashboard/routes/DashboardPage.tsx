import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoneyCompact, formatMoneyInt, type Order } from '@barkath/shared';
import { cn } from '@/lib/cn';
import { OrderStatusBadge, Badge } from '@/components/ui/StatusBadge';
import { KpiCard } from '../components/KpiCard';
import { QuickActions } from '../components/QuickActions';
import {
  categoryPerformance,
  lowStockRows,
  useDashboardKpis,
  useProducts,
  useRecentOrders,
  useRevenueTrend,
  type CategoryPerfRow,
  type TrendBar,
  type TrendRange,
} from '../api/dashboard';

const TREND_RANGES: TrendRange[] = ['12M', '30D', '7D'];

const TREND_BAR = 'rounded-t-[6px] bg-gradient-to-b from-brand-primary to-brand-primary-dark';
const CAT_FILL: Record<CategoryPerfRow['token'], string> = {
  brand: 'bg-brand-primary',
  gold: 'bg-brand-gold',
  info: 'bg-info',
  success: 'bg-success',
};

export function DashboardPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<TrendRange>('12M');
  const kpis = useDashboardKpis();
  const recent = useRecentOrders(5);
  const products = useProducts();
  const trend = useRevenueTrend(range);

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const k = kpis.data;
  // A failed read must never render as a confident "0" / "all clear": the KPI
  // block used to print `k?.x ?? 0`, so a Firestore FAILED_PRECONDITION (missing
  // aggregation index) showed ₹0 revenue and 0 pending orders on a live shop.
  // `KpiCard` already renders the neutral "—" placeholder while it has no value,
  // so an errored read reuses exactly that state — no new UI.
  const kpisUnavailable = kpis.isLoading || kpis.isError;
  // Same rule for the trend: it used to synthesise 12 bars of 6%, 13%, 20% … 83%
  // whenever `trend.data` was absent, i.e. a smooth upward revenue curve painted
  // in the real bar gradient while the query was in flight — and left on screen
  // for good once it failed. There is no honest bar to draw without data, so the
  // chart shows the same neutral "—" placeholder the KPI cards do.
  const trendUnavailable = trend.isLoading || trend.isError;
  const trendBars: TrendBar[] = trendUnavailable ? [] : (trend.data ?? []);
  const lowStock = lowStockRows(products.data);
  const cats = categoryPerformance();

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold leading-tight tracking-[-0.02em] text-text-primary">
            Dashboard
          </h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">{today} · Live overview</p>
        </div>
        <QuickActions />
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-4 gap-4">
        <KpiCard
          label="Today's revenue"
          value={formatMoneyCompact(k?.todayRevenuePaise ?? 0)}
          loading={kpisUnavailable}
          delta={
            kpis.isError
              ? undefined
              : k?.revenueDeltaPct == null
                ? 'vs yesterday'
                : `${k.revenueDeltaPct >= 0 ? '▲' : '▼'} ${Math.abs(k.revenueDeltaPct)}% vs yesterday`
          }
          deltaTone={k?.revenueDeltaPct == null ? 'muted' : k.revenueDeltaPct >= 0 ? 'success' : 'error'}
        />
        <KpiCard
          label="Total orders"
          value={(k?.totalOrders ?? 0).toLocaleString('en-IN')}
          loading={kpisUnavailable}
          delta={
            kpis.isError
              ? undefined
              : k?.ordersWeekDeltaPct == null
                ? `▲ ${k?.ordersToday ?? 0} today`
                : `${k.ordersWeekDeltaPct >= 0 ? '▲' : '▼'} ${Math.abs(k.ordersWeekDeltaPct)}% this week`
          }
          deltaTone={k?.ordersWeekDeltaPct == null ? 'success' : k.ordersWeekDeltaPct >= 0 ? 'success' : 'error'}
        />
        <KpiCard
          label="Pending orders"
          value={String(k?.pendingOrders ?? 0)}
          loading={kpisUnavailable}
          delta={
            kpis.isError ? undefined : (k?.pendingOrders ?? 0) > 0 ? '▼ needs action' : 'all clear'
          }
          deltaTone={(k?.pendingOrders ?? 0) > 0 ? 'error' : 'success'}
        />
        <KpiCard
          label="Avg order value"
          value={formatMoneyInt(k?.avgOrderValuePaise ?? 0)}
          loading={kpisUnavailable}
          delta={
            kpis.isError
              ? undefined
              : k?.aovMonthDeltaPct == null
                ? `across ${(k?.totalOrders ?? 0).toLocaleString('en-IN')} orders`
                : `${k.aovMonthDeltaPct >= 0 ? '▲' : '▼'} ${Math.abs(k.aovMonthDeltaPct)}% this month`
          }
          deltaTone={k?.aovMonthDeltaPct == null ? 'muted' : k.aovMonthDeltaPct >= 0 ? 'success' : 'error'}
        />
      </div>

      {/* Trend + Category performance */}
      <div className="grid grid-cols-[2fr_1fr] gap-4">
        {/* Revenue trend */}
        <div className="rounded-md border border-border-subtle bg-surface-card p-5">
          <div className="mb-[18px] flex items-center justify-between">
            <div className="font-display text-[15px] font-bold text-text-primary">Revenue trend</div>
            <div className="flex gap-1.5">
              {TREND_RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={cn(
                    'rounded-pill px-2.5 py-1 font-ui text-[11px] transition-colors',
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
          <div className="flex h-[180px] items-end gap-2.5">
            {trendUnavailable ? (
              <div className="flex h-full flex-1 items-center justify-center font-ui text-[13px] text-text-tertiary">
                —
              </div>
            ) : (
              trendBars.map((b, i) => (
                <div key={i} className="flex h-full flex-1 flex-col justify-end" title={formatMoneyInt(b.paise)}>
                  <div className={TREND_BAR} style={{ height: `${b.heightPct}%` }} />
                </div>
              ))
            )}
          </div>
          <div className="mt-2.5 flex justify-between font-ui text-[10px] font-medium text-text-tertiary">
            {trendBars.map((b, i) => (
              <span key={i} className="flex-1 text-center">
                {b.label}
              </span>
            ))}
          </div>
        </div>

        {/* Category performance */}
        <div className="rounded-md border border-border-subtle bg-surface-card p-5">
          <div className="mb-4 font-display text-[15px] font-bold text-text-primary">
            Category performance
          </div>
          {/* Same treatment as the sibling panels: an empty list means "nothing
              sold in the window", so it must not be shown until the read that
              decides that has actually landed. */}
          {!products.categorySourcesReady ? (
            <p className="py-8 text-center font-ui text-xs text-text-tertiary">—</p>
          ) : cats.length === 0 ? (
            <p className="py-8 text-center font-ui text-xs text-text-tertiary">
              No sales in this period
            </p>
          ) : (
            cats.map((c) => (
              <div key={c.key} className="mb-3.5 last:mb-0">
                <div className="mb-1.5 flex justify-between font-ui text-xs font-semibold text-text-secondary">
                  <span>{c.label}</span>
                  <span className="font-bold text-text-primary">{c.pct}%</span>
                </div>
                <div className="h-[7px] overflow-hidden rounded-pill bg-neutral-200">
                  <div className={`h-full rounded-pill ${CAT_FILL[c.token]}`} style={{ width: `${c.pct}%` }} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Recent orders + Low stock */}
      <div className="mt-4 grid grid-cols-[2fr_1fr] gap-4">
        <div>
          <div className="mb-3 font-display text-sm font-bold text-text-primary">Recent orders</div>
          <div className="overflow-hidden rounded-md border border-border-subtle bg-surface-card">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Order', 'Customer', 'Status', 'Total'].map((h, i) => (
                    <th
                      key={h}
                      className={`border-b border-border-subtle px-4 py-3 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary ${
                        i === 3 ? 'text-right' : 'text-left'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.loading && recent.data.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center font-ui text-[13px] text-text-tertiary">
                      Loading…
                    </td>
                  </tr>
                ) : recent.data.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center font-ui text-[13px] text-text-tertiary">
                      No orders yet
                    </td>
                  </tr>
                ) : (
                  recent.data.map((o: Order) => (
                    <tr
                      key={o.id}
                      onClick={() => navigate(`/orders/${o.id}`)}
                      className="cursor-pointer transition-colors hover:bg-surface-app"
                    >
                      <td className="border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-bold text-text-primary">
                        {o.shortId}
                      </td>
                      <td className="border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                        {o.customerName}
                      </td>
                      <td className="border-b border-border-subtle px-4 py-3">
                        <OrderStatusBadge status={o.status} />
                      </td>
                      <td className="border-b border-border-subtle px-4 py-3 text-right font-ui text-[13px] font-bold text-text-primary">
                        {formatMoneyInt(o.totalPaise)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="mb-3 font-display text-sm font-bold text-text-primary">Low stock alerts</div>
          <div className="rounded-md border border-border-subtle bg-surface-card py-1.5">
            {/* "No low-stock alerts" is an all-clear, so it may only be shown for
                a products snapshot that actually arrived — `useLiveCollection`
                keeps `data: []` when the listener errors. */}
            {products.loading || products.error ? (
              <p className="px-4 py-8 text-center font-ui text-xs text-text-tertiary">—</p>
            ) : lowStock.length === 0 ? (
              <p className="px-4 py-8 text-center font-ui text-xs text-text-tertiary">
                No low-stock alerts
              </p>
            ) : (
              lowStock.map((r) => (
                <button
                  key={r.key}
                  onClick={() => navigate('/inventory')}
                  className="flex w-full items-center justify-between border-b border-border-subtle px-4 py-[11px] text-left last:border-0 hover:bg-surface-app"
                >
                  <span className="font-ui text-xs font-semibold text-text-primary">{r.name}</span>
                  <Badge tone="error">{r.left} left</Badge>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
