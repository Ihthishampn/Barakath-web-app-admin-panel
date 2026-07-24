'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Timestamp, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import type { BankAccount } from '@barkath/shared';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/account/AccountControls';
import { InfoBanner } from '@/components/account/AccountStates';
import {
  ACCT_RE,
  IFSC_RE,
  MAX_BANK_ACCOUNTS,
  PAYOUT_LOCK_MSG,
  maskAccountNumber,
  useIfscLookup,
} from '@/components/account/bankUtils';

/**
 * Add / edit payout account. One form for both so the validation, the IFSC
 * lookup and the field order can never drift apart between the two routes.
 *
 * `existing` switches it to edit mode; `locked` comes from the caller's
 * usePayoutLock check (an account under an open withdrawal must not move).
 */
export function BankForm({ existing, locked = false }: { existing?: BankAccount; locked?: boolean }) {
  const router = useRouter();
  const customer = useAuth((s) => s.customer)!;
  const banks = customer.bankAccounts ?? [];

  const [holder, setHolder] = useState(existing?.accountHolderName ?? customer.name ?? '');
  // The full account number is never persisted (only `•••• 4321`), so an edit
  // cannot pre-fill it — the customer re-enters it and we re-mask on save.
  const [account, setAccount] = useState('');
  const [ifsc, setIfsc] = useState(existing?.ifsc ?? '');
  const [bankName, setBankName] = useState(existing?.bankName ?? '');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const acct = account.replace(/\D/g, '');
  const ifscU = ifsc.trim().toUpperCase();

  const { branch, resolvedBankName, ifscUnknown } = useIfscLookup(ifscU, existing?.branch ?? null);
  // The Bank name field is auto-filled from the directory and stays editable —
  // no new controls, and a manual correction survives until the IFSC changes.
  useEffect(() => {
    if (resolvedBankName) setBankName(resolvedBankName);
  }, [resolvedBankName]);

  const errors = {
    holder: !holder.trim() ? 'Required' : null,
    account: !ACCT_RE.test(acct) ? 'Enter a valid account number' : null,
    ifsc: !IFSC_RE.test(ifscU)
      ? 'Enter a valid IFSC code'
      : ifscUnknown
        ? 'No bank found for this IFSC code'
        : null,
    bankName: !bankName.trim() ? 'Required' : null,
  };
  const valid = !Object.values(errors).some(Boolean);

  async function save() {
    setTouched(true);
    if (busy) return;
    // Re-checked here as well as in the caller: the lock can flip to true from
    // the live withdrawalRequests subscription while the form is open.
    if (locked) return toast.error(PAYOUT_LOCK_MSG);
    if (!valid) return toast.error('Please fix the highlighted fields.');
    if (!existing && banks.length >= MAX_BANK_ACCOUNTS)
      return toast.error(`You can save up to ${MAX_BANK_ACCOUNTS} bank accounts.`);
    setBusy(true);

    const now = Timestamp.now();
    const record: BankAccount = {
      id: existing?.id ?? crypto.randomUUID(),
      accountHolderName: holder.trim(),
      accountNumberMasked: maskAccountNumber(acct),
      ifsc: ifscU,
      bankName: bankName.trim(),
      branch,
      // Editing never changes which account is the default — that's the list's
      // job. The very first account saved becomes the default.
      isDefault: existing?.isDefault ?? banks.length === 0,
      // Any change to the number or the IFSC invalidates a prior verification.
      verifiedAt:
        existing && existing.ifsc === ifscU && existing.accountNumberMasked === maskAccountNumber(acct)
          ? existing.verifiedAt
          : null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const next = existing ? banks.map((b) => (b.id === existing.id ? record : b)) : [...banks, record];

    try {
      await updateDoc(doc(db, 'customers', customer.uid), {
        bankAccounts: next,
        updatedAt: serverTimestamp(),
      });
      toast.success(existing ? 'Bank account updated.' : 'Bank account added.');
      router.push('/account/banks');
    } catch {
      toast.error('Could not save the bank account.');
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[640px]">
      <h1 className="mb-5 font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
        {existing ? 'Edit bank account' : 'Add bank account'}
      </h1>

      {locked && (
        <InfoBanner tone="gold" className="mb-4">
          {PAYOUT_LOCK_MSG}
        </InfoBanner>
      )}

      <div className="flex flex-col gap-4">
        <Field
          label="Account holder name"
          value={holder}
          onChange={(e) => setHolder(e.target.value)}
          error={touched ? errors.holder : null}
        />
        <Field
          label="Account number"
          inputMode="numeric"
          value={account}
          placeholder={existing ? `Currently ${existing.accountNumberMasked} — re-enter to confirm` : undefined}
          onChange={(e) => setAccount(e.target.value.replace(/\D/g, '').slice(0, 18))}
          error={touched ? errors.account : null}
        />
        <Field
          label="IFSC code"
          value={ifsc}
          onChange={(e) => setIfsc(e.target.value.toUpperCase().slice(0, 11))}
          error={touched ? errors.ifsc : null}
        />
        <Field
          label="Bank name"
          value={bankName}
          onChange={(e) => setBankName(e.target.value)}
          error={touched ? errors.bankName : null}
        />
      </div>

      <div className="mt-6 max-w-[280px]">
        <Button theme="gold" size="l" block onClick={save} disabled={busy || locked}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Save account'}
        </Button>
      </div>
    </div>
  );
}
