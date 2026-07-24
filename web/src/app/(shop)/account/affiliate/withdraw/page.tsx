'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RiBankLine } from '@remixicon/react';
import { formatMoney2dp } from '@barkath/shared';
import { useAuth } from '@/lib/auth';
import { withdrawalFeePaise } from '@/lib/affiliate';
import { useAffiliateSettings } from '@/lib/siteSettings';
import { Button } from '@/components/ui/Button';
import { AccountShell } from '@/components/account/AccountShell';
import { WALLET_CF_MSG, callRequestWithdrawal } from '@/components/wallet/actions';

export default function WithdrawPage() {
  return (
    <AccountShell>
      <WithdrawBody />
    </AccountShell>
  );
}

function WithdrawBody() {
  const customer = useAuth((s) => s.customer);
  const affiliate = customer?.affiliate;
  const router = useRouter();

  const availablePaise = affiliate?.confirmedBalancePaise ?? 0;
  const bank = customer?.bankAccounts?.find((b) => b.isDefault) ?? customer?.bankAccounts?.[0];

  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  // Live fee schedule — the same settings doc requestWithdrawal reads, so the
  // figures below match the payout the server will record.
  const { data: affSettings } = useAffiliateSettings();
  const minWithdrawalPaise = Number(affSettings?.minWithdrawalPaise ?? 0);

  const rupees = Number(amount);
  const amountPaise = Number.isFinite(rupees) ? Math.round(rupees * 100) : 0;
  const processingFeePaise = withdrawalFeePaise(amountPaise, affSettings);
  const receivePaise = Math.max(0, amountPaise - processingFeePaise);
  const overBalance = amountPaise > availablePaise;
  const belowMin = amountPaise > 0 && amountPaise < minWithdrawalPaise;

  async function confirm() {
    if (!bank) {
      toast.error('Add a bank account first');
      return;
    }
    if (amountPaise <= 0) {
      toast.error('Enter an amount to withdraw');
      return;
    }
    if (overBalance) {
      toast.error('Amount exceeds your withdrawable balance');
      return;
    }
    // Mirrors the server's minimum so the request isn't rejected round-trip.
    if (belowMin) {
      toast.error(`Minimum withdrawal is ${formatMoney2dp(minWithdrawalPaise)}`);
      return;
    }
    // The server refuses a second request while one is open — say so up front.
    if (affiliate?.hasPendingWithdrawal) {
      toast.error('You already have a withdrawal in progress.');
      return;
    }
    // Admin's "Wallet access" toggle (customers/{uid}.affiliate.walletEnabled).
    // requestWithdrawal rejects on it with this exact copy. Only an explicit
    // false blocks — a missing flag means access was never restricted.
    if (affiliate?.walletEnabled === false) {
      toast.error('Wallet access is disabled on your account.');
      return;
    }
    setBusy(true);
    try {
      await callRequestWithdrawal({ amountPaise, bankAccountId: bank.id });
      toast.success('Withdrawal requested');
      router.push('/account/affiliate');
    } catch (e) {
      // requestWithdrawal throws distinct, user-facing failed-precondition
      // messages; only an unexpected/INTERNAL error means it isn't deployed.
      const m = (e as { message?: string })?.message;
      toast.error(m && !m.startsWith('INTERNAL') ? m : WALLET_CF_MSG);
    } finally {
      setBusy(false);
    }
  }

  if (!affiliate || !affiliate.enabled) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface-card px-8 py-16 text-center">
        <p className="font-display text-lg font-extrabold text-text-primary">Nothing to withdraw</p>
        <p className="mt-2 font-ui text-sm text-text-secondary">
          Join the affiliate programme and earn commission to withdraw.
        </p>
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <div className="flex w-full max-w-[560px] flex-col gap-[18px]">
        <h1 className="font-display text-[26px] font-extrabold tracking-[-0.02em] text-text-primary">
          Complete withdrawal
        </h1>

        <div
          className="rounded-2xl p-[22px] text-white"
          style={{ background: 'linear-gradient(120deg,#2a2118,#4a3a22)' }}
        >
          <div className="font-ui text-[11px] font-bold uppercase tracking-[0.08em] text-brand-gold">
            Withdrawable balance
          </div>
          <div className="mt-2.5 font-display text-[32px] font-extrabold leading-none">
            {formatMoney2dp(availablePaise)}
          </div>
        </div>

        {/* Amount */}
        <div className="flex flex-col gap-[7px]">
          <span className="font-ui text-[13px] font-bold text-text-primary">Amount to withdraw</span>
          <div
            className={`flex items-center gap-2 rounded-[10px] border-2 px-4 py-3.5 ${
              overBalance || belowMin ? 'border-error' : 'border-brand-primary'
            }`}
          >
            <span className="font-display text-xl font-extrabold text-text-primary">₹</span>
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="0"
              className="w-full bg-transparent font-display text-xl font-extrabold text-text-primary outline-none placeholder:text-text-tertiary"
            />
          </div>
          {overBalance ? (
            <span className="font-ui text-xs font-medium text-error">
              Only {formatMoney2dp(availablePaise)} available.
            </span>
          ) : belowMin ? (
            <span className="font-ui text-xs font-medium text-error">
              Minimum withdrawal is {formatMoney2dp(minWithdrawalPaise)}.
            </span>
          ) : (
            minWithdrawalPaise > 0 && (
              <span className="font-ui text-xs font-medium text-text-tertiary">
                Minimum withdrawal {formatMoney2dp(minWithdrawalPaise)}.
              </span>
            )
          )}
        </div>

        {/* Bank */}
        <div className="flex flex-col gap-[7px]">
          <span className="font-ui text-[13px] font-bold text-text-primary">To bank account</span>
          {bank ? (
            <div className="flex items-center gap-3 rounded-[10px] border border-border-subtle px-4 py-3.5">
              <span className="text-text-secondary">
                <RiBankLine size={20} />
              </span>
              <div className="flex-1">
                <div className="font-ui text-[13px] font-bold text-text-primary">
                  {bank.bankName} {bank.accountNumberMasked}
                </div>
                <div className="mt-[3px] font-ui text-[11px] font-medium text-text-tertiary">
                  {bank.accountHolderName}
                </div>
              </div>
              {/* The list is where an account is edited or made default —
                  /banks/new only ever ADDS another one. */}
              <Link href="/account/banks" className="font-ui text-[13px] font-bold text-brand-primary hover:underline">
                Change
              </Link>
            </div>
          ) : (
            <Link
              href="/account/banks/new"
              className="flex items-center justify-between rounded-[10px] border border-dashed border-border-default px-4 py-3.5 font-ui text-[13px] font-medium text-text-tertiary hover:bg-surface-app"
            >
              No bank account on file — add one to withdraw.
              <span className="font-bold text-brand-primary">Add</span>
            </Link>
          )}
        </div>

        {/* Summary */}
        <div className="rounded-2xl border border-border-subtle bg-surface-card p-[18px]">
          <div className="flex justify-between py-1 font-ui text-[13px] font-semibold text-text-secondary">
            <span>Processing fee</span>
            <span>{formatMoney2dp(processingFeePaise)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-border-subtle pt-2 font-display text-base font-extrabold text-text-primary">
            <span>You receive</span>
            <span>{formatMoney2dp(receivePaise)}</span>
          </div>
        </div>

        <Button theme="gold" size="l" block onClick={() => void confirm()} disabled={busy || !bank}>
          {busy ? 'Requesting…' : 'Confirm withdrawal'}
        </Button>
      </div>
    </div>
  );
}
