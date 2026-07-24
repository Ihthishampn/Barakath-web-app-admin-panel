import type { Metadata } from 'next';
import { ListingView } from '@/components/catalog/ListingView';
import { SITE_URL, clampDescription, getCategoryForSeo } from '@/lib/seo';

/**
 * Server wrapper around the (unchanged) client <ListingView/>.
 *
 * `Category.seoTitle` / `seoDescription` are populated in the admin and were
 * previously never read — every category page shared the root title and
 * description. Only <head> changes here; the page renders exactly as before.
 */
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const category = await getCategoryForSeo(params.slug);
  if (!category) {
    // The page itself renders a proper not-found; keep it out of the index.
    return { title: 'Category not found · Barakath', robots: { index: false, follow: true } };
  }

  const name = category.seoTitle || category.displayName || category.name;
  const title = `${name} · Barakath`;
  const description = clampDescription(
    category.seoDescription ||
      category.description ||
      `Shop ${category.name} at Barakath. India-only, delivered.`,
  );
  const url = `${SITE_URL}/c/${category.slug}`;
  const image = category.heroImageUrl || category.iconUrl;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: 'Barakath',
      title,
      description,
      url,
      images: image ? [{ url: image, alt: category.name }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default function CategoryPage({ params }: { params: { slug: string } }) {
  return <ListingView categorySlug={params.slug} />;
}
