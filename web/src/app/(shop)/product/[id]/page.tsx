import type { Metadata } from 'next';
import { ProductDetail } from '@/components/catalog/ProductDetail';
import {
  SITE_URL,
  clampDescription,
  getProductForSeo,
  primaryImage,
  seoInStock,
  seoSellingPaise,
  type SeoProduct,
} from '@/lib/seo';

/**
 * Server wrapper around the (unchanged) client <ProductDetail/>.
 *
 * `Product.seoTitle` / `seoDescription` are filled in by the admin for every
 * product and, until now, read by nobody: every product page inherited the root
 * layout's single title and description, so search results and shared links all
 * looked identical. The rendered UI below is byte-identical to what it was —
 * only <head> and a JSON-LD script are added.
 */
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const product = await getProductForSeo(params.id);
  if (!product) {
    // Unknown or unpublished: don't let a dead URL into the index, and don't
    // claim a title we can't stand behind.
    return { title: 'Product not found · Barakath', robots: { index: false, follow: true } };
  }

  const name = product.seoTitle || product.displayTitle || product.name;
  const title = `${name} · Barakath`;
  const description = clampDescription(
    product.seoDescription || product.description || `Buy ${name} at Barakath. India-only, delivered.`,
  );
  const url = `${SITE_URL}/product/${product.id}`;
  const image = primaryImage(product);
  const images = image ? [{ url: image, alt: name }] : undefined;

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
      images,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: { id: string } }) {
  const product = await getProductForSeo(params.id);
  return (
    <>
      {product && <ProductJsonLd product={product} />}
      <ProductDetail id={params.id} />
    </>
  );
}

/**
 * schema.org Product + Offer, so the price, availability and rating can appear
 * as a rich result. Emitted only for a product we actually resolved, and only
 * from values already on the document — nothing here is invented.
 */
function ProductJsonLd({ product }: { product: SeoProduct }) {
  const name = product.displayTitle || product.name;
  const image = primaryImage(product);
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description: clampDescription(product.seoDescription || product.description, 300),
    sku: product.id,
    url: `${SITE_URL}/product/${product.id}`,
    brand: { '@type': 'Brand', name: 'Barakath' },
    ...(image ? { image: [image] } : {}),
    offers: {
      '@type': 'Offer',
      url: `${SITE_URL}/product/${product.id}`,
      priceCurrency: 'INR',
      // Rupees with two decimals — schema.org prices are in major units.
      price: (seoSellingPaise(product) / 100).toFixed(2),
      availability: seoInStock(product)
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    },
  };
  // A rating aggregate is only valid when there is at least one review.
  if (product.ratingCount > 0 && product.rating > 0) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.rating.toFixed(1),
      reviewCount: product.ratingCount,
    };
  }
  return (
    <script
      type="application/ld+json"
      // Serialised by us from typed values; `<` is escaped so the payload can
      // never close the script tag early.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
    />
  );
}
