import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { RiWalletLine, RiUserHeartLine, RiGiftLine } from '@remixicon/react';
import { RiMapPin2Line } from '@remixicon/react';
import {
  formatMoney2dp,
  formatMoneyInt,
  formatMoneySigned,
  type Customer,
  type CustomerAddress,
} from '@barkath/shared';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Badge, OrderStatusBadge } from '@/components/ui/StatusBadge';
import { Toggle } from '@/components/ui/Toggle';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cn } from '@/lib/cn';
import { cap, dateShort } from '@/lib/format';
import { downloadText } from '@/lib/exportCsv';
import { cfError } from '@/lib/cfError';
import { useCanView } from '@/features/auth/useCanView';
import { noPermissionTitle, useCanDo } from '@/features/auth/useCan';
import { updateAffiliateTerms } from '@/features/affiliate/api/affiliate';
import {
  adjustWallet,
  grantSpins,
  setAffiliateEnabled,
  setBlocked,
  useCommissions,
  useCustomer,
  useCustomerOrders,
  useReferredCustomers,
  useWalletTransactions,
} from '../api/customers';

type Tab = 'orders' | 'wallet' | 'affiliate';

export function CustomerProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: customer, loading } = useCustomer(id ?? null);
  const [tab, setTab] = useState<Tab>('orders');
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [affiliateBusy, setAffiliateBusy] = useState(false);
  const [editTerms, setEditTerms] = useState(false);
  const [spinInput, setSpinInput] = useState('1');
  const [spinBusy, setSpinBusy] = useState(false);
  // Commission terms are the affiliate program's own module, not customers —
  // same split the Affiliate tab already makes for the commission ledger. The
  // callable enforces it too; this only avoids offering a control that would
  // come back permission-denied.
  const canEditAffiliate = useCanView('affiliateProgram');
  // adminBlockUser / adminUnblockUser / adminGrantSpins / adminSetAffiliate all
  // call requireModule(req, 'customers', 'edit'); adminAdjustWallet does too.
  const canEditCustomer = useCanDo('customers', 'edit');

  if (loading && !customer) {
    return <div className="grid place-items-center py-24"><Spinner className="h-7 w-7 text-brand-primary" /></div>;
  }
  if (!customer) {
    return (
      <div className="px-7 py-6">
        <p className="font-ui text-sm text-text-tertiary">Customer not found.</p>
        <button onClick={() => navigate('/customers')} className="mt-3 font-ui text-[13px] font-semibold text-brand-primary hover:underline">‹ Back to customers</button>
      </div>
    );
  }

  const memberSince = customer.createdAt?.toDate?.().getFullYear() ?? '—';

  const onToggleAffiliate = async () => {
    const enabled = !customer.affiliate?.enabled;
    setAffiliateBusy(true);
    try {
      await setAffiliateEnabled(customer.uid, enabled);
      toast.success(enabled ? 'Affiliate access enabled' : 'Affiliate access revoked');
    } catch (e) {
      toast.error(cfError(e, enabled ? 'enable affiliate' : 'revoke affiliate'));
    } finally {
      setAffiliateBusy(false);
    }
  };

  const onGrantSpins = async (delta: number) => {
    if (!Number.isFinite(delta) || delta === 0) {
      toast.error('Enter a number of spins.');
      return;
    }
    setSpinBusy(true);
    try {
      const balance = await grantSpins(customer.uid, delta);
      toast.success(delta > 0 ? `Granted ${delta} spin${delta === 1 ? '' : 's'} · balance ${balance}` : `Balance now ${balance}`);
      setSpinInput('1');
    } catch (e) {
      toast.error(cfError(e, 'update spins'));
    } finally {
      setSpinBusy(false);
    }
  };

  const onBlock = async () => {
    try {
      await setBlocked(customer.uid, !customer.isBlocked);
      toast.success(customer.isBlocked ? `${customer.name} unblocked` : `${customer.name} blocked`);
      setConfirmBlock(false);
    } catch (e) {
      toast.error(cfError(e, customer.isBlocked ? 'unblock the user' : 'block the user'));
    }
  };

  const onExportData = () => {
    downloadText(`${customer.uid}.json`, JSON.stringify(customer, null, 2), 'application/json');
    toast.success('Customer data exported');
  };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">{customer.name}</h1>
        <div className="flex gap-2.5">
          <Button
            variant="outline"
            className="h-[42px]"
            disabled={!canEditCustomer}
            title={canEditCustomer ? undefined : noPermissionTitle('customers', 'edit')}
            onClick={() => setConfirmBlock(true)}
          >
            {customer.isBlocked ? 'Unblock user' : 'Block user'}
          </Button>
          <Button variant="primary" className="h-[42px]" onClick={onExportData}>Export data</Button>
        </div>
      </div>

      <div className="grid grid-cols-[300px_1fr] gap-5">
        {/* LEFT */}
        <div className="flex flex-col gap-4">
          {/* Profile */}
          <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
            <div className="flex items-center gap-3">
              <Avatar name={customer.name} size={48} />
              <div>
                <div className="font-display text-[15px] font-extrabold text-text-primary">{customer.name}</div>
                <div className="mt-1 font-ui text-xs text-text-tertiary">Member since {memberSince}</div>
              </div>
            </div>
            <div className="mt-3.5 flex flex-col gap-2 font-ui text-xs leading-relaxed text-text-secondary">
              <div>{customer.phone}</div>
              {customer.email && <div>{customer.email}</div>}
            </div>
          </div>

          {/* Saved addresses. `Customer.addresses` was never rendered anywhere
              in the panel, so support could see an order's frozen delivery
              snapshot but not the customer's address book — no way to read back
              a delivery address over the phone or check why a parcel bounced. */}
          <AddressesCard addresses={customer.addresses ?? []} />

          {/* Affiliate */}
          <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-ui text-[13px] font-bold text-text-primary">Affiliate marketing</div>
                <div className="mt-1 font-ui text-[11px] leading-tight text-text-tertiary">Enable affiliate access &amp; wallet</div>
              </div>
              <Toggle checked={!!customer.affiliate?.enabled} disabled={affiliateBusy || !canEditCustomer} onChange={() => void onToggleAffiliate()} />
            </div>
            {customer.affiliate?.enabled && (
              <>
                <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
                  <span className="font-ui text-xs text-text-tertiary">Referral code</span>
                  <span className="font-ui text-[13px] font-extrabold tracking-[1px] text-brand-gold-strong">{customer.affiliate.referralCode}</span>
                </div>
                {/* Attribution is the standing sign-up link now, so the number of
                    linked customers IS this affiliate's earning surface — it was
                    only ever visible in the CSV export before. */}
                <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
                  <span className="font-ui text-xs text-text-tertiary">Referred customers</span>
                  <span className="font-ui text-[13px] font-bold text-text-primary">{customer.affiliate.referredCount ?? 0}</span>
                </div>
                {/* Commission is configured per product now, not per affiliate. */}
                <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
                  <span className="font-ui text-xs text-text-tertiary">Wallet access</span>
                  {/* Only an explicit false blocks a withdrawal (requestWithdrawal
                      and the web withdraw screen both test `=== false`), so an
                      unset flag is allowed, not disabled. */}
                  <span className="font-ui text-[13px] font-bold text-text-primary">
                    {customer.affiliate.walletEnabled === false ? 'Disabled' : 'Enabled'}
                  </span>
                </div>
                <button
                  onClick={() =>
                    canEditAffiliate
                      ? setEditTerms(true)
                      : toast.info('Changing commission terms needs the Affiliate program permission.')
                  }
                  className="mt-3 w-full font-ui text-[11px] font-semibold text-brand-primary hover:underline"
                >
                  Edit commission &amp; wallet
                </button>
              </>
            )}
            {/* Who this customer was linked to at sign-up. `referredBy` is
                written once by the linkReferral CF and never changes, and it is
                the only thing that decides where their orders' commission goes —
                so it belongs on the profile whether or not they are an affiliate
                themselves. */}
            {customer.referredBy && (
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border-subtle pt-3">
                <span className="font-ui text-xs text-text-tertiary">Referred by</span>
                <button
                  onClick={() => navigate(`/customers/${customer.referredBy!.affiliateUid}`)}
                  className="truncate font-ui text-[13px] font-bold text-brand-primary hover:underline"
                >
                  {customer.referredBy.affiliateCode}
                </button>
              </div>
            )}
          </div>

          {/* Spin & Win balance */}
          <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RiGiftLine size={18} className="text-brand-gold-strong" />
                <div className="font-ui text-[13px] font-bold text-text-primary">Spin &amp; Win</div>
              </div>
              <span className="font-display text-lg font-extrabold text-brand-primary">{customer.spinsRemaining ?? 0}</span>
            </div>
            <div className="mt-1 font-ui text-[11px] leading-tight text-text-tertiary">Spins remaining (no daily reset)</div>
            <div className="mt-3 flex items-center gap-2 border-t border-border-subtle pt-3">
              <input
                type="number"
                min={1}
                value={spinInput}
                onChange={(e) => setSpinInput(e.target.value)}
                disabled={spinBusy || !canEditCustomer}
                className="h-9 w-16 rounded-lg border border-border-default bg-surface-app px-2.5 font-ui text-sm text-text-primary outline-none focus:border-brand-primary disabled:opacity-50"
              />
              <Button
                variant="primary"
                className="h-9 flex-1"
                disabled={spinBusy || !canEditCustomer}
                title={canEditCustomer ? undefined : noPermissionTitle('customers', 'edit')}
                onClick={() => void onGrantSpins(Math.trunc(Number(spinInput)))}
              >
                Grant spins
              </Button>
            </div>
            {(customer.spinsRemaining ?? 0) > 0 && (
              <button
                onClick={() => void onGrantSpins(-(customer.spinsRemaining ?? 0))}
                disabled={spinBusy || !canEditCustomer}
                className="mt-2 w-full font-ui text-[11px] font-semibold text-error hover:underline disabled:opacity-50"
              >
                Clear balance
              </button>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div>
          {/* Tabs */}
          <div className="mb-[18px] flex gap-2">
            {([
              { key: 'orders', label: 'Orders' },
              { key: 'wallet', label: 'Wallet' },
              { key: 'affiliate', label: 'Affiliate wallet' },
            ] as { key: Tab; label: string }[]).map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'rounded-pill px-3 py-1.5 font-ui text-xs font-bold transition-colors',
                    active
                      ? 'bg-brand-primary text-white'
                      : 'border border-border-default bg-surface-card text-text-secondary hover:border-brand-primary hover:text-brand-primary',
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {tab === 'orders' && <OrdersTab uid={customer.uid} />}
          {tab === 'wallet' && <WalletTab uid={customer.uid} customer={customer} canAdjust={canEditCustomer} />}
          {tab === 'affiliate' && <AffiliateTab uid={customer.uid} customer={customer} />}
        </div>
      </div>

      <ConfirmDialog
        open={confirmBlock}
        variant={customer.isBlocked ? 'primary' : 'danger'}
        title={customer.isBlocked ? 'Unblock this user?' : 'Block this user?'}
        body={
          customer.isBlocked
            ? <><strong className="text-text-primary">{customer.name}</strong> will regain access to their account and orders.</>
            : <><strong className="text-text-primary">{customer.name}</strong> won’t be able to sign in or place orders until unblocked.</>
        }
        confirmLabel={customer.isBlocked ? 'Unblock user' : 'Block user'}
        onConfirm={onBlock}
        onCancel={() => setConfirmBlock(false)}
      />

      {editTerms && customer.affiliate?.enabled && (
        <AffiliateTermsModal customer={customer} onClose={() => setEditTerms(false)} />
      )}
    </div>
  );
}

/**
 * Change an existing affiliate's commission rate and wallet access.
 *
 * Lives on the profile because this is the only per-affiliate screen the panel
 * has — the Affiliate program screen lists withdrawal REQUESTS, not affiliates,
 * and already routes here by clicking the affiliate's name. The rate and the
 * wallet flag were both already displayed in this card, so editing them here
 * keeps read and write in one place.
 */
function AffiliateTermsModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const canEditTerms = useCanDo('affiliateProgram', 'edit');
  const [walletEnabled, setWalletEnabled] = useState(customer.affiliate?.walletEnabled !== false);
  const [busy, setBusy] = useState(false);

  const dirty = walletEnabled !== (customer.affiliate?.walletEnabled !== false);

  const submit = async () => {
    try {
      setBusy(true);
      await updateAffiliateTerms({ uid: customer.uid, walletEnabled });
      toast.success(`${customer.name}’s affiliate access updated`);
      onClose();
    } catch (e) {
      toast.error(cfError(e, 'update the affiliate access'));
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
        <h2 className="font-display text-lg font-extrabold text-text-primary">Edit affiliate access</h2>
        <p className="mt-1.5 font-ui text-[13px] text-text-secondary">
          Commission is configured per product now — an affiliate earns whatever the products their referrals
          buy are set to pay. This controls only whether {customer.name} may withdraw their affiliate wallet.
        </p>
        <div className="mt-4 flex flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <span className="font-ui text-[13px] font-semibold text-text-secondary">Enable affiliate wallet access</span>
            <Toggle checked={walletEnabled} onChange={setWalletEnabled} disabled={busy} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2.5">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          {/* updateAffiliateTerms → requireModule(req, 'affiliateProgram', 'edit'). */}
          <Button
            variant="primary"
            loading={busy}
            disabled={!dirty || !canEditTerms}
            title={canEditTerms ? undefined : noPermissionTitle('affiliateProgram', 'edit')}
            onClick={submit}
          >
            Save changes
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The customer's saved address book. Read-only — support reads these back on a
 * call or checks a failed delivery; editing a customer's addresses is the
 * customer's own action in the app, and there is no callable for the admin to
 * do it. The default address is flagged so it matches what checkout pre-selects.
 */
function AddressesCard({ addresses }: { addresses: CustomerAddress[] }) {
  // Default first, so the address checkout pre-selects is at the top.
  const sorted = [...addresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <RiMapPin2Line size={16} className="text-brand-primary" />
        <div className="font-ui text-[13px] font-bold text-text-primary">
          Addresses{addresses.length > 0 ? ` · ${addresses.length}` : ''}
        </div>
      </div>
      {sorted.length === 0 ? (
        <p className="font-ui text-[11px] text-text-tertiary">No saved addresses.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((a) => (
            <div key={a.id} className="border-t border-border-subtle pt-3 first:border-0 first:pt-0">
              <div className="flex items-center gap-2">
                <span className="font-ui text-[12px] font-bold text-text-primary">{a.label || 'Address'}</span>
                {a.isDefault && (
                  <span className="rounded-[5px] bg-brand-primary-subtle px-1.5 py-0.5 font-ui text-[10px] font-bold text-brand-primary">
                    Default
                  </span>
                )}
              </div>
              <div className="mt-1 font-ui text-[11px] leading-relaxed text-text-secondary">
                {/* Name/phone on the address can differ from the account's — a
                    gift order, a relative receiving it — so show both. */}
                {(a.name || a.phone) && (
                  <div className="text-text-primary">
                    {a.name}
                    {a.name && a.phone ? ' · ' : ''}
                    {a.phone}
                  </div>
                )}
                <div>{a.line1}</div>
                {a.line2 && <div>{a.line2}</div>}
                <div>
                  {[a.city, a.state, a.pincode].filter(Boolean).join(', ')}
                </div>
                {a.country && <div>{a.country}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tabs ───────────────────────────────────────────────────────────
function TableCard({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card">{children}</div>;
}
function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th className={cn('whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary', right ? 'text-right' : 'text-left')}>
      {children}
    </th>
  );
}
const tdBase = 'whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px]';

function OrdersTab({ uid }: { uid: string }) {
  const navigate = useNavigate();
  // `orders` is its own module (rules accept orders OR dashboard), so a
  // customers-only sub-admin can open this profile but not read its orders.
  // Passing null skips the subscription entirely — firing it would fail the
  // whole query and leave the table looking like the customer never ordered.
  const canViewOrders = useCanView('orders', 'dashboard');
  const { data: unsorted } = useCustomerOrders(canViewOrders ? uid : null);
  const orders = [...unsorted].sort(
    (a, b) => (b.placedAt?.toMillis?.() ?? 0) - (a.placedAt?.toMillis?.() ?? 0),
  );
  return (
    <>
      <div className="mb-3 font-display text-sm font-bold text-text-primary">Order history</div>
      <TableCard>
        <table className="w-full border-collapse">
          <thead>
            <tr><Th>Order</Th><Th>Date</Th><Th>Items</Th><Th>Status</Th><Th right>Total</Th></tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">
                {canViewOrders ? 'No orders yet.' : 'Order history needs the Orders permission.'}
              </td></tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} onClick={() => navigate(`/orders/${o.id}`)} className="cursor-pointer hover:bg-surface-app">
                  <td className={cn(tdBase, 'font-bold text-text-primary')}>{o.shortId}</td>
                  <td className={cn(tdBase, 'font-medium text-text-secondary')}>{dateShort(o.placedAt?.toDate?.())}</td>
                  <td className={cn(tdBase, 'font-medium text-text-secondary')}>{o.itemsCount}</td>
                  <td className={cn(tdBase)}><OrderStatusBadge status={o.status} /></td>
                  <td className={cn(tdBase, 'text-right font-bold text-text-primary')}>{formatMoneyInt(o.totalPaise)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableCard>
    </>
  );
}

function WalletTab({
  uid,
  customer,
  canAdjust,
}: {
  uid: string;
  customer: Customer;
  /** Caller holds `customers.edit` — adminAdjustWallet's own requirement. */
  canAdjust: boolean;
}) {
  const { data: txns } = useWalletTransactions(uid);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'credit' | 'debit' | null>(null);

  const onAdjust = async (direction: 'credit' | 'debit') => {
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      toast.error('Enter an amount greater than zero.');
      return;
    }
    const amountPaise = Math.round(rupees * 100);
    setBusy(direction);
    try {
      const balancePaise = await adjustWallet(uid, direction, amountPaise, reason.trim() || undefined);
      toast.success(
        `${direction === 'credit' ? 'Added' : 'Deducted'} ${formatMoney2dp(amountPaise)} · balance ${formatMoney2dp(balancePaise)}`,
      );
      setAmount('');
      setReason('');
    } catch (e) {
      toast.error(cfError(e, direction === 'credit' ? 'add to the wallet' : 'deduct from the wallet'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="text-brand-primary"><RiWalletLine size={18} /></span>
        <span className="font-display text-sm font-bold text-text-primary">Normal wallet</span>
        <span className="ml-auto font-display text-base font-extrabold text-text-primary">{formatMoney2dp(customer.wallet.balancePaise)}</span>
      </div>

      {/* Manual adjustment (§6.5 Add / Deduct) */}
      <div className="mb-4 rounded-xl border border-border-subtle bg-surface-card p-4">
        <div className="mb-2.5 font-ui text-[13px] font-bold text-text-primary">Adjust balance</div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-10 items-center rounded-lg border border-border-default bg-surface-app px-2.5">
            <span className="mr-1 font-ui text-sm font-semibold text-text-tertiary">₹</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount"
              disabled={busy !== null || !canAdjust}
              className="w-24 bg-transparent font-ui text-sm text-text-primary outline-none placeholder:text-text-tertiary disabled:opacity-50"
            />
          </div>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            maxLength={200}
            disabled={busy !== null || !canAdjust}
            className="h-10 min-w-[160px] flex-1 rounded-lg border border-border-default bg-surface-app px-3 font-ui text-sm text-text-primary outline-none placeholder:text-text-tertiary focus:border-brand-primary disabled:opacity-50"
          />
          <Button
            variant="primary"
            className="h-10"
            disabled={busy !== null || !canAdjust}
            title={canAdjust ? undefined : noPermissionTitle('customers', 'edit')}
            onClick={() => void onAdjust('credit')}
          >
            {busy === 'credit' ? 'Adding…' : 'Add'}
          </Button>
          <Button
            variant="outline"
            className="h-10"
            disabled={busy !== null || !canAdjust}
            title={canAdjust ? undefined : noPermissionTitle('customers', 'edit')}
            onClick={() => void onAdjust('debit')}
          >
            {busy === 'debit' ? 'Deducting…' : 'Deduct'}
          </Button>
        </div>
      </div>

      <TableCard>
        <table className="w-full border-collapse">
          <thead><tr><Th>Type</Th><Th>Source</Th><Th>Date</Th><Th right>Amount</Th></tr></thead>
          <tbody>
            {txns.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">No wallet activity.</td></tr>
            ) : (
              txns.map((t) => (
                <tr key={t.id}>
                  <td className={cn(tdBase, 'font-bold text-text-primary')}>{cap(t.type)}</td>
                  <td className={cn(tdBase, 'font-medium text-text-secondary')}>{t.title || cap(t.source)}</td>
                  <td className={cn(tdBase, 'font-medium text-text-secondary')}>{dateShort(t.createdAt?.toDate?.())}</td>
                  <td
                    className={cn(
                      tdBase,
                      'text-right font-bold',
                      // Money in green, money out red — matches the sign the
                      // formatter prints and the customer's own wallet screens.
                      t.type === 'credit' ? 'text-success' : 'text-error',
                    )}
                  >
                    {formatMoneySigned(t.amountPaise, t.type)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableCard>
    </>
  );
}

/** Commission row states → the badge tones already used across the panel. */
const COMMISSION_TONE = {
  pending: 'gold',
  confirmed: 'success',
  paid: 'info',
  cancelled: 'error',
} as const;

function AffiliateTab({ uid, customer }: { uid: string; customer: Customer }) {
  const navigate = useNavigate();
  // `commissions` is gated on affiliateProgram, not on customers — a
  // customers-only sub-admin (the seeded ops@barkath.app) is entitled to this
  // profile but not to the commission ledger. Skip the read rather than let it
  // come back permission-denied; the balance below is on the customer doc, so
  // it stays visible.
  const canViewCommissions = useCanView('affiliateProgram');
  const { data: commissions } = useCommissions(canViewCommissions ? uid : null);
  // Only meaningful for an actual affiliate, and `customers` is this screen's own
  // module, so no extra permission check is needed here.
  const { data: referredRaw } = useReferredCustomers(customer.affiliate?.enabled ? uid : null);
  const referred = [...referredRaw].sort(
    (a, b) => (b.referredBy?.linkedAt?.toMillis?.() ?? 0) - (a.referredBy?.linkedAt?.toMillis?.() ?? 0),
  );
  const balance = customer.affiliate?.confirmedBalancePaise ?? 0;
  return (
    <>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="text-brand-gold-strong"><RiUserHeartLine size={18} /></span>
        <span className="font-display text-sm font-bold text-text-primary">Affiliate wallet</span>
        <span className="ml-auto font-display text-base font-extrabold text-brand-gold-strong">{formatMoney2dp(balance)}</span>
      </div>
      <TableCard>
        <table className="w-full border-collapse">
          <thead><tr><Th>Order</Th><Th>Referred customer</Th><Th>Status</Th><Th>Date</Th><Th right>Amount</Th></tr></thead>
          <tbody>
            {commissions.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">
                {canViewCommissions ? 'No affiliate earnings yet.' : 'Commission history needs the Affiliate program permission.'}
              </td></tr>
            ) : (
              commissions.map((c) => {
                // What the row is actually worth today: a return claws money back
                // through `reversedPaise`, and `unrecoveredPaise` is the part that
                // could not be taken back (the row was already paid out). Showing
                // the raw `commissionPaise` overstated a reversed row for ever.
                const reversed = Number(c.reversedPaise ?? 0);
                const unrecovered = Number(c.unrecoveredPaise ?? 0);
                const net = Math.max(0, (c.commissionPaise ?? 0) - reversed);
                return (
                  <tr key={c.id} className="hover:bg-surface-app">
                    <td className={cn(tdBase, 'font-bold text-text-primary')}>{c.orderShortId}</td>
                    <td className={cn(tdBase, 'font-medium text-text-secondary')}>{c.referredCustomerFirstName}</td>
                    <td className={cn(tdBase)}>
                      <Badge tone={COMMISSION_TONE[c.status] ?? 'neutral'}>{cap(c.status)}</Badge>
                    </td>
                    <td className={cn(tdBase, 'font-medium text-text-secondary')}>{dateShort(c.accruedAt?.toDate?.())}</td>
                    <td className={cn(tdBase, 'text-right font-bold text-text-primary')}>
                      {formatMoneySigned(net, 'credit', 2)}
                      {(reversed > 0 || unrecovered > 0) && (
                        <div className="mt-[3px] font-ui text-[11px] font-medium text-text-tertiary">
                          {reversed > 0 ? `${formatMoney2dp(reversed)} reversed` : null}
                          {reversed > 0 && unrecovered > 0 ? ' · ' : null}
                          {unrecovered > 0 ? `${formatMoney2dp(unrecovered)} unrecovered` : null}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </TableCard>

      {/* Referred customers — the standing sign-up link is the whole attribution
          story now (no per-order code exists), so this is the list of people
          whose every eligible order earns this affiliate commission. */}
      {customer.affiliate?.enabled && (
        <>
          <div className="mb-3 mt-5 font-display text-sm font-bold text-text-primary">
            Referred customers ({customer.affiliate.referredCount ?? referred.length})
          </div>
          <TableCard>
            <table className="w-full border-collapse">
              <thead><tr><Th>Customer</Th><Th>Phone</Th><Th>Linked</Th><Th right>Orders</Th></tr></thead>
              <tbody>
                {referred.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">
                    No one has signed up with this code yet.
                  </td></tr>
                ) : (
                  referred.map((r) => (
                    <tr key={r.uid} onClick={() => navigate(`/customers/${r.uid}`)} className="cursor-pointer hover:bg-surface-app">
                      <td className={cn(tdBase, 'font-bold text-text-primary')}>{r.name}</td>
                      <td className={cn(tdBase, 'font-medium text-text-secondary')}>{r.phone}</td>
                      <td className={cn(tdBase, 'font-medium text-text-secondary')}>{dateShort(r.referredBy?.linkedAt?.toDate?.())}</td>
                      <td className={cn(tdBase, 'text-right font-bold text-text-primary')}>{r.stats?.ordersCount ?? 0}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableCard>
        </>
      )}
    </>
  );
}
