'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, query, where } from 'firebase/firestore';
import { toast } from 'sonner';
import {
  RiBankLine,
  RiFileCopyLine,
  RiUser3Line,
  RiArrowUpLine,
} from '@remixicon/react';
import {
  formatMoneyInt,
  formatMoneySigned,
  type Commission,
  type WithdrawalRequest,
} from '@barkath/shared';
import { useAuth } from '@/lib/auth';
import { referralShareLinkShort } from '@/lib/affiliate';
import { useCollection } from '@/lib/useCollection';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/Button';
import { AccountShell } from '@/components/account/AccountShell';
import { TxRow } from '@/components/wallet/TxRow';
import { formatDayShort } from '@/components/wallet/actions';

export default function AffiliatePage() {
  return (
    <AccountShell>
      <AffiliateBody />
    </AccountShell>
  );
}

interface Activity {
  id: string;
  kind: 'commission' | 'withdrawal';
  title: string;
  subtitle: string;
  amount: string;
  ts: number;
}

/**
 * How a redemption reads once the admin has settled it.
 *
 * Taken STRAIGHT off the terminal fields approveWithdrawal / rejectWithdrawal
 * write — never inferred. `processedAt` is stamped on both outcomes, so it can
 * only date the row, never tell paid from rejected; `status` is the authority.
 */
function withdrawalOutcome(w: WithdrawalRequest): {
  line: string;
  at: WithdrawalRequest['processedAt'];
  amount: string;
} {
  if (w.status === 'paid') {
    return {
      // Payouts are settled by hand, so status 'paid' + paidAt IS the record
      // that the money reached the affiliate's bank.
      line: 'Amount credited to your bank account.',
      at: w.paidAt ?? w.processedAt ?? w.createdAt,
      // paidAmountPaise is the NET that actually landed (requested − processing
      // fee) — show that, not the gross that was asked for.
      amount: formatMoneySigned(w.paidAmountPaise ?? w.netPayoutPaise, 'debit', 0),
    };
  }
  if (w.status === 'rejected') {
    return {
      // The admin's reason, verbatim — rejectWithdrawal requires one.
      line: w.rejectionReason ?? 'Withdrawal declined.',
      at: w.rejectedAt ?? w.processedAt ?? w.createdAt,
      // Nothing was debited (paidAmountPaise is 0), so a signed −amount would
      // lie; show what was asked for instead.
      amount: formatMoneyInt(w.requestedAmountPaise),
    };
  }
  // Not settled yet: no money has moved either way, so the figure shown is the
  // net the affiliate would receive, unsigned.
  return {
    line:
      w.status === 'cancelled'
        ? 'Withdrawal cancelled.'
        : w.status === 'approved' || w.status === 'processing'
          ? 'Payout in progress.'
          : 'Awaiting approval.',
    at: w.processedAt ?? w.createdAt,
    amount: formatMoneyInt(w.netPayoutPaise),
  };
}

function AffiliateBody() {
  const customer = useAuth((s) => s.customer);
  const uid = customer?.uid;
  const affiliate = customer?.affiliate;
  const router = useRouter();

  // Index-free: filter by the owner field only (no orderBy → no composite index).
  // The activity list below sorts everything by date on the client anyway.
  const commissions = useCollection<Commission>(
    () => (uid ? query(collection(db, 'commissions'), where('affiliateUid', '==', uid)) : null),
    [uid],
  );
  const withdrawals = useCollection<WithdrawalRequest>(
    () => (uid ? query(collection(db, 'withdrawalRequests'), where('customerId', '==', uid)) : null),
    [uid],
  );

  const activity = useMemo<Activity[]>(() => {
    const rows: Activity[] = [];
    for (const c of commissions.data) {
      rows.push({
        id: `c_${c.id}`,
        kind: 'commission',
        title: `${c.referredCustomerFirstName} referred · #${c.orderShortId}`,
        subtitle: `Commission · ${formatDayShort(c.accruedAt)}`,
        amount: formatMoneySigned(c.commissionPaise, 'credit', 2),
        ts: c.accruedAt?.toMillis?.() ?? 0,
      });
    }
    for (const w of withdrawals.data) {
      const outcome = withdrawalOutcome(w);
      rows.push({
        id: `w_${w.id}`,
        kind: 'withdrawal',
        title: `Withdrawal to ${w.bankAccount.bankName} ••${w.bankAccount.accountNumberLast4}`,
        subtitle: `${outcome.line} · ${formatDayShort(outcome.at)}`,
        amount: outcome.amount,
        ts: outcome.at?.toMillis?.() ?? 0,
      });
    }
    return rows.sort((a, b) => b.ts - a.ts);
  }, [commissions.data, withdrawals.data]);

  const loading = commissions.loading || withdrawals.loading;
  const error = commissions.error || withdrawals.error;

  if (!affiliate || !affiliate.enabled) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface-card px-8 py-16 text-center">
        <p className="font-display text-lg font-extrabold text-text-primary">Become a Barakath affiliate</p>
        <p className="mx-auto mt-2 max-w-sm font-ui text-sm text-text-secondary">
          Share your referral code and earn commission every time someone shops with it.
        </p>
      </div>
    );
  }

  const referralCode = affiliate.referralCode;
  const shareLink = referralShareLinkShort(referralCode);
  const defaultBank = customer?.bankAccounts?.find((b) => b.isDefault) ?? customer?.bankAccounts?.[0];

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(referralCode);
      toast.success('Referral code copied');
    } catch {
      toast.error('Couldn’t copy');
    }
  }

  return (
    <div className="flex flex-col items-start gap-8 lg:flex-row">
      <div className="flex w-full min-w-0 flex-1 flex-col gap-6">
        {/* Earnings cards */}
        <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div
            className="rounded-[18px] p-6 text-white"
            style={{ background: 'linear-gradient(120deg,#2a2118,#4a3a22)' }}
          >
            <div className="font-ui text-[11px] font-bold uppercase tracking-[0.1em] text-brand-gold">
              Withdrawable earnings
            </div>
            <div className="mt-3 font-display text-[38px] font-extrabold leading-none">
              {formatMoneyInt(affiliate.confirmedBalancePaise)}
            </div>
            <div className="mt-2 font-ui text-xs font-medium opacity-75">
              Lifetime {formatMoneyInt(affiliate.lifetimeEarningsPaise)} earned
            </div>
          </div>
          <div className="rounded-[14px] border border-border-subtle bg-surface-card p-5">
            <div className="font-ui text-xs font-medium text-text-tertiary">Pending commission</div>
            <div className="mt-2.5 font-display text-2xl font-extrabold leading-none text-brand-gold-strong">
              {formatMoneyInt(affiliate.pendingBalancePaise)}
            </div>
            <div className="mt-1.5 font-ui text-[11px] font-medium leading-snug text-text-tertiary">
              Clears after delivery
            </div>
          </div>
          <div className="rounded-[14px] border border-border-subtle bg-surface-card p-5">
            <div className="font-ui text-xs font-medium text-text-tertiary">Confirmed</div>
            <div className="mt-2.5 font-display text-2xl font-extrabold leading-none text-success">
              {formatMoneyInt(affiliate.confirmedBalancePaise)}
            </div>
            <div className="mt-1.5 font-ui text-[11px] font-medium leading-snug text-text-tertiary">
              Ready to withdraw
            </div>
          </div>
        </div>

        {/* Commission history */}
        <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-5 py-[18px] font-display text-[15px] font-extrabold text-text-primary">
            How you earned · commission history
          </div>
          {loading ? (
            <div className="px-5 py-12 text-center font-ui text-sm text-text-tertiary">Loading…</div>
          ) : error ? (
            <div className="px-5 py-12 text-center font-ui text-sm text-error">Couldn’t load your earnings.</div>
          ) : activity.length === 0 ? (
            <div className="px-5 py-12 text-center font-ui text-sm text-text-tertiary">
              No commission yet — share your code to start earning.
            </div>
          ) : (
            activity.map((a, i) => (
              <TxRow
                key={a.id}
                Icon={a.kind === 'withdrawal' ? RiArrowUpLine : RiUser3Line}
                iconBg={a.kind === 'withdrawal' ? 'bg-neutral-200' : 'bg-brand-primary-subtle'}
                iconFg={a.kind === 'withdrawal' ? 'text-text-secondary' : 'text-brand-primary'}
                title={a.title}
                subtitle={a.subtitle}
                amount={a.amount}
                amountClass={a.kind === 'withdrawal' ? 'text-error' : 'text-success'}
                divider={i < activity.length - 1}
              />
            ))
          )}
        </div>
      </div>

      {/* Sidebar */}
      <aside className="flex w-full flex-none flex-col gap-4 lg:w-[340px]">
        <div className="rounded-2xl border border-border-subtle bg-surface-card p-[22px]">
          <div className="mb-3.5 font-display text-[15px] font-extrabold text-text-primary">Your referral</div>
          <button
            onClick={() => void copyCode()}
            className="flex w-full items-center justify-between rounded-[10px] border border-dashed border-brand-gold-border bg-brand-gold-subtle p-3.5"
          >
            <span className="font-ui text-base font-extrabold tracking-[1px] text-brand-gold-strong">
              {referralCode}
            </span>
            <span className="text-brand-gold-strong">
              <RiFileCopyLine size={18} />
            </span>
          </button>
          <div className="my-3 break-all font-ui text-xs font-medium leading-relaxed text-text-tertiary">
            {shareLink}
          </div>
          <Link href="/account/affiliate/referral" className="block">
            <Button theme="primary" outline size="m" block>
              Share link
            </Button>
          </Link>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface-card p-[22px]">
          <div className="font-display text-[15px] font-extrabold text-text-primary">Withdraw funds</div>
          {defaultBank ? (
            <div className="flex items-center gap-3 rounded-[10px] border border-border-subtle px-3.5 py-3">
              <span className="text-text-secondary">
                <RiBankLine size={18} />
              </span>
              <div className="flex-1 font-ui text-[13px] font-semibold text-text-primary">
                {defaultBank.bankName} {defaultBank.accountNumberMasked}
              </div>
              {/* The bank list is where an account is edited or made default. */}
              <button
                onClick={() => router.push('/account/banks')}
                className="font-ui text-xs font-bold text-brand-primary"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="rounded-[10px] border border-dashed border-border-default px-3.5 py-3 font-ui text-[13px] font-medium text-text-tertiary">
              Add a bank account to withdraw.
            </div>
          )}
          <Link href="/account/affiliate/withdraw" className="block">
            <Button theme="gold" size="l" block>
              Request withdrawal
            </Button>
          </Link>
        </div>
      </aside>
    </div>
  );
}
