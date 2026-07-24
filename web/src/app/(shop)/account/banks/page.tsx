'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Timestamp, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { RiBankLine, RiEditLine, RiDeleteBinLine, RiAddLine, RiLockLine } from '@remixicon/react';
import type { BankAccount } from '@barkath/shared';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/Button';
import { AccountShell } from '@/components/account/AccountShell';
import { MAX_BANK_ACCOUNTS, PAYOUT_LOCK_MSG, usePayoutLock } from '@/components/account/bankUtils';

export default function BanksPage() {
  return (
    <AccountShell>
      <BanksBody />
    </AccountShell>
  );
}

function BanksBody() {
  const customer = useAuth((s) => s.customer)!;
  const banks = customer.bankAccounts ?? [];
  const { isLocked } = usePayoutLock(customer);
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * Deleting the default must promote another account, otherwise the withdraw
   * and affiliate screens (`find(isDefault) ?? [0]`) would silently fall back
   * to whichever account happens to sit first in the array.
   */
  async function remove(id: string) {
    if (busyId) return;
    if (isLocked(id)) return toast.error(PAYOUT_LOCK_MSG);
    if (!confirm('Delete this bank account?')) return;
    setBusyId(id);

    const rest = banks.filter((b) => b.id !== id);
    const removedWasDefault = banks.find((b) => b.id === id)?.isDefault === true;
    const next =
      removedWasDefault && rest.length > 0
        ? rest.map((b, i) => (i === 0 ? { ...b, isDefault: true, updatedAt: Timestamp.now() } : b))
        : rest;

    try {
      await updateDoc(doc(db, 'customers', customer.uid), { bankAccounts: next, updatedAt: serverTimestamp() });
      toast.success('Bank account removed.');
    } catch {
      toast.error('Could not delete the bank account.');
    } finally {
      setBusyId(null);
    }
  }

  /** Exactly one default at a time — every other account is cleared in the same write. */
  async function makeDefault(id: string) {
    if (busyId) return;
    setBusyId(id);
    const now = Timestamp.now();
    const next = banks.map((b) =>
      b.isDefault === (b.id === id) ? b : { ...b, isDefault: b.id === id, updatedAt: now },
    );
    try {
      await updateDoc(doc(db, 'customers', customer.uid), { bankAccounts: next, updatedAt: serverTimestamp() });
      toast.success('Default account updated.');
    } catch {
      toast.error('Could not update the default account.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Bank accounts</h1>
        {banks.length > 0 && banks.length < MAX_BANK_ACCOUNTS && (
          <Link href="/account/banks/new">
            <Button theme="primary" size="m">
              <RiAddLine size={17} /> Add bank account
            </Button>
          </Link>
        )}
      </div>

      {banks.length === 0 ? (
        <div className="grid max-w-[840px] place-items-center rounded-2xl border border-dashed border-border-default bg-surface-card px-8 py-14 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-brand-primary-subtle text-brand-primary">
            <RiBankLine size={26} />
          </div>
          <p className="mt-4 font-display text-lg font-extrabold text-text-primary">No bank accounts yet</p>
          <p className="mt-1.5 max-w-sm font-ui text-sm text-text-secondary">
            Add an account to receive your affiliate withdrawals.
          </p>
          <Link href="/account/banks/new" className="mt-5">
            <Button theme="primary" size="m">
              <RiAddLine size={17} /> Add bank account
            </Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="grid max-w-[840px] gap-4 sm:grid-cols-2">
            {banks.map((b) => (
              <BankCard
                key={b.id}
                bank={b}
                busy={busyId === b.id}
                locked={isLocked(b.id)}
                onDelete={() => void remove(b.id)}
                onMakeDefault={() => void makeDefault(b.id)}
              />
            ))}
          </div>
          {/* The cap is enforced by firestore.rules, so say how to get past it. */}
          {banks.length >= MAX_BANK_ACCOUNTS && (
            <p className="mt-4 max-w-[840px] font-ui text-[13px] font-medium text-text-tertiary">
              You can save up to {MAX_BANK_ACCOUNTS} bank accounts. Remove one to add another.
            </p>
          )}
        </>
      )}
    </>
  );
}

function BankCard({
  bank,
  busy,
  locked,
  onDelete,
  onMakeDefault,
}: {
  bank: BankAccount;
  busy: boolean;
  locked: boolean;
  onDelete: () => void;
  onMakeDefault: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-card p-[22px]">
      <div className="flex items-start gap-3.5">
        <span className="mt-0.5 flex-none text-brand-primary">
          <RiBankLine size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-ui text-[15px] font-bold text-text-primary">{bank.bankName}</span>
            {bank.isDefault && (
              <span className="rounded-pill bg-brand-primary-subtle px-2 py-1 font-ui text-[10px] font-extrabold tracking-[0.04em] text-brand-primary">
                DEFAULT
              </span>
            )}
          </div>
          <div className="mt-1.5 font-ui text-[13px] font-medium leading-[1.6] text-text-secondary">
            {bank.accountNumberMasked} · {bank.ifsc}
            <br />
            {[bank.accountHolderName, bank.branch].filter(Boolean).join(' · ')}
          </div>
          {locked ? (
            <span className="mt-2.5 inline-flex items-center gap-1.5 font-ui text-[12px] font-semibold text-brand-gold-strong">
              <RiLockLine size={14} /> Withdrawal in progress
            </span>
          ) : (
            !bank.isDefault && (
              <button
                type="button"
                onClick={onMakeDefault}
                disabled={busy}
                className="mt-2.5 font-ui text-[12px] font-bold text-brand-primary hover:underline disabled:opacity-50"
              >
                Make default
              </button>
            )
          )}
        </div>
        <div className="flex flex-none gap-3.5 text-text-tertiary">
          {/* Locked accounts lose their actions entirely — an open payout is
              settled manually against these exact details. */}
          {!locked && (
            <>
              <Link
                href={`/account/banks/${bank.id}`}
                aria-label="Edit bank account"
                className="transition-colors hover:text-brand-primary"
              >
                <RiEditLine size={18} />
              </Link>
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                aria-label="Delete bank account"
                className="transition-colors hover:text-error disabled:opacity-50"
              >
                <RiDeleteBinLine size={18} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
