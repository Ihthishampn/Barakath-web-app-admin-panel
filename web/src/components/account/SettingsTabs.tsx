'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { useContentPages } from '@/lib/siteSettings';

/**
 * Chip navigation across the settings sub-pages. Settings is several screens
 * (overview, personal information, notifications, help, legal) and these chips
 * let the customer move between them without going back to the sidebar.
 */
const FIXED_TABS: { href: string; label: string }[] = [
  { href: '/account/settings', label: 'Settings' },
  { href: '/account/profile', label: 'Personal information' },
  { href: '/account/settings/notifications', label: 'Notifications' },
  { href: '/account/support', label: 'Help & support' },
];

export function SettingsTabs() {
  const pathname = usePathname();
  const { pages } = useContentPages();

  // Legal chips trail the fixed ones and come straight from Firestore, so a
  // page an admin publishes just appears in the rail. While the list is still
  // loading `pages` is empty, which renders nothing rather than a placeholder
  // that would change the row height once the real chips arrive.
  const tabs = [
    ...FIXED_TABS,
    ...pages.map((p) => ({ href: `/account/legal/${p.slug}`, label: p.title })),
  ];

  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {tabs.map((t) => {
        // Exact match only — /account/settings must not stay lit on its own
        // child routes (e.g. /account/settings/notifications).
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-pill px-4 py-1.5 font-ui text-[13px] font-bold transition-colors',
              active
                ? 'bg-brand-primary text-white'
                : 'border border-border text-text-secondary hover:bg-surface-app hover:text-text-primary',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
