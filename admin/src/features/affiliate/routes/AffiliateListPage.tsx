import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react';
import { formatMoneyCompact, formatMoneyInt, type Customer, type WithdrawalRequest } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { exportCsv } from '@/lib/exportCsv';
import { cfError } from '@/lib/cfError';
import { cn } from '@/lib/cn';
import { dateShort } from '@/lib/format';
import { matchesSearch } from '@/lib/search';
import { useSearchStore } from '@/stores/searchStore';
import { useCanView } from '@/features/auth/useCanView';
import { noPermissionTitle, useCanDo } from '@/features/auth/useCan';
import { useReferredCustomers } from '@/features/customers/api/customers';
import {
  approveWithdrawal,
  bankLabel,
  displayAmountPaise,
  feePaiseOf,
  netPayoutPaiseOf,
  outcomeNote,
  rejectWithdrawal,
  sortAffiliates,
  useAffiliates,
  useWithdrawals,
} from '../api/affiliate';

const PAGE = 10;

const STATUS_TONE = {
  approved: 'success',
  processing: 'info',
  paid: 'success',
  rejected: 'error',
  cancelled: 'neutral',
} as const;

export function AffiliateListPage() {
  const navigate = useNavigate();
  // The affiliate roster lives in `customers`, which is gated on the customers
  // module — this screen is gated on affiliateProgram. An affiliate-only
  // sub-admin still gets the withdrawal queue (its own collection is gated on
  // affiliateProgram); the customer-derived columns and totals show as
  // unavailable instead of the query failing and reporting zeroes.
  const canViewCustomers = useCanView('customers');
  // approveWithdrawal / rejectWithdrawal both call
  // requireModule(req, 'affiliateProgram', 'approve').
  const canDecide = useCanDo('affiliateProgram', 'approve');
  // adminAllocateAffiliate calls requireModule(req, 'affiliateProgram', 'edit').
  const canAllocate = useCanDo('affiliateProgram', 'edit');
  const { data: affiliatesRaw, loading } = useAffiliates(canViewCustomers);
  const { data: withdrawals, error: withdrawalsError } = useWithdrawals();
  const { query } = useSearchStore();
  const [page, setPage] = useState(1);
  const [approve, setApprove] = useState<WithdrawalRequest | null>(null);
  // The transfer reference lives here, not inside ConfirmDialog: the dialog is
  // stateless and re-renders its body on every keystroke.
  const [payRef, setPayRef] = useState('');
  const [reject, setReject] = useState<WithdrawalRequest | null>(null);

  const affiliates = useMemo(() => sortAffiliates(affiliatesRaw), [affiliatesRaw]);

  // Join withdrawals to their affiliate customer for code + confirmed balance.
  const affiliateByUid = useMemo(
    () => new Map(affiliates.map((c) => [c.uid, c])),
    [affiliates],
  );

  const stats = useMemo(() => {
    const pendingCommission = affiliates.reduce((s, c) => s + (c.affiliate?.pendingBalancePaise ?? 0), 0);
    const confirmed = affiliates.reduce((s, c) => s + (c.affiliate?.confirmedBalancePaise ?? 0), 0);
    // Same predicate the row actions use: anything the server would still settle
    // is still "to approve", so the KPI can't under-report the payout queue.
    const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending' || w.status === 'processing');
    const pendingPayout = pendingWithdrawals.reduce((s, w) => s + w.requestedAmountPaise, 0);
    return {
      active: affiliates.length,
      pendingCommission,
      confirmed,
      toApprove: pendingWithdrawals.length,
      pendingPayout,
    };
  }, [affiliates, withdrawals]);

  const codeOf = (w: WithdrawalRequest) => affiliateByUid.get(w.customerId)?.affiliate?.referralCode ?? '—';
  const confirmedOf = (w: WithdrawalRequest) =>
    affiliateByUid.get(w.customerId)?.affiliate?.confirmedBalancePaise ?? 0;

  const rows = useMemo(() => {
    let list = withdrawals;
    if (query.trim()) {
      list = list.filter((w) =>
        matchesSearch(query, [w.customerName, codeOf(w), bankLabel(w), w.shortId]),
      );
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withdrawals, query, affiliateByUid]);
  const pageRows = paginate(rows, page, PAGE);

  const onReports = () => {
    if (!canViewCustomers) return toast.info('Exporting affiliates needs the Customers permission.');
    if (affiliates.length === 0) return toast.info('No affiliates to export.');
    exportCsv(
      'barkath-affiliates.csv',
      affiliates.map((c: Customer) => ({
        Name: c.name,
        Phone: c.phone,
        Code: c.affiliate?.referralCode ?? '',
        Referred: c.affiliate?.referredCount ?? 0,
        PendingPaise: c.affiliate?.pendingBalancePaise ?? 0,
        ConfirmedPaise: c.affiliate?.confirmedBalancePaise ?? 0,
        LifetimePaise: c.affiliate?.lifetimeEarningsPaise ?? 0,
      })),
    );
    toast.success('Exported affiliates.csv');
  };

  const doApprove = async () => {
    if (!approve) return;
    // The money has already left the bank by the time an admin clicks this, so
    // refuse to stamp the request 'paid' without the reference that proves it.
    if (!payRef.trim()) {
      toast.error('Enter the bank transfer reference.');
      return;
    }
    try {
      await approveWithdrawal(approve.id, payRef.trim());
      toast.success(`Payout approved for ${approve.customerName}`);
      setApprove(null);
      setPayRef('');
    } catch (e) {
      toast.error(cfError(e, 'approve the withdrawal'));
    }
  };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Affiliate program</h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">
            {/* Without the customers permission the roster was never read, so
                "0 affiliates" would be a lie — drop the clause instead. */}
            {canViewCustomers ? `${stats.active} affiliates · ` : ''}
            {formatMoneyCompact(stats.pendingPayout)} pending payout
          </p>
        </div>
        <div className="flex gap-2.5">
          <Button variant="outline" className="h-[42px]" disabled={!canAllocate} title={canAllocate ? undefined : noPermissionTitle('affiliateProgram', 'edit')} onClick={() => navigate('/affiliate/allocate')}>
            Allocate affiliate
          </Button>
          <Button variant="primary" className="h-[42px]" onClick={onReports}>Reports</Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mb-5 grid grid-cols-4 gap-4">
        {/* The first three are computed from the customer roster — em-dash when
            it wasn't readable, rather than presenting zeroes as fact. */}
        <StatCard label="Active affiliates" value={canViewCustomers ? String(stats.active) : '—'} />
        <StatCard label="Pending commission" value={canViewCustomers ? formatMoneyCompact(stats.pendingCommission) : '—'} tone="gold" />
        <StatCard label="Confirmed" value={canViewCustomers ? formatMoneyCompact(stats.confirmed) : '—'} tone="success" />
        <StatCard label="Withdrawals to approve" value={String(stats.toApprove)} tone="error" />
      </div>

      {/* Affiliate members roster */}
      <AffiliateMembers
        affiliates={affiliates}
        canViewCustomers={canViewCustomers}
        query={query}
        onOpen={(uid) => canViewCustomers && navigate(`/customers/${uid}`)}
      />

      {/* Withdrawal requests */}
      <div className="mb-3 font-display text-sm font-bold text-text-primary">Withdrawal requests</div>
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Affiliate', 'Code', 'Bank', 'Confirmed', 'Amount', 'Action'].map((h) => (
                <th
                  key={h}
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
            {loading && withdrawals.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center font-ui text-[13px] text-text-tertiary">
                  {/* A read failure leaves data empty, which used to render as
                      "No withdrawal requests yet." — telling the admin nobody
                      wants paying while real requests sit in Firestore. */}
                  {withdrawalsError
                    ? 'Couldn’t load withdrawal requests. Please retry in a moment.'
                    : withdrawals.length === 0
                      ? 'No withdrawal requests yet.'
                      : 'No matching requests.'}
                </td>
              </tr>
            ) : (
              pageRows.map((w) => {
                // Terminal rows are read off `status` alone. `processedAt` is
                // stamped by BOTH approve and reject, so it can date a row but
                // never say what happened to it.
                const outcome = outcomeNote(w);
                // Mirror the callables' own precondition (approveWithdrawal /
                // rejectWithdrawal accept pending OR processing). Offering the
                // buttons on 'pending' alone left a 'processing' row that the
                // server would happily settle with no way to settle it.
                const actionable = w.status === 'pending' || w.status === 'processing';
                return (
                  <tr key={w.id} className="hover:bg-surface-app">
                    {/* The affiliate's own profile is where their commission
                        ledger lives, so the name is the way through to it — but
                        only for an admin who may read `customers` at all. */}
                    <td
                      onClick={() => canViewCustomers && navigate(`/customers/${w.customerId}`)}
                      className={cn(
                        'whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-bold text-text-primary',
                        canViewCustomers && 'cursor-pointer hover:text-brand-primary',
                      )}
                    >
                      {w.customerName}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{codeOf(w)}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{bankLabel(w)}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{canViewCustomers ? formatMoneyInt(confirmedOf(w)) : '—'}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 text-right font-ui text-[13px] font-bold text-text-primary">
                      {/* Gross while it is still a request; the NET that reached
                          the bank once it is paid. */}
                      {formatMoneyInt(displayAmountPaise(w))}
                      {w.status === 'paid' && feePaiseOf(w) > 0 && (
                        <div className="mt-[3px] font-ui text-[11px] font-medium text-text-tertiary">
                          net of {formatMoneyInt(feePaiseOf(w))} fee
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                      {actionable ? (
                        <div className="flex items-center gap-2">
                          <Button variant="primary" size="sm" disabled={!canDecide} title={canDecide ? undefined : noPermissionTitle('affiliateProgram', 'approve')} onClick={() => { setPayRef(''); setApprove(w); }}>Approve</Button>
                          <button onClick={() => setReject(w)} disabled={!canDecide} title={canDecide ? undefined : noPermissionTitle('affiliateProgram', 'approve')} className="inline-flex h-9 items-center rounded-sm px-3 font-ui text-xs font-bold text-error hover:bg-error-subtle disabled:opacity-40">Reject</button>
                        </div>
                      ) : (
                        <>
                          <Badge tone={STATUS_TONE[w.status as keyof typeof STATUS_TONE] ?? 'neutral'}>
                            {w.status[0]!.toUpperCase() + w.status.slice(1)}
                          </Badge>
                          {/* The decline reason is what the affiliate was told,
                              and the reference is the proof of transfer — both
                              are the whole point of a terminal row. */}
                          {outcome && (outcome.at || outcome.reason) && (
                            <div className="mt-[3px] max-w-[220px] whitespace-normal font-ui text-[11px] leading-tight text-text-tertiary">
                              {[outcome.at ? dateShort(outcome.at) : null, outcome.reason]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && <Pagination page={page} total={rows.length} pageSize={PAGE} onPage={setPage} noun="requests" />}

      {/* Approve & pay — matches prototype's gold wallet confirm dialog */}
      <ConfirmDialog
        open={!!approve}
        variant="money"
        title="Approve withdrawal?"
        body={
          approve ? (
            <>
              {/* The payout is wired by hand off this figure, so it must be the
                  NET the affiliate was promised — showing the gross made the
                  business eat the processing fee on every withdrawal. */}
              {formatMoneyInt(netPayoutPaiseOf(approve))} will be transferred to{' '}
              <strong className="text-text-primary">{approve.customerName}</strong>’s {bankLabel(approve)}.{' '}
              {feePaiseOf(approve) > 0
                ? `That is ${formatMoneyInt(approve.requestedAmountPaise)} less a ${formatMoneyInt(feePaiseOf(approve))} processing fee; the full ${formatMoneyInt(approve.requestedAmountPaise)} is deducted from confirmed commission.`
                : 'The amount is deducted from confirmed commission.'}
              {/* Nothing here moves money — the transfer happens in the bank —
                  so the reference is the only link between this row and it. */}
              <input
                autoFocus
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                maxLength={64}
                placeholder="Bank transfer reference (UTR)"
                className="mt-4 w-full rounded-lg border border-border-default bg-surface-card px-3 py-2.5 text-left font-ui text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none"
              />
            </>
          ) : null
        }
        confirmLabel="Approve & pay"
        onConfirm={doApprove}
        onCancel={() => {
          setApprove(null);
          setPayRef('');
        }}
      />

      {/* Reject with reason */}
      {reject && (
        <RejectModal request={reject} onClose={() => setReject(null)} onDone={() => setReject(null)} />
      )}
    </div>
  );
}

/**
 * The affiliate roster — every allocated affiliate with their referrals,
 * lifetime commission, withdrawable balance and status. Each row expands to
 * list the customers that affiliate referred (mounted lazily so the
 * referredBy query only fires for an open row).
 */
function AffiliateMembers({
  affiliates,
  canViewCustomers,
  query,
  onOpen,
}: {
  affiliates: Customer[];
  canViewCustomers: boolean;
  query: string;
  onOpen: (uid: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return affiliates;
    return affiliates.filter((c) =>
      matchesSearch(query, [c.name, c.phone, c.affiliate?.referralCode ?? '']),
    );
  }, [affiliates, query]);
  const pageRows = paginate(filtered, page, PAGE);

  const cols = ['Affiliate', 'Code', 'Referrals', 'Commission earned', 'Wallet balance', 'Status'];

  return (
    <>
      <div className="mb-3 font-display text-sm font-bold text-text-primary">Affiliate members</div>
      <div className="mb-3 overflow-hidden rounded-xl border border-border-subtle bg-surface-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="w-8 border-b border-border-subtle px-2 py-3" />
              {cols.map((h) => (
                <th
                  key={h}
                  className={cn(
                    'whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary',
                    h === 'Referrals' || h === 'Commission earned' || h === 'Wallet balance' ? 'text-right' : 'text-left',
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!canViewCustomers ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">Needs the Customers permission to list affiliates.</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">{affiliates.length === 0 ? 'No affiliates yet.' : 'No matching affiliates.'}</td></tr>
            ) : (
              pageRows.map((c) => {
                const a = c.affiliate;
                const open = expanded === c.uid;
                return (
                  <Fragment key={c.uid}>
                    <tr className="hover:bg-surface-app">
                      <td className="border-b border-border-subtle px-2 py-3 text-center">
                        <button onClick={() => setExpanded(open ? null : c.uid)} className="text-text-tertiary hover:text-text-primary" title={open ? 'Collapse' : 'Show referred customers'}>
                          {open ? <RiArrowDownSLine size={18} /> : <RiArrowRightSLine size={18} />}
                        </button>
                      </td>
                      <td
                        onClick={() => onOpen(c.uid)}
                        className={cn('whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-bold text-text-primary', canViewCustomers && 'cursor-pointer hover:text-brand-primary')}
                      >
                        {c.name}
                        <div className="font-ui text-[11px] font-medium text-text-tertiary">{c.phone}</div>
                      </td>
                      <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{a?.referralCode ?? '—'}</td>
                      <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 text-right font-ui text-[13px] font-bold text-text-primary">{a?.referredCount ?? 0}</td>
                      <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 text-right font-ui text-[13px] font-bold text-brand-gold-strong">{formatMoneyInt(a?.lifetimeEarningsPaise ?? 0)}</td>
                      <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 text-right font-ui text-[13px] font-medium text-text-secondary">{formatMoneyInt(a?.confirmedBalancePaise ?? 0)}</td>
                      <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                        <Badge tone={a?.enabled ? 'success' : 'neutral'}>{a?.enabled ? 'Active' : 'Revoked'}</Badge>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} className="border-b border-border-subtle bg-surface-app px-4 py-3">
                          <ReferredList uid={c.uid} onOpen={onOpen} />
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
      {filtered.length > PAGE && <Pagination page={page} total={filtered.length} pageSize={PAGE} onPage={setPage} noun="affiliates" />}
    </>
  );
}

/** The customers a given affiliate referred (`referredBy.affiliateUid ==`). */
function ReferredList({ uid, onOpen }: { uid: string; onOpen: (uid: string) => void }) {
  const { data, loading } = useReferredCustomers(uid);
  const referred = useMemo(
    () =>
      [...data].sort(
        (a, b) => (b.referredBy?.linkedAt?.toMillis?.() ?? 0) - (a.referredBy?.linkedAt?.toMillis?.() ?? 0),
      ),
    [data],
  );
  if (loading) return <div className="font-ui text-[12px] text-text-tertiary">Loading referred customers…</div>;
  if (referred.length === 0) return <div className="font-ui text-[12px] text-text-tertiary">No referred customers yet.</div>;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary">
        Referred customers ({referred.length})
      </div>
      <div className="flex flex-col divide-y divide-border-subtle">
        {referred.map((r) => (
          <button
            key={r.uid}
            onClick={() => onOpen(r.uid)}
            className="flex items-center justify-between py-1.5 text-left font-ui text-[13px] text-text-primary hover:text-brand-primary"
          >
            <span className="font-medium">{r.name}<span className="ml-2 text-[11px] text-text-tertiary">{r.phone}</span></span>
            <span className="text-[11px] text-text-tertiary">{r.referredBy?.linkedAt?.toDate ? dateShort(r.referredBy.linkedAt.toDate()) : ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'gold' | 'success' | 'error';
}) {
  const valueColor =
    tone === 'gold' ? 'text-brand-gold-strong' : tone === 'success' ? 'text-success' : tone === 'error' ? 'text-error' : 'text-text-primary';
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-card p-4">
      <div className="font-ui text-xs font-medium text-text-tertiary">{label}</div>
      <div className={cn('mt-2.5 font-display text-2xl font-extrabold', valueColor)}>{value}</div>
    </div>
  );
}

function RejectModal({
  request,
  onClose,
  onDone,
}: {
  request: WithdrawalRequest;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim()) return toast.error('Please add a reason for the affiliate.');
    try {
      setBusy(true);
      await rejectWithdrawal(request.id, reason.trim());
      toast.success(`Withdrawal for ${request.customerName} rejected`);
      onDone();
    } catch (e) {
      toast.error(cfError(e, 'reject the withdrawal'));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="w-full max-w-[420px] rounded-2xl border border-border-subtle bg-surface-card p-7 shadow-lg">
        <h2 className="font-display text-lg font-extrabold text-text-primary">Reject withdrawal?</h2>
        <p className="mt-1.5 font-ui text-[13px] text-text-secondary">
          {request.customerName}’s request for {formatMoneyInt(request.requestedAmountPaise)} will be declined. They’ll see the reason below.
        </p>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Reason for rejection…"
          className="mt-4 w-full resize-y rounded-lg border border-border-default bg-surface-card px-3 py-2.5 font-ui text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none"
        />
        <div className="mt-4 flex justify-end gap-2.5">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>Reject request</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
