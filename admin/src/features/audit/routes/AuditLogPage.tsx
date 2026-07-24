import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RiErrorWarningLine } from '@remixicon/react';
import { formatMoneyInt } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/StatusBadge';
import { Select } from '@/components/ui/Select';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { cn } from '@/lib/cn';
import { dateTimeShort } from '@/lib/format';
import { exportCsv } from '@/lib/exportCsv';
import { matchesSearch } from '@/lib/search';
import { useSearchStore } from '@/stores/searchStore';
import { useIsSuperAdmin } from '@/features/auth/useCan';
import { useAdminsList } from '@/features/subadmin/api/subadmin';
import {
  actionLabel,
  actionTone,
  AUDIT_LIMIT,
  distinctValues,
  entityLink,
  formatMeta,
  useAuditLogs,
  type AuditLog,
} from '../api/audit';

const PAGE = 15;

const inputCls =
  'h-[42px] w-full rounded-sm border border-border-default bg-surface-card px-3 font-ui text-[13px] text-text-primary focus:border-brand-primary focus:outline-none';

/** Local midnight for a yyyy-mm-dd value from a native date input. */
const startOfDay = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const endOfDay = (iso: string) => new Date(`${iso}T23:59:59.999`).getTime();

/**
 * Audit log — the answer to "who cancelled that order / adjusted that wallet /
 * changed the GST rate".
 *
 * `writeAudit` has been recording every privileged action since the callables
 * were written, and firestore.rules has always exposed the collection to super
 * admins, but nothing in the panel read it: the trail existed and was only
 * reachable through the Firebase console. Same gate as the rules — super admin
 * only — because a listener fired without it fails whole with permission-denied.
 */
export function AuditLogPage() {
  const navigate = useNavigate();
  const isSuper = useIsSuperAdmin();
  const { data: logs, loading, error } = useAuditLogs(isSuper);
  // Every callable writes `actorName: 'admin'` (writeAudit's default — none of
  // them pass a real one), so the stored name is useless. The admins roster is
  // readable here by definition (super admin) and turns a uid into a person.
  const { data: admins } = useAdminsList();
  const { query } = useSearchStore();

  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const adminByUid = useMemo(() => new Map(admins.map((a) => [a.uid, a])), [admins]);
  const actorName = (r: AuditLog) => {
    const a = adminByUid.get(r.actorUid);
    if (a) return a.name || a.email || r.actorUid;
    // A deleted sub-admin leaves rows behind — that is the whole point of an
    // audit trail — so fall back to the stored name, then the raw uid.
    return r.actorName && r.actorName !== 'admin' ? r.actorName : r.actorUid;
  };

  const actionOptions = useMemo(
    () => distinctValues(logs, 'action').map((a) => ({ value: a, label: actionLabel(a) })),
    [logs],
  );
  const entityOptions = useMemo(
    () => distinctValues(logs, 'entity').map((e) => ({ value: e, label: e })),
    [logs],
  );

  const rows = useMemo(() => {
    const fromMs = from ? startOfDay(from) : null;
    const toMs = to ? endOfDay(to) : null;
    return logs.filter((r) => {
      if (action && r.action !== action) return false;
      if (entity && r.entity !== entity) return false;
      const at = r.createdAt?.toMillis?.() ?? null;
      // A row whose stamp hasn't resolved yet (serverTimestamp round-trip) is
      // kept when no date filter is set and dropped when one is — it cannot be
      // shown to satisfy a range we can't evaluate.
      if (fromMs !== null && (at === null || at < fromMs)) return false;
      if (toMs !== null && (at === null || at > toMs)) return false;
      if (query.trim()) {
        return matchesSearch(query, [
          actionLabel(r.action),
          r.action,
          r.entity,
          r.entityId,
          actorName(r),
          formatMeta(r.meta),
        ]);
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, action, entity, from, to, query, adminByUid]);

  const pageRows = paginate(rows, page, PAGE);
  const filtered = !!(action || entity || from || to || query.trim());

  const resetFilters = () => {
    setAction('');
    setEntity('');
    setFrom('');
    setTo('');
    setPage(1);
  };

  const onExport = () => {
    if (rows.length === 0) return toast.info('Nothing to export.');
    exportCsv(
      'barkath-audit-log.csv',
      rows.map((r) => ({
        When: r.createdAt?.toDate?.().toISOString() ?? '',
        Actor: actorName(r),
        ActorUid: r.actorUid,
        Action: r.action,
        Entity: r.entity,
        EntityId: r.entityId,
        AmountPaise: r.amountPaise ?? '',
        Meta: formatMeta(r.meta),
      })),
    );
    toast.success('Exported audit-log.csv');
  };

  if (!isSuper) {
    return (
      <div className="px-7 py-6">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Audit log</h1>
        <div className="mt-5 rounded-xl border border-border-subtle bg-surface-card p-8 text-center font-ui text-sm text-text-tertiary">
          The audit log is available to super admins only.
        </div>
      </div>
    );
  }

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Audit log</h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">
            {filtered ? `${rows.length} of ${logs.length}` : `${logs.length}`} recorded action
            {rows.length === 1 && filtered ? '' : 's'}
            {logs.length >= AUDIT_LIMIT && ` · showing the latest ${AUDIT_LIMIT}`}
          </p>
        </div>
        <div className="flex gap-2.5">
          <Button variant="primary" className="h-[42px]" onClick={onExport}>
            Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 grid grid-cols-[1fr_1fr_180px_180px_auto] items-end gap-2.5">
        <Select
          label="Action"
          value={action}
          placeholder="All actions"
          onChange={(v) => {
            setAction(v);
            setPage(1);
          }}
          options={actionOptions}
        />
        <Select
          label="Entity"
          value={entity}
          placeholder="All entities"
          onChange={(v) => {
            setEntity(v);
            setPage(1);
          }}
          options={entityOptions}
        />
        <label className="flex flex-col gap-1.5">
          <span className="font-ui text-xs font-bold text-text-primary">From</span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-ui text-xs font-bold text-text-primary">To</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className={inputCls}
          />
        </label>
        <Button variant="outline" className="h-[42px]" disabled={!filtered} onClick={resetFilters}>
          Clear
        </Button>
      </div>

      {/* Read error — an empty table here would read as "nobody did anything" */}
      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-error-subtle bg-error-subtle px-4 py-3">
          <RiErrorWarningLine size={18} className="mt-[1px] shrink-0 text-error" />
          <div className="font-ui text-[13px] text-text-primary">
            <span className="font-bold">Couldn’t load the audit log.</span>{' '}
            <span className="text-text-secondary">
              {error.code === 'permission-denied'
                ? 'Only super admins can read it.'
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
              {['When', 'Actor', 'Action', 'Entity', 'Details', 'Amount'].map((h, i) => (
                <th
                  key={i}
                  className={cn(
                    'whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary',
                    h === 'Amount' ? 'text-right' : 'text-left',
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center font-ui text-[13px] text-text-tertiary">
                  {logs.length === 0
                    ? error
                      ? 'The audit log couldn’t be loaded.'
                      : 'No actions recorded yet.'
                    : 'No entries match these filters.'}
                </td>
              </tr>
            ) : (
              pageRows.map((r) => {
                const link = entityLink(r.entity, r.entityId);
                const open = expanded === r.id;
                const meta = formatMeta(r.meta);
                return (
                  <Fragment key={r.id}>
                    <tr
                      onClick={() => setExpanded(open ? null : r.id)}
                      className="cursor-pointer hover:bg-surface-app"
                    >
                      <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                        {dateTimeShort(r.createdAt?.toDate?.())}
                      </td>
                      <td className="max-w-[180px] truncate border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-bold text-text-primary">
                        {actorName(r)}
                      </td>
                      <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                        <Badge tone={actionTone(r.action)}>{actionLabel(r.action)}</Badge>
                      </td>
                      <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                        {link ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(link);
                            }}
                            className="font-semibold text-brand-primary hover:underline"
                          >
                            {r.entity}
                          </button>
                        ) : (
                          r.entity
                        )}
                      </td>
                      <td className="max-w-[320px] truncate border-b border-border-subtle px-4 py-3 font-ui text-[13px] text-text-secondary">
                        {meta || '—'}
                      </td>
                      <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 text-right font-ui text-[13px] font-bold text-text-primary">
                        {r.amountPaise == null ? '—' : formatMoneyInt(r.amountPaise)}
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-surface-app">
                        <td colSpan={6} className="border-b border-border-subtle px-4 py-3.5">
                          <div className="grid grid-cols-2 gap-x-5 gap-y-2">
                            <DetailRow label="Entity id" value={r.entityId} mono />
                            <DetailRow label="Actor uid" value={r.actorUid} mono />
                            <DetailRow label="Action key" value={r.action} mono />
                            <DetailRow label="Log id" value={r.id} mono />
                          </div>
                          {/* The raw payload. `meta` keys vary per action, and
                              before/after are declared by writeAudit but not yet
                              populated by any caller — show them only when a
                              caller starts filling them in. */}
                          <MetaBlock label="Meta" value={r.meta} />
                          <MetaBlock label="Before" value={r.before} />
                          <MetaBlock label="After" value={r.after} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <Pagination page={page} total={rows.length} pageSize={PAGE} onPage={setPage} noun="entries" />
      )}
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-[80px] flex-none font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary">
        {label}
      </span>
      <span className={cn('min-w-0 break-all font-ui text-[12px] text-text-secondary', mono && 'font-medium')}>
        {value || '—'}
      </span>
    </div>
  );
}

function MetaBlock({ label, value }: { label: string; value: Record<string, unknown> | null }) {
  if (!value || Object.keys(value).length === 0) return null;
  return (
    <div className="mt-3">
      <div className="mb-1 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary">
        {label}
      </div>
      <pre className="overflow-x-auto rounded-sm border border-border-subtle bg-surface-card px-3 py-2 font-ui text-[12px] leading-relaxed text-text-secondary">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
