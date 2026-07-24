'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useContentPages } from '@/lib/siteSettings';
import { useCategories } from '@/lib/catalog';

/**
 * The Shop column used to be four hard-coded slugs. Three of them happened to
 * exist; `/c/islamic` was a 404 and the real `back-to-school` category had no
 * link anywhere in the footer. It is now built from the same `useCategories()`
 * the header and /categories use, so it can only ever point at categories that
 * exist and are visible.
 */
const COLS: { title: string; links: { label: string; href: string }[] }[] = [
  { title: 'Account', links: [
    { label: 'Orders', href: '/account/orders' }, { label: 'Wallet', href: '/account/wallet' }, { label: 'Profile', href: '/account' },
  ] },
  { title: 'Support', links: [
    { label: 'Help center', href: '/support' }, { label: 'Contact us', href: '/support' },
    { label: 'FAQ', href: '/support' }, { label: 'Returns', href: '/account/returns' },
  ] },
  // The Company column is built at render time from the published content
  // pages, so anything an admin adds under Settings › Content appears here.
];

export function Footer() {
  const { pages } = useContentPages();
  const { data: categories } = useCategories();

  const cols = useMemo(() => {
    // Live categories, in the admin's own order. Capped at six so a large
    // catalogue can't turn the footer into a directory — "All products" carries
    // the rest.
    const shop = {
      title: 'Shop',
      links: [
        ...categories.slice(0, 6).map((c) => ({ label: c.name, href: `/c/${c.slug}` })),
        { label: 'All products', href: '/listing' },
      ],
    };
    const base = [shop, ...COLS];
    // Omit the column entirely until pages load, rather than showing a heading
    // with nothing under it.
    if (!pages.length) return base;
    return [
      ...base,
      { title: 'Company', links: pages.map((p) => ({ label: p.title, href: `/legal/${p.slug}` })) },
    ];
  }, [pages, categories]);

  return (
    <footer className="mt-16 bg-brand-primary-dark text-white">
      <div className="mx-auto flex max-w-page flex-wrap gap-x-16 gap-y-10 px-4 pb-8 pt-12 sm:px-10">
        <div className="max-w-[280px]">
          <Image src="/images/logo.png" alt="Barakath" width={40} height={40} className="mb-4 h-10 w-auto object-contain brightness-0 invert" />
          <p className="font-ui text-[13px] font-normal leading-[20.8px] text-white/70">
            Premium multi-category commerce — perfumes, books, clothing and Islamic essentials, delivered with barakah.
          </p>
          <p className="mt-4 font-ui text-xs text-white/50">© 2026 Barakath Retail Pvt Ltd · India</p>
        </div>
        <div className="flex flex-1 flex-wrap gap-x-16 gap-y-10">
          {cols.map((col) => (
            <div key={col.title}>
              <div className="mb-3 font-ui text-[13px] font-extrabold">{col.title}</div>
              <ul className="flex flex-col gap-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="font-ui text-[13px] text-white/70 transition-colors hover:text-white">{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
