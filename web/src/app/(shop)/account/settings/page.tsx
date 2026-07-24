'use client';
import Link from 'next/link';
import { RiArrowRightSLine } from '@remixicon/react';
import { useAuth } from '@/lib/auth';
import { AccountShell } from '@/components/account/AccountShell';
import { SettingsTabs } from '@/components/account/SettingsTabs';
import { useContentPages } from '@/lib/siteSettings';

/**
 * Settings overview — mirrors the Figma design: a read-only summary of the
 * customer's personal information (linking through to the edit screen),
 * followed by the legal / help links.
 *
 * Values come from the live `customers/{uid}` document via the auth store, so
 * an edit on the personal-information screen shows here immediately.
 */
export default function SettingsPage() {
  return (
    <AccountShell title="Settings">
      <SettingsTabs />
      <SettingsBody />
    </AccountShell>
  );
}

function SettingsBody() {
  const customer = useAuth((s) => s.customer)!; // AccountShell gates on customer
  // Legal rows track the published content pages, so a new admin page lists here.
  const { pages } = useContentPages();

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <section>
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <h2 className="font-ui text-[11px] font-bold uppercase tracking-[0.06em] text-text-secondary">
            Personal information
          </h2>
          <Link
            href="/account/profile"
            className="font-ui text-[11px] font-bold uppercase tracking-[0.06em] text-text-primary hover:text-brand-primary"
          >
            Edit information
          </Link>
        </div>
        <div className="overflow-hidden rounded-[12px] border border-border bg-surface-card">
          <Row label="Full name" value={customer.name || '—'} />
          <Row label="Mobile" value={customer.phone || '—'} last />
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-ui text-[11px] font-bold uppercase tracking-[0.06em] text-text-secondary">
          Legal
        </h2>
        <div className="overflow-hidden rounded-[12px] border border-border bg-surface-card">
          {pages.map((p) => (
            <LinkRow key={p.slug} href={`/account/legal/${p.slug}`} label={p.title} />
          ))}
          <LinkRow href="/account/support" label="Help and Support" last />
        </div>
      </section>
    </div>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3.5 ${last ? '' : 'border-b border-border'}`}>
      <span className="font-ui text-[14px] text-text-secondary">{label}</span>
      <span className="truncate font-ui text-[14px] font-bold text-text-primary">{value}</span>
    </div>
  );
}

function LinkRow({ href, label, last }: { href: string; label: string; last?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-surface-app ${
        last ? '' : 'border-b border-border'
      }`}
    >
      <span className="font-ui text-[14px] text-text-primary">{label}</span>
      <RiArrowRightSLine size={18} className="flex-none text-text-tertiary" />
    </Link>
  );
}
