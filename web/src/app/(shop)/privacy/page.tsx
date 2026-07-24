'use client';
import { LegalContent } from '@/components/legal/LegalContent';
import { useContentPageBySlug } from '@/lib/siteSettings';

/**
 * Public privacy policy — kept as a standalone route because it may be linked
 * externally, but resolved by slug like every other content page so an admin
 * retitling it updates the heading too.
 */
export default function PrivacyPage() {
  const { data, loading } = useContentPageBySlug('privacy-policy');

  return (
    <div className="mx-auto max-w-page px-5 py-8 sm:px-10">
      <h1 className="mb-5 font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
        {data?.title ?? 'Privacy policy'}
      </h1>
      <LegalContent page={data} loading={loading} fallbackTitle="Privacy policy" />
    </div>
  );
}
