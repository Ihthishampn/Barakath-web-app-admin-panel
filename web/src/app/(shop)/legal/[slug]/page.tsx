'use client';
import { useParams } from 'next/navigation';
import { LegalContent } from '@/components/legal/LegalContent';
import { useContentPageBySlug } from '@/lib/siteSettings';

/**
 * Public route for any published content page.
 *
 * The account-area copy at /account/legal/{slug} sits behind the sign-in wall,
 * so footer links (which signed-out visitors follow) need this public twin.
 */
export default function LegalPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, loading } = useContentPageBySlug(slug ?? null);

  return (
    <div className="mx-auto max-w-page px-5 py-8 sm:px-10">
      {/* Heading comes from the page itself, so retitling in the admin updates it. */}
      <h1 className="mb-5 font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
        {data?.title ?? (loading ? '' : 'Page not found')}
      </h1>
      <LegalContent page={data} loading={loading} fallbackTitle={data?.title ?? 'Content'} />
    </div>
  );
}
