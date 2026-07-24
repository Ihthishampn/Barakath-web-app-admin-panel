import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RiCloseLine, RiEditLine, RiPauseLine, RiPlayLine, RiDeleteBinLine } from '@remixicon/react';
import { formatMoneyInt, type Coupon } from '@barkath/shared';
import { Badge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { noPermissionTitle, useCan } from '@/features/auth/useCan';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { dateShort } from '@/lib/format';
import { matchesSearch } from '@/lib/search';
import { useSearchStore } from '@/stores/searchStore';
import {
  deleteCoupon,
  deriveCouponStatus,
  setCouponActive,
  useCouponsList,
  type CouponBadgeTone,
} from '../api/coupons';

// Matches the prototype pager ("Showing 1–10 of …").
const COUPONS_PAGE_SIZE = 10;

const BADGE_TONE: Record<CouponBadgeTone, Parameters<typeof Badge>[0]['tone']> = {
  success: 'success',
  gold: 'gold',
  error: 'error',
  neutral: 'neutral',
};

/** "₹30 off" · "25% off" · "Free ship" (prototype Type column). */
function typeLabel(c: Coupon): string {
  if (c.discountType === 'percent') return `${c.discountPercent}% off`;
  if (c.discountType === 'free_shipping') return 'Free ship';
  return `${formatMoneyInt(c.discountValuePaise)} off`;
}

/** Max-discount cell: flat = its own value, percent = the cap, free ship = —. */
function maxDiscLabel(c: Coupon): string {
  if (c.discountType === 'flat') return formatMoneyInt(c.discountValuePaise);
  if (c.discountType === 'percent') {
    return c.discountMaxCapPaise != null ? formatMoneyInt(c.discountMaxCapPaise) : '—';
  }
  return '—';
}

const HEADERS = ['Code', 'Type', 'Min cart', 'Max disc', 'Used', 'Expiry', 'Status', ''];

export function CouponsListPage() {
  const navigate = useNavigate();
  const { data: coupons, loading, error } = useCouponsList();
  const { query } = useSearchStore();
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState<Coupon | null>(null);
  // Coupons are a direct, rules-gated client write, so `canWrite('coupons')`
  // decides these — not a callable's error message.
  const can = useCan();
  const canCreate = can('coupons', 'create');
  const canEdit = can('coupons', 'edit');
  const canDelete = can('coupons', 'delete');

  const filtered = useMemo(
    () =>
      coupons.filter((c) =>
        query.trim() ? matchesSearch(query, [c.code, c.title], c.searchIndex) : true,
      ),
    [coupons, query],
  );

  const activeCount = coupons.filter((c) => deriveCouponStatus(c).label === 'Active').length;
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / COUPONS_PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * COUPONS_PAGE_SIZE;
  const rows = filtered.slice(start, start + COUPONS_PAGE_SIZE);

  const onDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteCoupon(toDelete.id);
      toast.success(`${toDelete.code} deleted`);
      setToDelete(null);
    } catch {
      toast.error(`Could not delete ${toDelete.code}.`);
    }
  };

  const onToggleActive = async (c: Coupon) => {
    try {
      await setCouponActive(c.id, !c.active);
      toast.success(c.active ? `${c.code} paused` : `${c.code} activated`);
    } catch {
      toast.error(c.active ? `Could not pause ${c.code}.` : `Could not activate ${c.code}.`);
    }
  };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
            Coupons
          </h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">
            {activeCount} active · rules &amp; eligibility
          </p>
        </div>
        <Button
          variant="primary"
          className="h-[42px]"
          disabled={!canCreate}
          title={canCreate ? undefined : noPermissionTitle('coupons', 'create')}
          onClick={() => navigate('/coupons/new')}
        >
          + Create coupon
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {HEADERS.map((h, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap border-b border-border-subtle px-4 py-3 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-ui text-[13px] text-error">
                  Couldn’t load coupons. Please try again.
                </td>
              </tr>
            ) : loading && coupons.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">
                  {query ? `No coupons match “${query}”.` : 'No coupons yet.'}
                </td>
              </tr>
            ) : (
              rows.map((c) => {
                const st = deriveCouponStatus(c);
                return (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/coupons/${c.id}`)}
                    className="cursor-pointer transition-colors hover:bg-surface-app"
                  >
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-bold text-text-primary">
                      {c.code}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                      {typeLabel(c)}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                      {c.minCartValuePaise > 0 ? formatMoneyInt(c.minCartValuePaise) : '—'}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                      {maxDiscLabel(c)}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                      {c.usesCount.toLocaleString('en-IN')}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                      {c.validUntil ? dateShort(c.validUntil.toDate()) : 'No expiry'}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                      <Badge tone={BADGE_TONE[st.tone]}>{st.label}</Badge>
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                      <span className="inline-flex items-center gap-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setToDelete(c);
                          }}
                          disabled={!canDelete}
                          title={canDelete ? undefined : noPermissionTitle('coupons', 'delete')}
                          className="inline-flex text-error hover:opacity-70 disabled:opacity-40"
                          aria-label="Delete coupon"
                        >
                          <RiCloseLine size={18} />
                        </button>
                        <DropdownMenu
                          items={[
                            {
                              label: 'Edit',
                              icon: <RiEditLine size={15} />,
                              disabled: !canEdit,
                              onClick: () => navigate(`/coupons/${c.id}`),
                            },
                            c.active
                              ? {
                                  label: 'Pause',
                                  icon: <RiPauseLine size={15} />,
                                  disabled: !canEdit,
                                  onClick: () => void onToggleActive(c),
                                }
                              : {
                                  label: 'Activate',
                                  icon: <RiPlayLine size={15} />,
                                  disabled: !canEdit,
                                  onClick: () => void onToggleActive(c),
                                },
                            {
                              label: 'Delete',
                              icon: <RiDeleteBinLine size={15} />,
                              danger: true,
                              disabled: !canDelete,
                              onClick: () => setToDelete(c),
                            },
                          ]}
                        />
                      </span>
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
          {total === 0
            ? 'No results'
            : `Showing ${start + 1}–${Math.min(start + COUPONS_PAGE_SIZE, total)} of ${total}`}
        </span>
        <div className="flex gap-1.5">
          <PageBtn label="‹" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={current === 1} />
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
            <PageBtn key={n} label={String(n)} active={n === current} onClick={() => setPage(n)} />
          ))}
          <PageBtn
            label="›"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={current === pageCount}
          />
        </div>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        variant="danger"
        title="Delete this coupon?"
        body={
          <>
            <strong className="text-text-primary">{toDelete?.code}</strong> will be permanently removed.
            This cannot be undone.
          </>
        }
        confirmLabel="Delete coupon"
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

function PageBtn({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        'inline-flex h-8 min-w-8 items-center justify-center rounded-[7px] border px-2 font-ui text-xs font-bold disabled:opacity-40 ' +
        (active
          ? 'border-brand-primary bg-brand-primary text-white'
          : 'border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-app')
      }
    >
      {label}
    </button>
  );
}
