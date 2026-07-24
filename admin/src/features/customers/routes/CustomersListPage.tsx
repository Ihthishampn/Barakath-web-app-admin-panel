import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RiSearchLine, RiEyeLine, RiFileCopyLine } from '@remixicon/react';
import { formatMoneyInt, type Customer } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/StatusBadge';
import { Toggle } from '@/components/ui/Toggle';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { exportCsv } from '@/lib/exportCsv';
import { cfError } from '@/lib/cfError';
import { matchesSearch } from '@/lib/search';
import { useSearchStore } from '@/stores/searchStore';
import { setAffiliateEnabled, useCustomersList } from '../api/customers';

export function CustomersListPage() {
  const navigate = useNavigate();
  const { data: customers, loading } = useCustomersList();
  const { query, setQuery } = useSearchStore();
  const [page, setPage] = useState(1);
  const [pendingAffiliate, setPendingAffiliate] = useState<Set<string>>(new Set());
  const PAGE = 10;

  const affiliateCount = useMemo(() => customers.filter((c) => c.affiliate?.enabled).length, [customers]);

  const rows = useMemo(() => {
    if (!query.trim()) return customers;
    return customers.filter((c) => matchesSearch(query, [c.name, c.phone, c.email], c.searchIndex));
  }, [customers, query]);
  const pageRows = paginate(rows, page, PAGE);

  const onExport = () => {
    if (customers.length === 0) return toast.info('Nothing to export.');
    exportCsv(
      'barkath-customers.csv',
      customers.map((c) => ({
        Customer: c.name,
        Phone: c.phone,
        Email: c.email ?? '',
        Orders: c.stats.ordersCount,
        WalletPaise: c.wallet.balancePaise,
        Affiliate: c.affiliate?.enabled ? 'Yes' : 'No',
        Status: c.isBlocked ? 'Blocked' : 'Active',
      })),
    );
    toast.success('Exported customers.csv');
  };

  const onToggleAffiliate = async (c: Customer) => {
    const enabled = !c.affiliate?.enabled;
    setPendingAffiliate((s) => new Set(s).add(c.uid));
    try {
      await setAffiliateEnabled(c.uid, enabled);
      toast.success(`${c.name} ${enabled ? 'is now an affiliate' : 'affiliate access revoked'}`);
    } catch (e) {
      toast.error(cfError(e, enabled ? 'enable affiliate' : 'revoke affiliate'));
    } finally {
      setPendingAffiliate((s) => {
        const n = new Set(s);
        n.delete(c.uid);
        return n;
      });
    }
  };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Customers</h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">
            {customers.length.toLocaleString('en-IN')} registered · {affiliateCount} affiliates
          </p>
        </div>
        <Button variant="primary" className="h-[42px]" onClick={onExport}>
          Export
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
              {['Customer', 'Phone', 'Orders', 'Wallet', 'Affiliate', 'Status', ''].map((h, i) => (
                <th key={i} className="whitespace-nowrap border-b border-border-subtle px-4 py-3 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && customers.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center font-ui text-[13px] text-text-tertiary">
                  {customers.length === 0 ? 'No customers yet.' : `No customers match “${query}”.`}
                </td>
              </tr>
            ) : (
              pageRows.map((c) => (
                <tr
                  key={c.uid}
                  onClick={() => navigate(`/customers/${c.uid}`)}
                  className="cursor-pointer transition-colors hover:bg-surface-app"
                >
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-bold text-text-primary">{c.name}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{c.phone}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{c.stats.ordersCount}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{formatMoneyInt(c.wallet.balancePaise)}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <Toggle
                      checked={!!c.affiliate?.enabled}
                      disabled={pendingAffiliate.has(c.uid)}
                      onChange={() => void onToggleAffiliate(c)}
                    />
                  </td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                    <Badge tone={c.isBlocked ? 'error' : 'success'}>{c.isBlocked ? 'Blocked' : 'Active'}</Badge>
                  </td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                    <DropdownMenu
                      items={[
                        { label: 'View profile', icon: <RiEyeLine size={15} />, onClick: () => navigate(`/customers/${c.uid}`) },
                        {
                          label: 'Copy phone',
                          icon: <RiFileCopyLine size={15} />,
                          onClick: () => {
                            void navigator.clipboard?.writeText(c.phone);
                            toast.success('Phone copied');
                          },
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && <Pagination page={page} total={rows.length} pageSize={PAGE} onPage={setPage} noun="customers" />}
    </div>
  );
}
