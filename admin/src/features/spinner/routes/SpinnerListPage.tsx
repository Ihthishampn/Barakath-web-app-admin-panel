import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RiCloseLine } from '@remixicon/react';
import type { SpinCampaign } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { noPermissionTitle, useCan } from '@/features/auth/useCan';
import { Badge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { exportCsv } from '@/lib/exportCsv';
import { matchesSearch } from '@/lib/search';
import { useSearchStore } from '@/stores/searchStore';
import { dateShort } from '@/lib/format';
import {
  conversionPct,
  deleteCampaign,
  deriveSpinStatus,
  useSpinCampaignsList,
} from '../api/spinner';

const numberGroup = (n: number) => n.toLocaleString('en-IN');

export function SpinnerListPage() {
  const navigate = useNavigate();
  const { data: campaigns, loading, error } = useSpinCampaignsList();
  const { query } = useSearchStore();
  const [toDelete, setToDelete] = useState<SpinCampaign | null>(null);
  // spinCampaigns is a direct, rules-gated write (canWrite('spinnerCampaigns')).
  const can = useCan();
  const canCreate = can('spinnerCampaigns', 'create');
  const canDelete = can('spinnerCampaigns', 'delete');

  const filtered = useMemo(
    () =>
      campaigns.filter((c) => (query.trim() ? matchesSearch(query, [c.name, c.status]) : true)),
    [campaigns, query],
  );

  const activeCount = campaigns.filter((c) => deriveSpinStatus(c).label === 'Active').length;

  const onExport = () => {
    if (campaigns.length === 0) return toast.info('Nothing to export.');
    exportCsv(
      'barkath-spin-campaigns.csv',
      campaigns.map((c) => ({
        Campaign: c.name,
        Status: deriveSpinStatus(c).label,
        Starts: c.startsAt ? dateShort(c.startsAt.toDate()) : '',
        Ends: c.endsAt ? dateShort(c.endsAt.toDate()) : '',
        Offers: c.slices?.length ?? 0,
        Plays: c.totalSpins,
        CouponsIssued: c.totalCouponsIssued,
        ConversionPct: conversionPct(c) ?? '',
      })),
    );
    toast.success('Exported spin-campaigns.csv');
  };

  const onDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteCampaign(toDelete.id);
      toast.success(`${toDelete.name} deleted`);
      setToDelete(null);
    } catch {
      toast.error(`Could not delete ${toDelete.name}.`);
    }
  };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
            Spinner campaigns
          </h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">
            {activeCount} active · reward config &amp; probability
          </p>
        </div>
        <div className="flex gap-2.5">
          <Button variant="outline" className="h-[42px]" onClick={onExport}>
            Export
          </Button>
          <Button
            variant="primary"
            className="h-[42px]"
            disabled={!canCreate}
            title={canCreate ? undefined : noPermissionTitle('spinnerCampaigns', 'create')}
            onClick={() => navigate('/spinner/new')}
          >
            + Create campaign
          </Button>
        </div>
      </div>

      {/* States */}
      {error ? (
        <div className="grid place-items-center rounded-xl border border-border-subtle bg-surface-card py-20 text-center">
          <p className="font-ui text-[13px] text-error">Couldn’t load campaigns. Check your connection and retry.</p>
        </div>
      ) : loading && campaigns.length === 0 ? (
        <div className="grid place-items-center py-24">
          <Spinner className="h-7 w-7 text-brand-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-border-subtle bg-surface-card py-20 text-center">
          <p className="font-ui text-[13px] text-text-tertiary">
            {query.trim() ? `No campaigns match “${query}”.` : 'No spin campaigns yet. Create your first one.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {filtered.map((c) => {
            const st = deriveSpinStatus(c);
            const conv = conversionPct(c);
            const showStats = c.totalSpins > 0;
            return (
              <div
                key={c.id}
                onClick={() => navigate(`/spinner/${c.id}`)}
                className="cursor-pointer rounded-xl border border-border-subtle bg-surface-card p-5 transition-colors hover:border-border-default"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-display text-sm font-bold text-text-primary">{c.name}</div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </div>
                <div className="flex items-end gap-5">
                  <div>
                    <div className="font-ui text-[11px] font-medium text-text-tertiary">Plays</div>
                    <div className="mt-[5px] font-display text-lg font-extrabold text-text-primary">
                      {showStats ? numberGroup(c.totalSpins) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="font-ui text-[11px] font-medium text-text-tertiary">Conversion</div>
                    <div className="mt-[5px] font-display text-lg font-extrabold text-text-primary">
                      {showStats && conv != null ? `${conv}%` : '—'}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setToDelete(c);
                    }}
                    disabled={!canDelete}
                    title={canDelete ? undefined : noPermissionTitle('spinnerCampaigns', 'delete')}
                    className="ml-auto inline-flex text-error hover:opacity-80 disabled:opacity-40"
                    aria-label={`Delete ${c.name}`}
                  >
                    <RiCloseLine size={18} />
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
        title="Delete this campaign?"
        body={
          <>
            <strong className="text-text-primary">{toDelete?.name}</strong> and its wheel configuration will
            be permanently removed. This cannot be undone.
          </>
        }
        confirmLabel="Delete campaign"
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
