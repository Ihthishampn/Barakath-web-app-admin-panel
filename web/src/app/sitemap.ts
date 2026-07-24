import type { MetadataRoute } from 'next';
import { SITE_URL, listCategoriesForSeo, listProductsForSeo } from '@/lib/seo';

/** Re-read the catalogue at most every five minutes. */
export const revalidate = 300;

/**
 * /sitemap.xml — the static shop pages, every visible category and every
 * published product.
 *
 * `updatedAt` (an ISO string over REST) becomes `lastModified` where the
 * document has one, so a crawler can tell what actually changed.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [categories, products] = await Promise.all([listCategoriesForSeo(), listProductsForSeo()]);

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/listing`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/categories`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/search`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/support`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
  ];

  const lastModified = (iso?: string): Date | undefined => {
    if (!iso) return undefined;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };

  return [
    ...staticPages,
    ...categories.map((c) => ({
      url: `${SITE_URL}/c/${c.slug}`,
      lastModified: lastModified(c.updatedAt),
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...products.map((p) => ({
      url: `${SITE_URL}/product/${p.id}`,
      lastModified: lastModified(p.updatedAt),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];
}
