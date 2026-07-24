'use client';
import Link from 'next/link';
import { toast } from 'sonner';
import { RiBankLine, RiFileCopyLine, RiAddLine } from '@remixicon/react';
import { formatMoneyInt } from '@barkath/shared';
import { useAuth } from '@/lib/auth';
import { commissionRatePercent, referralShareLink } from '@/lib/affiliate';
import { Button } from '@/components/ui/Button';
import { AccountShell } from '@/components/account/AccountShell';

export default function ReferralPage() {
  return (
    <AccountShell title="Refer & earn">
      <ReferralBody />
    </AccountShell>
  );
}

function ReferralBody() {
  const customer = useAuth((s) => s.customer);
  const affiliate = customer?.affiliate;

  if (!affiliate || !affiliate.enabled) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface-card px-8 py-16 text-center">
        <p className="font-display text-lg font-extrabold text-text-primary">No referral code yet</p>
        <p className="mt-2 font-ui text-sm text-text-secondary">
          Your referral code appears here once you join the affiliate programme.
        </p>
      </div>
    );
  }

  const code = affiliate.referralCode;
  const shareLink = referralShareLink(code);
  // Same pick as the affiliate + withdraw screens: the default account is the
  // one a payout goes to, so it's the one named here.
  const payoutBank = customer?.bankAccounts?.find((b) => b.isDefault) ?? customer?.bankAccounts?.[0];

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Couldn’t copy');
    }
  }

  async function share() {
    const payload = {
      title: 'Shop on Barakath',
      text: `Use my code ${code} on Barakath`,
      url: shareLink,
    };
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(payload);
      } catch {
        /* user dismissed */
      }
    } else {
      await copy(shareLink, 'Referral link');
    }
  }

  return (
    <div className="flex flex-col items-start gap-8 lg:flex-row">
      {/* Refer & earn */}
      <div className="w-full min-w-0 flex-1">
        <div className="rounded-2xl border border-border-subtle bg-surface-card p-6">
          <button
            onClick={() => void copy(code, 'Referral code')}
            className="mb-3 flex w-full items-center justify-between rounded-[10px] border border-dashed border-brand-gold-border bg-brand-gold-subtle p-4"
          >
            <span className="font-ui text-lg font-extrabold tracking-[1px] text-brand-gold-strong">{code}</span>
            <span className="text-brand-gold-strong">
              <RiFileCopyLine size={18} />
            </span>
          </button>
          <div className="mb-3.5 break-all font-ui text-[13px] font-medium leading-relaxed text-text-tertiary">
            {shareLink}
          </div>
          <Button theme="primary" outline size="m" block onClick={() => void share()}>
            Share link
          </Button>
          <p className="mt-4 font-ui text-xs text-text-tertiary">
            You earn {commissionRatePercent(affiliate.commissionRate)}% commission on every order placed with your
            code.
            {affiliate.referredCount > 0 && ` ${affiliate.referredCount} people have used it so far.`}
          </p>
        </div>
      </div>

      {/* Withdraw funds */}
      <aside className="flex w-full flex-none flex-col gap-3.5 rounded-2xl border border-border-subtle bg-surface-card p-6 lg:w-[380px]">
        <div className="font-display text-base font-extrabold text-text-primary">Withdraw funds</div>
        <div className="py-2 text-center">
          <div className="font-ui text-xs font-medium text-text-tertiary">Available</div>
          <div className="mt-1.5 font-display text-[32px] font-extrabold leading-none text-brand-gold-strong">
            {formatMoneyInt(affiliate.confirmedBalancePaise)}
          </div>
        </div>
        {payoutBank && (
          <div className="flex items-center gap-3 rounded-[10px] border border-border-subtle p-3.5">
            <RiBankLine size={18} className="text-text-secondary" />
            <div className="flex-1 font-ui text-[13px] font-semibold text-text-primary">
              {`${payoutBank.bankName} ${payoutBank.accountNumberMasked}`}
            </div>
            {/* The list is where an account is edited or made default —
                /banks/new only ever ADDS another one. */}
            <Link href="/account/banks" className="font-ui text-[13px] font-bold text-brand-primary hover:underline">
              Change
            </Link>
          </div>
        )}
        <Link
          href="/account/banks/new"
          className="flex items-center gap-2.5 rounded-[10px] border border-dashed border-border-default p-3.5 font-ui text-[13px] font-bold text-brand-primary hover:bg-surface-app"
        >
          <RiAddLine size={18} /> Add new bank account
        </Link>
        <Link href="/account/affiliate/withdraw" className="block">
          <Button theme="gold" size="l" block>
            Request withdrawal
          </Button>
        </Link>
      </aside>
    </div>
  );
}
