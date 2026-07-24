'use client';
import { AccountShell } from '@/components/account/AccountShell';
import { BankForm } from '@/components/account/BankForm';

export default function AddBankPage() {
  return (
    <AccountShell>
      <BankForm />
    </AccountShell>
  );
}
