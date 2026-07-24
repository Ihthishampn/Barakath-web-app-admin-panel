import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RiSearchLine, RiCloseLine, RiEditLine, RiPauseCircleLine, RiPlayCircleLine, RiDeleteBinLine } from '@remixicon/react';
import type { Admin } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { useIsSuperAdmin } from '@/features/auth/useCan';
import { Badge } from '@/components/ui/StatusBadge';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { cn } from '@/lib/cn';
import { cfError } from '@/lib/cfError';
import { timeAgo } from '@/lib/format';
import { matchesSearch } from '@/lib/search';
import { useSearchStore } from '@/stores/searchStore';
import { useAuthStore } from '@/features/auth/stores/authStore';
import {
  ROLE_LABELS,
  deleteSubAdmin,
  suspendSubAdmin,
  useAdminsList,
} from '../api/subadmin';

const th =
  'whitespace-nowrap border-b border-border-subtle px-4 py-3 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary';
const td = 'whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px]';

export function SubAdminListPage() {
  const navigate = useNavigate();
  const { data: admins, loading, error } = useAdminsList();
  const { query, setQuery } = useSearchStore();
  const current = useAuthStore((s) => s.admin);
  const [page, setPage] = useState(1);
  const [suspendTarget, setSuspendTarget] = useState<Admin | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Admin | null>(null);
  // createSubAdmin / updateSubAdmin / suspendSubAdmin / deleteSubAdmin all call
  // requireSuperAdmin — NOT requireModule — so a sub-admin merely granted
  // subAdmin.view can read the roster but must not be offered any mutation.
  const isSuper = useIsSuperAdmin();
  const PAGE = 10;

  const activeSuperAdmins = useMemo(
    () => admins.filter((a) => a.role === 'super_admin' && a.status === 'active'),
    [admins],
  );

  const rows = useMemo(() => {
    if (!query.trim()) return admins;
    return admins.filter((a) => matchesSearch(query, [a.name, a.email, a.phone], a.searchIndex));
  }, [admins, query]);
  const pageRows = paginate(rows, page, PAGE);

  // Guards: can't suspend/delete yourself or the last active super-admin.
  const isSelf = (a: Admin) => !!current && a.uid === current.uid;
  const isLastSuperAdmin = (a: Admin) =>
    a.role === 'super_admin' && a.status === 'active' && activeSuperAdmins.length <= 1;
  const suspendBlocked = (a: Admin) => isSelf(a) || isLastSuperAdmin(a);
  const deleteBlocked = (a: Admin) =>
    isSelf(a) || (a.role === 'super_admin' && activeSuperAdmins.length <= 1 && a.status === 'active');

  const onSuspend = async () => {
    const a = suspendTarget;
    if (!a) return;
    const suspend = a.status === 'active';
    try {
      await suspendSubAdmin(a.uid, suspend);
      toast.success(suspend ? `${a.name} suspended` : `${a.name} reactivated`);
      setSuspendTarget(null);
    } catch (e) {
      toast.error(cfError(e, suspend ? 'suspend this admin' : 'reactivate this admin'));
    }
  };

  const onDelete = async () => {
    const a = deleteTarget;
    if (!a) return;
    try {
      await deleteSubAdmin(a.uid);
      toast.success(`${a.name} deleted`);
      setDeleteTarget(null);
    } catch (e) {
      toast.error(cfError(e, 'delete this admin'));
    }
  };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Sub admin</h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">
            {admins.length.toLocaleString('en-IN')} {admins.length === 1 ? 'admin' : 'admins'} · individual permissions
          </p>
        </div>
        <Button
          variant="primary"
          className="h-[42px]"
          disabled={!isSuper}
          title={isSuper ? undefined : 'Only super admins can manage admins.'}
          onClick={() => navigate('/sub-admin/new')}
        >
          + Create admin
        </Button>
      </div>

      {/* Search */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex w-[280px] items-center gap-2.5 rounded-sm border border-border-default bg-surface-card px-3 py-2">
          <RiSearchLine size={16} className="text-text-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full bg-transparent font-ui text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Admin</th>
              <th className={th}>Role</th>
              <th className={th}>Last active</th>
              <th className={th}>Status</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {loading && admins.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">Loading…</td></tr>
            ) : error && admins.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center font-ui text-[13px] text-error">Couldn’t load admins. Please try again.</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center font-ui text-[13px] text-text-tertiary">
                  {admins.length === 0 ? 'No admins yet.' : `No admins match “${query}”.`}
                </td>
              </tr>
            ) : (
              pageRows.map((a) => {
                const suspended = a.status === 'suspended';
                // Activity is stamped on sign-in (lastActiveAt), falling back to
                // the last login. An admin who has never signed in has neither —
                // say so rather than printing an em-dash that reads like a
                // loading state.
                const lastActive = a.lastActiveAt?.toDate?.() ?? a.lastLoginAt?.toDate?.() ?? null;
                return (
                  <tr
                    key={a.uid}
                    onClick={() => navigate(`/sub-admin/${a.uid}`)}
                    className="cursor-pointer transition-colors hover:bg-surface-app"
                  >
                    <td className={cn(td, 'font-bold text-text-primary')}>{a.name}</td>
                    <td className={cn(td, 'font-medium text-text-secondary')}>{ROLE_LABELS[a.role]}</td>
                    <td className={cn(td, 'font-medium text-text-secondary')}>{lastActive ? timeAgo(lastActive) : 'Never signed in'}</td>
                    <td className={td}>
                      <Badge tone={suspended ? 'neutral' : 'success'}>{suspended ? 'Suspended' : 'Active'}</Badge>
                    </td>
                    <td className={td} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          aria-label="Delete admin"
                          disabled={!isSuper || deleteBlocked(a)}
                          onClick={() => setDeleteTarget(a)}
                          className="inline-flex text-error hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <RiCloseLine size={18} />
                        </button>
                        <DropdownMenu
                          items={[
                            { label: 'Edit admin', icon: <RiEditLine size={15} />, disabled: !isSuper, onClick: () => navigate(`/sub-admin/${a.uid}`) },
                            suspended
                              ? { label: 'Reactivate', icon: <RiPlayCircleLine size={15} />, disabled: !isSuper || suspendBlocked(a), onClick: () => setSuspendTarget(a) }
                              : { label: 'Suspend', icon: <RiPauseCircleLine size={15} />, disabled: !isSuper || suspendBlocked(a), onClick: () => setSuspendTarget(a) },
                            { label: 'Delete', icon: <RiDeleteBinLine size={15} />, danger: true, disabled: !isSuper || deleteBlocked(a), onClick: () => setDeleteTarget(a) },
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

      {rows.length > 0 && <Pagination page={page} total={rows.length} pageSize={PAGE} onPage={setPage} noun="admins" />}

      {/* Suspend / reactivate */}
      <ConfirmDialog
        open={!!suspendTarget}
        variant={suspendTarget?.status === 'suspended' ? 'primary' : 'danger'}
        title={suspendTarget?.status === 'suspended' ? 'Reactivate this admin?' : 'Suspend this admin?'}
        body={
          suspendTarget?.status === 'suspended' ? (
            <><strong className="text-text-primary">{suspendTarget?.name}</strong> will regain access to the admin console.</>
          ) : (
            <><strong className="text-text-primary">{suspendTarget?.name}</strong> won’t be able to sign in until reactivated.</>
          )
        }
        confirmLabel={suspendTarget?.status === 'suspended' ? 'Reactivate' : 'Suspend'}
        onConfirm={onSuspend}
        onCancel={() => setSuspendTarget(null)}
      />

      {/* Delete */}
      <ConfirmDialog
        open={!!deleteTarget}
        variant="danger"
        title="Delete this admin?"
        body={<><strong className="text-text-primary">{deleteTarget?.name}</strong> will be permanently removed and can no longer sign in. This can’t be undone.</>}
        confirmLabel="Delete admin"
        onConfirm={onDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
