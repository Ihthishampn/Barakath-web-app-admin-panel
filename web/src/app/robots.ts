import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

/**
 * /robots.txt
 *
 * Everything a shopper can browse is crawlable. The account area, bag,
 * checkout and the referral landing route are per-customer or transactional —
 * they have nothing to index and would only spend crawl budget (and, for
 * /r/{code}, attribute a referral to a crawler).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/account/', '/bag', '/checkout', '/signin', '/register', '/create-profile', '/r/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
