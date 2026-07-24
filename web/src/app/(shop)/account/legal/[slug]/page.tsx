'use client';
import { useParams } from 'next/navigation';
import { AccountShell } from '@/components/account/AccountShell';
import { SettingsTabs } from '@/components/account/SettingsTabs';
import { LegalContent } from '@/components/legal/LegalContent';
import { useContentPageBySlug } from '@/lib/siteSettings';

/** Legal pages inside the account area — any published content page, by slug. */
export default function AccountLegalPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, loading } = useContentPageBySlug(slug ?? null);

  // The lookup is async, so an unresolved slug is only genuinely missing once
  // loading has finished — otherwise every visit would flash "not found".
  if (!loading && !data) {
    return (
      <AccountShell title="Page not found">
        <SettingsTabs />
        <div className="rounded-[12px] border border-dashed border-border bg-surface-card px-6 py-12 text-center">
          <p className="font-display text-base font-extrabold text-text-primary">This page doesn’t exist</p>
          <p className="mt-2 font-ui text-sm text-text-secondary">
            It may have been unpublished. Pick another page from the chips above.
          </p>
        </div>
      </AccountShell>
    );
  }

  return (
    <AccountShell title={data?.title}>
      <SettingsTabs />
      <LegalContent page={data} loading={loading} fallbackTitle={data?.title ?? 'Content'} />
    </AccountShell>
  );
}
