'use client';
import { useState } from 'react';
import Link from 'next/link';
import { collection, orderBy, query } from 'firebase/firestore';
import { toast } from 'sonner';
import { RiGiftLine } from '@remixicon/react';
import {
  formatMoney2dp,
  formatMoneyInt,
  formatMoneySigned,
  type WalletTransaction,
} from '@barkath/shared';
import { useAuth } from '@/lib/auth';
import { useCollection } from '@/lib/useCollection';
import { db } from '@/lib/firebase';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { AccountShell } from '@/components/account/AccountShell';
import { TxRow } from '@/components/wallet/TxRow';
import {
  WALLET_CF_MSG,
  callTopUpWallet,
  formatDay,
  txVisual,
} from '@/components/wallet/actions';

const QUICK_AMOUNTS = [100, 500, 1000, 2000];

// Mirrors MIN_TOPUP / MAX_TOPUP in functions/src/wallet/topup.ts so an
// out-of-range amount is caught here instead of failing after a round trip.
const MIN_TOPUP_PAISE = 100_00; // ₹100
const MAX_TOPUP_PAISE = 100_000_00; // ₹1,00,000

/**
 * Display title for a ledger row.
 *
 * `title` is required by the shared type but three writers (wallet top-up,
 * cancellation refund, spin cashback) store only `description` — those rows
 * would render with a blank title. Falls back exactly like the app's
 * WalletTransaction.displayTitle so both surfaces read the same.
 */
function txTitle(tx: WalletTransaction): string {
  if (tx.title) return tx.title;
  switch (tx.source) {
    case 'topup':
      return 'Added to wallet';
    case 'spin_reward':
      return 'Spin reward credited';
    case 'cashback':
      return 'Cashback';
    case 'refund':
      return tx.orderShortId ? `Refund · ${tx.orderShortId}` : 'Refund';
    case 'order_payment':
      return tx.orderShortId ? `Used on order ${tx.orderShortId}` : 'Used on order';
    case 'withdrawal':
      return 'Withdrawal';
    case 'admin_adjust':
      return 'Wallet adjustment';
    default:
      return tx.description || 'Wallet transaction';
  }
}

export default function WalletPage() {
  return (
    <AccountShell>
      <WalletBody />
    </AccountShell>
  );
}

function WalletBody() {
  const customer = useAuth((s) => s.customer);
  const uid = customer?.uid;

  const { data: txns, loading, error } = useCollection<WalletTransaction>(
    () =>
      uid
        ? query(collection(db, 'customers', uid, 'walletTransactions'), orderBy('createdAt', 'desc'))
        : null,
    [uid],
  );

  const [addOpen, setAddOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const wallet = customer?.wallet;
  const balancePaise = wallet?.balancePaise ?? 0;
  const breakdown = wallet?.breakdown;

  async function submitTopUp() {
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      toast.error('Enter an amount to add');
      return;
    }
    const amountPaise = Math.round(rupees * 100);
    // Same bounds the callable enforces — reject here so the customer sees the
    // real reason instead of the generic "service not deployed" message.
    if (amountPaise < MIN_TOPUP_PAISE) {
      toast.error(`Minimum top-up is ${formatMoney2dp(MIN_TOPUP_PAISE)}`);
      return;
    }
    if (amountPaise > MAX_TOPUP_PAISE) {
      toast.error(`Maximum top-up is ${formatMoney2dp(MAX_TOPUP_PAISE)}`);
      return;
    }
    setBusy(true);
    try {
      const res = await callTopUpWallet(amountPaise, {
        name: customer?.name,
        email: customer?.email ?? undefined,
        contact: customer?.phone,
      });
      if (res.status === 'credited') {
        toast.success(`${formatMoney2dp(res.amountPaise ?? 0)} added to your wallet`);
        setAddOpen(false);
        setAmount('');
      } else if (res.status === 'cancelled') {
        toast.message('Payment cancelled.');
      } else {
        toast.error('We could not verify that payment. Please try again.');
      }
    } catch (e) {
      // Surface the callable's own reason (e.g. "Minimum top-up is ₹100.");
      // only an unexpected/INTERNAL failure means the service isn't reachable.
      const m = (e as { message?: string })?.message;
      toast.error(m && !m.startsWith('INTERNAL') ? m : WALLET_CF_MSG);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-8 lg:flex-row">
      <div className="flex w-full min-w-0 flex-1 flex-col gap-6">
        {/* Balance hero */}
        <div
          className="flex items-end justify-between gap-4 rounded-[18px] px-8 py-7 text-white"
          style={{ background: 'linear-gradient(120deg,var(--brand-primary),var(--brand-primary-dark))' }}
        >
          <div>
            <div className="font-ui text-xs font-bold uppercase tracking-[0.1em] opacity-80">
              Normal wallet balance
            </div>
            <div className="mt-3 font-display text-[44px] font-extrabold leading-none">
              {formatMoney2dp(balancePaise)}
            </div>
            <div className="mt-2.5 font-ui text-[13px] font-medium opacity-85">
              Usable at checkout · refunds, rewards &amp; cashback
            </div>
          </div>
          <Button theme="gold" size="m" onClick={() => setAddOpen((v) => !v)}>
            Add money
          </Button>
        </div>

        {addOpen && (
          <div className="rounded-2xl border border-border-subtle bg-surface-card p-5">
            <div className="font-display text-[15px] font-extrabold text-text-primary">Add money to wallet</div>
            <div className="mt-4 flex flex-wrap gap-2">
              {QUICK_AMOUNTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAmount(String(a))}
                  className={cn(
                    'rounded-pill border px-4 py-2 font-ui text-sm font-bold transition-colors',
                    Number(amount) === a
                      ? 'border-brand-primary bg-brand-primary-subtle text-brand-primary'
                      : 'border-border-default text-text-secondary hover:bg-surface-app',
                  )}
                >
                  ₹{a.toLocaleString('en-IN')}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex flex-1 items-center gap-2 rounded-[10px] border-2 border-brand-primary px-4 py-3">
                <span className="font-display text-lg font-extrabold text-text-primary">₹</span>
                <input
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="0"
                  className="w-full bg-transparent font-display text-lg font-extrabold text-text-primary outline-none placeholder:text-text-tertiary"
                />
              </div>
              <Button theme="primary" size="l" onClick={() => void submitTopUp()} disabled={busy}>
                {busy ? 'Please wait…' : 'Add money'}
              </Button>
            </div>
          </div>
        )}

        {/* Breakdown */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Refunds', value: breakdown?.refundsPaise ?? 0 },
            { label: 'Rewards', value: breakdown?.rewardsPaise ?? 0 },
            { label: 'Cashback', value: breakdown?.cashbackPaise ?? 0 },
          ].map((b) => (
            <div key={b.label} className="rounded-[14px] border border-border-subtle bg-surface-card p-[18px]">
              <div className="font-ui text-xs font-medium text-text-tertiary">{b.label}</div>
              <div className="mt-2 font-display text-[22px] font-extrabold leading-none text-text-primary">
                {formatMoneyInt(b.value)}
              </div>
            </div>
          ))}
        </div>

        {/* Transaction history */}
        <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-5 py-[18px] font-display text-[15px] font-extrabold text-text-primary">
            Transaction history
          </div>
          {loading ? (
            <div className="px-5 py-12 text-center font-ui text-sm text-text-tertiary">Loading…</div>
          ) : error ? (
            <div className="px-5 py-12 text-center font-ui text-sm text-error">Couldn’t load transactions.</div>
          ) : txns.length === 0 ? (
            <div className="px-5 py-12 text-center font-ui text-sm text-text-tertiary">
              No wallet activity yet.
            </div>
          ) : (
            txns.map((tx, i) => {
              const v = txVisual(tx);
              const day = formatDay(tx.createdAt);
              const subtitle = tx.orderShortId ? `${day} · #${tx.orderShortId}` : day;
              return (
                <TxRow
                  key={tx.id}
                  Icon={v.Icon}
                  iconBg={v.bg}
                  iconFg={v.fg}
                  title={txTitle(tx)}
                  subtitle={subtitle}
                  amount={formatMoneySigned(tx.amountPaise, tx.type)}
                  amountClass={v.amountClass}
                  divider={i < txns.length - 1}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Spin & win aside */}
      <aside className="w-full flex-none rounded-2xl border border-brand-gold-border bg-brand-gold-subtle p-6 lg:w-80">
        <span className="text-brand-gold-strong">
          <RiGiftLine size={26} />
        </span>
        <div className="mt-3 font-display text-lg font-extrabold leading-tight text-brand-gold-strong">
          Spin &amp; win
        </div>
        <p className="mb-4 mt-2 font-ui text-[13px] font-medium leading-relaxed text-brand-gold-strong opacity-85">
          Win cashback, coupons and rewards straight to your wallet.
        </p>
        <Link href="/account/rewards" className="block">
          <Button theme="gold" size="m" block>
            Spin now
          </Button>
        </Link>
      </aside>
    </div>
  );
}
