import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RiCloseLine } from '@remixicon/react';
import type { Banner } from '@barkath/shared';
import { Badge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { noPermissionTitle, useCan } from '@/features/auth/useCan';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { matchesSearch } from '@/lib/search';
import { useSearchStore } from '@/stores/searchStore';
import { useProductsList } from '@/features/products/api/products';
import {
  deleteBanner,
  deriveBannerStatus,
  useBannersList,
  type BannerBadgeTone,
} from '../api/banners';

const BADGE_TONE: Record<BannerBadgeTone, Parameters<typeof Badge>[0]['tone']> = {
  success: 'success',
  neutral: 'neutral',
};

export function BannerListPage() {
  const navigate = useNavigate();
  const { data: banners, loading, error } = useBannersList();
  const { data: products } = useProductsList();
  const { query } = useSearchStore();
  const [toDelete, setToDelete] = useState<Banner | null>(null);
  // Banners are a direct, rules-gated client write (canWrite('banner')).
  const can = useCan();
  const canCreate = can('banner', 'create');
  const canDelete = can('banner', 'delete');

  const productName = useMemo(() => {
    const map = new Map(products.map((p) => [p.id, p.name]));
    return (id: string | null) => (id ? (map.get(id) ?? 'Unknown product') : null);
  }, [products]);

  const filtered = useMemo(
    () => banners.filter((b) => (query.trim() ? matchesSearch(query, [b.title]) : true)),
    [banners, query],
  );

  const onDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteBanner(toDelete.id);
      toast.success(`${toDelete.title || 'Banner'} deleted`);
    } catch {
      toast.error('Could not delete the banner.');
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
            Banner
          </h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">
            Multiple banners · aspect ratio 16:9
          </p>
        </div>
        <Button
          variant="primary"
          className="h-[42px]"
          disabled={!canCreate}
          title={canCreate ? undefined : noPermissionTitle('banner', 'create')}
          onClick={() => navigate('/banner/new')}
        >
          + Add banner
        </Button>
      </div>

      {/* States */}
      {loading && banners.length === 0 ? (
        <div className="grid place-items-center py-24">
          <Spinner className="h-7 w-7 text-brand-primary" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-border-subtle bg-surface-card p-10 text-center font-ui text-[13px] text-error">
          Couldn’t load banners. Please try again.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-card p-14 text-center">
          <p className="font-ui text-[13px] text-text-tertiary">
            {query.trim() ? `No banners match “${query}”.` : 'No banners yet.'}
          </p>
          {!query.trim() && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                disabled={!canCreate}
                title={canCreate ? undefined : noPermissionTitle('banner', 'create')}
                onClick={() => navigate('/banner/new')}
              >
                + Add your first banner
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {filtered.map((b) => {
            const st = deriveBannerStatus(b);
            const attached = productName(b.attachedProductId);
            return (
              <div
                key={b.id}
                onClick={() => navigate(`/banner/${b.id}`)}
                className="cursor-pointer rounded-xl border border-border-subtle bg-surface-card p-[14px] transition-colors hover:border-border-default"
              >
                <div
                  className="mb-3 aspect-video rounded-sm bg-cover bg-center"
                  style={{
                    backgroundColor: '#e6cfb4',
                    backgroundImage: b.imageUrl ? `url(${b.imageUrl})` : undefined,
                  }}
                />
                <div className="flex items-center justify-between">
                  <div className="truncate font-ui text-[13px] font-bold text-text-primary">
                    {b.title || 'Untitled banner'}
                  </div>
                  <Badge tone={BADGE_TONE[st.tone]}>{st.label}</Badge>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="truncate font-ui text-[11px] font-medium text-text-tertiary">
                    16:9{attached ? ` · attached: ${attached}` : ' · no product'}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setToDelete(b);
                    }}
                    disabled={!canDelete}
                    title={canDelete ? undefined : noPermissionTitle('banner', 'delete')}
                    className={cn('inline-flex flex-none text-error hover:opacity-80 disabled:opacity-40')}
                    aria-label="Delete banner"
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
        title="Delete this banner?"
        body={
          <>
            <strong className="text-text-primary">{toDelete?.title || 'This banner'}</strong> will be
            permanently removed. This cannot be undone.
          </>
        }
        confirmLabel="Delete banner"
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
