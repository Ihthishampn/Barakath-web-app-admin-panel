import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RiArrowDownLine } from '@remixicon/react';
import type { Customer } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cfError } from '@/lib/cfError';
import { useCanView } from '@/features/auth/useCanView';
import { noPermissionTitle, useCanDo } from '@/features/auth/useCan';
import { useCustomersList } from '@/features/customers/api/customers';
import {
  allocateAffiliate,
  formatRate,
  rateFraction,
  rateOptionsFor,
  ratePercent,
  updateAffiliateTerms,
} from '../api/affiliate';

/** Preview of the code the server will assign — first name + short suffix. */
function previewCode(name: string, uid: string): string {
  const first = (name.split(' ')[0] ?? 'AFF').replace(/[^A-Za-z]/g, '').toUpperCase() || 'AFF';
  const suffix = uid.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase().padEnd(4, 'X');
  return `${first.slice(0, 6)}-${suffix}`;
}

export function AllocateAffiliatePage() {
  const navigate = useNavigate();
  // This screen is gated on affiliateProgram, but the roster it picks from lives
  // in `customers`, which firestore.rules gates on the customers module. An
  // affiliate-only sub-admin firing that query gets permission-denied and an
  // empty dropdown that looks like "no eligible customers" — say so instead.
  const canViewCustomers = useCanView('customers');
  // adminAllocateAffiliate calls requireModule(req, 'affiliateProgram', 'edit').
  const canAllocate = useCanDo('affiliateProgram', 'edit');
  const { data: customers } = useCustomersList(canViewCustomers);
  const [uid, setUid] = useState('');
  const [rate, setRate] = useState('5');
  const [walletEnabled, setWalletEnabled] = useState(true);
  const [confirm, setConfirm] = useState(false);

  // Existing affiliates used to be filtered OUT of this picker, which made the
  // commission rate a write-once field: once allocated, no screen could ever
  // reach it again. They stay in the list and are marked, so this screen both
  // allocates and re-terms — which is exactly what adminAllocateAffiliate does.
  const options = useMemo(
    () =>
      customers.map((c) => ({
        value: c.uid,
        label: `${c.name} · ${c.phone}${c.affiliate?.enabled ? ' · affiliate' : ''}`,
      })),
    [customers],
  );

  const selected = useMemo<Customer | null>(
    () => customers.find((c) => c.uid === uid) ?? null,
    [customers, uid],
  );
  const existing = selected?.affiliate?.enabled ? selected.affiliate : null;

  // Load the affiliate's current terms when one is picked, so saving can never
  // silently reset a rate the admin didn't mean to touch. Keyed on uid alone —
  // re-running on every `customers` snapshot would discard edits in progress.
  useEffect(() => {
    const aff = customers.find((c) => c.uid === uid)?.affiliate;
    if (aff?.enabled) {
      setRate(String(ratePercent(aff.commissionRate) ?? 5));
      setWalletEnabled(aff.walletEnabled !== false);
    } else {
      setRate('5');
      setWalletEnabled(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // An existing affiliate keeps the code they already have — the server only
  // assigns one when there isn't one, so previewing a fresh code would lie.
  const code = existing?.referralCode ?? (selected ? previewCode(selected.name, selected.uid) : '—');
  const rateOptions = rateOptionsFor(existing?.commissionRate);
  const actionLabel = existing ? 'Save changes' : 'Allocate';

  const doAllocate = async () => {
    if (!selected) return;
    // Percent in the UI, fraction on the wire — 0.05, the shape Firestore holds.
    const commissionRate = rateFraction(Number(rate));
    try {
      if (existing) {
        await updateAffiliateTerms({ uid: selected.uid, commissionRate, walletEnabled });
        toast.success(`${selected.name}’s affiliate terms updated`);
      } else {
        await allocateAffiliate({ uid: selected.uid, commissionRate, walletEnabled });
        toast.success(`${selected.name} is now an affiliate`);
      }
      navigate('/affiliate');
    } catch (e) {
      toast.error(cfError(e, existing ? 'update the affiliate terms' : 'allocate the affiliate'));
      setConfirm(false);
    }
  };

  const onAllocateClick = () => {
    if (!canViewCustomers) return toast.info('Allocating an affiliate needs the Customers permission.');
    if (!selected) return toast.error('Select a customer to allocate.');
    const percent = Number(rate);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return toast.error('Pick a commission rate between 0% and 100%.');
    }
    setConfirm(true);
  };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Allocate affiliate</h1>
        <div className="flex gap-2.5">
          <Button variant="outline" className="h-[42px]" onClick={() => navigate('/affiliate')}>Cancel</Button>
          <Button
            variant="primary"
            className="h-[42px]"
            disabled={!canAllocate}
            title={canAllocate ? undefined : noPermissionTitle('affiliateProgram', 'edit')}
            onClick={onAllocateClick}
          >
            {actionLabel}
          </Button>
        </div>
      </div>

      <div className="flex max-w-[640px] flex-col gap-4">
        <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
          <div className="flex flex-col gap-3.5">
            {/* Search customer */}
            <Select
              label="Search customer"
              value={uid}
              onChange={setUid}
              options={options}
              placeholder={canViewCustomers ? 'Select a customer…' : 'Needs the Customers permission'}
            />

            {/* Picking someone who is already an affiliate is an edit, not a
                second allocation — say which one is about to happen. */}
            {existing && (
              <p className="-mt-1 font-ui text-[11px] leading-tight text-text-tertiary">
                Already an affiliate on {formatRate(existing.commissionRate)}. Saving updates their rate and wallet
                access; their referral code, balances and referrals are untouched.
              </p>
            )}

            {/* Referral code (assigned server-side; preview only) */}
            <div className="flex flex-col gap-1.5">
              <span className="font-ui text-xs font-bold text-text-primary">Referral code</span>
              <div className="flex h-[42px] items-center rounded-sm border border-border-default bg-surface-card px-3 font-ui text-[13px] font-medium text-text-primary">
                {code}
              </div>
            </div>

            {/* Commission rate + Wallet */}
            <div className="grid grid-cols-2 gap-3.5">
              <Select label="Commission rate" value={rate} onChange={setRate} options={rateOptions} />
              <div className="flex flex-col gap-1.5">
                <span className="font-ui text-xs font-bold text-text-primary">Wallet</span>
                <div className="flex h-[42px] items-center justify-between rounded-sm border border-border-default bg-surface-card px-3 font-ui text-[13px] font-medium text-text-primary">
                  Affiliate wallet
                  <RiArrowDownLine size={16} className="text-text-tertiary" />
                </div>
              </div>
            </div>

            {/* Enable affiliate wallet access */}
            <div className="flex items-center justify-between">
              <span className="font-ui text-[13px] font-semibold text-text-secondary">Enable affiliate wallet access</span>
              <Toggle checked={walletEnabled} onChange={setWalletEnabled} />
            </div>

            {/* Commission is written at the rate in force when the order was
                placed and is never recalculated. */}
            {existing && (
              <p className="font-ui text-[11px] leading-tight text-text-tertiary">
                The new rate applies to commission earned from now on. Commission already accrued, confirmed or paid is
                not recalculated.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Confirm before granting */}
      <ConfirmDialog
        open={confirm}
        variant="primary"
        title={existing ? 'Update affiliate terms?' : 'Allocate affiliate?'}
        body={
          selected ? (
            existing ? (
              <>
                <strong className="text-text-primary">{selected.name}</strong> moves from{' '}
                {formatRate(existing.commissionRate)} to {rate}% commission, with wallet access{' '}
                {walletEnabled ? 'enabled' : 'disabled'}. Commission already accrued is not recalculated.
              </>
            ) : (
              <>
                <strong className="text-text-primary">{selected.name}</strong> will get affiliate access with a{' '}
                {rate}% commission rate{walletEnabled ? ' and affiliate wallet access' : ''}. A referral code is assigned automatically.
              </>
            )
          ) : null
        }
        confirmLabel={actionLabel}
        onConfirm={doAllocate}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
