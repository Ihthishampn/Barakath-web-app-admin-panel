'use client';
import { AccountShell } from '@/components/account/AccountShell';
import { SettingsTabs } from '@/components/account/SettingsTabs';
import { SupportContent } from '@/components/account/SupportContent';

/** Help & support inside the account area — contact details from Firestore. */
export default function AccountSupportPage() {
  return (
    <AccountShell title="Help & support">
      <SettingsTabs />
      <SupportContent />
    </AccountShell>
  );
}
