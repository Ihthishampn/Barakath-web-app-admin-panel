'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { RiArrowLeftLine, RiSearchEyeLine } from '@remixicon/react';
import { useAuth } from '@/lib/auth';
import { AccountShell } from '@/components/account/AccountShell';
import { BankForm } from '@/components/account/BankForm';
import { usePayoutLock } from '@/components/account/bankUtils';

export default function EditBankPage() {
  return (
    <AccountShell>
      <Link
        href="/account/banks"
        className="mb-4 inline-flex items-center gap-1.5 font-ui text-sm font-semibold text-text-secondary hover:text-text-primary"
      >
        <RiArrowLeftLine size={16} /> Back to bank accounts
      </Link>
      <EditBankBody />
    </AccountShell>
  );
}

function EditBankBody() {
  const { id } = useParams<{ id: string }>();
  // AccountShell only renders children once the customer doc has loaded.
  const customer = useAuth((s) => s.customer)!;
  const existing = (customer.bankAccounts ?? []).find((b) => b.id === id);
  const { isLocked } = usePayoutLock(customer);

  if (!existing) return <BankNotFound />;
  // Keyed on the account id so the form re-seeds if the customer doc refreshes
  // with a different account under the same route.
  return <BankForm key={existing.id} existing={existing} locked={isLocked(existing.id)} />;
}

/** Mirrors OrderNotFound — the id in the URL isn't on this customer any more. */
function BankNotFound() {
  return (
    <div className="grid place-items-center rounded-2xl border border-border-subtle bg-surface-card px-8 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-surface-app text-text-tertiary">
        <RiSearchEyeLine size={26} />
      </span>
      <p className="mt-4 font-display text-lg font-extrabold text-text-primary">Bank account not found</p>
      <p className="mt-1.5 font-ui text-sm text-text-secondary">
        We couldn&apos;t find that account on your profile.
      </p>
      <Link
        href="/account/banks"
        className="mt-5 inline-flex h-11 items-center rounded-pill bg-brand-primary px-6 font-ui text-sm font-bold text-white hover:bg-brand-primary-dark"
      >
        Back to bank accounts
      </Link>
    </div>
  );
}
