import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RiCloseLine } from '@remixicon/react';
import type { FlashSale } from '@barkath/shared';
import { Badge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { noPermissionTitle, useCan } from '@/features/auth/useCan';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { matchesSearch } from '@/lib/search';
import { useSearchStore } from '@/stores/searchStore';
import { deleteFlashSale, deriveFlashSaleBadge, useFlashSalesList } from '../api/flashSales';

const BADGE_TONE = {
  success: 'success',
  info: 'info',
  neutral: 'neutral',
  error: 'error',
} as const;

function fmt(ts: FlashSale['startsAt']): string {
  const d = ts?.toDate?.();
  if (!d) return '—';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function FlashSaleListPage() {
  const navigate = useNavigate();
  const { data: sales, loading, error } = useFlashSalesList();
  const { query } = useSearchStore();
  const [toDelete, setToDelete] = useState<FlashSale | null>(null);
  // Flash sales are a direct, rules-gated client write (canWrite('flashSale')).
  const can = useCan();
  const canCreate = can('flashSale', 'create');
  const canDelete = can('flashSale', 'delete');

  const filtered = useMemo(
    () => sales.filter((s) => (query.trim() ? matchesSearch(query, [s.name]) : true)),
    [sales, query],
  );

  const onDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteFlashSale(toDelete.id);
      toast.success(`${toDelete.name || 'Flash sale'} deleted`);
    } catch {
      toast.error('Could not delete the flash sale.');
    } finally {
      setToDelete(null);
    }
  };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
            Flash Sale
          </h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">
            Scheduled campaigns for the storefront countdown rail
          </p>
        </div>
        <Button
          variant="primary"
          className="h-[42px]"
          disabled={!canCreate}
          title={canCreate ? undefined : noPermissionTitle('flashSale', 'create')}
          onClick={() => navigate('/flash-sale/new')}
        >
          + Create flash sale
        </Button>
      </div>

      {/* States */}
      {loading && sales.length === 0 ? (
        <div className="grid place-items-center py-24">
          <Spinner className="h-7 w-7 text-brand-primary" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-border-subtle bg-surface-card p-10 text-center font-ui text-[13px] text-error">
          Couldn't load flash sales. Please try again.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-card p-14 text-center">
          <p className="font-ui text-[13px] text-text-tertiary">
            {query.trim() ? `No flash sales match "${query}".` : 'No flash sales yet.'}
          </p>
          {!query.trim() && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                disabled={!canCreate}
                title={canCreate ? undefined : noPermissionTitle('flashSale', 'create')}
                onClick={() => navigate('/flash-sale/new')}
              >
                + Create your first flash sale
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {filtered.map((s) => {
            const st = deriveFlashSaleBadge(s.status);
            return (
              <div
                key={s.id}
                onClick={() => navigate(`/flash-sale/${s.id}`)}
                className="cursor-pointer rounded-xl border border-border-subtle bg-surface-card p-[14px] transition-colors hover:border-border-default"
              >
                <div
                  className="mb-3 aspect-video rounded-sm bg-cover bg-center"
                  style={{
                    backgroundColor: '#fde8cf',
                    backgroundImage: s.bannerImageUrl ? `url(${s.bannerImageUrl})` : undefined,
                  }}
                />
                <div className="flex items-center justify-between">
                  <div className="truncate font-ui text-[13px] font-bold text-text-primary">
                    {s.name || 'Untitled sale'}
                  </div>
                  <Badge tone={BADGE_TONE[st.tone]}>{st.label}</Badge>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="truncate font-ui text-[11px] font-medium text-text-tertiary">
                    {fmt(s.startsAt)} – {fmt(s.endsAt)} · {s.productIds?.length ?? 0} products
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setToDelete(s);
                    }}
                    disabled={!canDelete}
                    title={canDelete ? undefined : noPermissionTitle('flashSale', 'delete')}
                    className={cn('inline-flex flex-none text-error hover:opacity-80 disabled:opacity-40')}
                    aria-label="Delete flash sale"
                  >
                    <RiCloseLine size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        variant="danger"
        title="Delete this flash sale?"
        body={
          <>
            <strong className="text-text-primary">{toDelete?.name || 'This flash sale'}</strong> will be
            permanently removed. This cannot be undone.
          </>
        }
        confirmLabel="Delete flash sale"
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
