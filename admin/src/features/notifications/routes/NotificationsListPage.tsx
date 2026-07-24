import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RiSendPlaneLine } from '@remixicon/react';
import { Button } from '@/components/ui/Button';
import { noPermissionTitle, useCanDo } from '@/features/auth/useCan';
import { Badge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { dateShort } from '@/lib/format';
import { matchesSearch } from '@/lib/search';
import { useSearchStore } from '@/stores/searchStore';
import {
  audienceLabel,
  broadcastBadge,
  useBroadcastsList,
  type Broadcast,
  type BroadcastTemplate,
} from '../api/notifications';

const PAGE = 10;
const COLS = ['Title', 'Audience', 'Sent', 'Opened', 'Status', ''];

const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-IN'));
const audienceText = (b: Broadcast) => b.audienceLabel || audienceLabel(b.audience);

export function NotificationsListPage() {
  const navigate = useNavigate();
  const { data: broadcasts, loading, error } = useBroadcastsList();
  const { query } = useSearchStore();
  const [page, setPage] = useState(1);
  // Both entry points into the create form end in adminSendBroadcast, which
  // calls requireModule(req, 'notifications', 'create').
  const canSend = useCanDo('notifications', 'create');

  const rows = useMemo(() => {
    if (!query.trim()) return broadcasts;
    return broadcasts.filter((b) => matchesSearch(query, [b.title, b.body, audienceText(b)]));
  }, [broadcasts, query]);
  const pageRows = paginate(rows, page, PAGE);

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
            Push notifications
          </h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">Schedule · audience · templates</p>
        </div>
        <Button
          variant="primary"
          className="h-[42px]"
          disabled={!canSend}
          title={canSend ? undefined : noPermissionTitle('notifications', 'create')}
          onClick={() => navigate('/notifications/create')}
        >
          + Create notification
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {COLS.map((h, i) => (
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
            {loading && broadcasts.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} className="px-4 py-12 text-center">
                  <Spinner className="h-6 w-6 text-brand-primary" />
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={COLS.length} className="px-4 py-12 text-center font-ui text-[13px] text-error">
                  Couldn’t load notifications. Please try again.
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} className="px-4 py-12 text-center font-ui text-[13px] text-text-tertiary">
                  {broadcasts.length === 0 ? 'No notifications sent yet.' : 'No notifications match your search.'}
                </td>
              </tr>
            ) : (
              pageRows.map((b, i) => {
                const badge = broadcastBadge(b.status);
                return (
                  <tr key={b.id || i} className="hover:bg-surface-app">
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-bold text-text-primary">
                      {b.title}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                      {audienceText(b)}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                      {num(b.reach)}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                      {num(b.opened)}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {b.sentAt?.toDate && (
                          <span className="font-ui text-xs text-text-tertiary">{dateShort(b.sentAt.toDate())}</span>
                        )}
                        <DropdownMenu
                          items={[
                            {
                              label: 'Send similar',
                              icon: <RiSendPlaneLine size={15} />,
                              disabled: !canSend,
                              // Hand the source broadcast to the create form so
                              // it opens prefilled — without state this was
                              // identical to "+ Create notification", and the
                              // list shows no body/deep link to copy from.
                              onClick: () =>
                                navigate('/notifications/create', {
                                  state: {
                                    from: {
                                      title: b.title,
                                      body: b.body,
                                      audience: b.audience,
                                      deepLink: b.deepLink ?? null,
                                    } satisfies BroadcastTemplate,
                                  },
                                }),
                            },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <Pagination page={page} total={rows.length} pageSize={PAGE} onPage={setPage} noun="notifications" />
      )}
    </div>
  );
}
