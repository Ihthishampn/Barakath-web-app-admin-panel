'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { RiSearchLine, RiGridLine, RiWalletLine, RiUserLine, RiShoppingBagLine, RiHome5Line } from '@remixicon/react';
import { cn } from '@/lib/cn';
import { useCart } from '@/lib/cart';
import { useAuth } from '@/lib/auth';
import { useUnreadNotifications } from '@/lib/notifications';
import { AnnouncementBar } from './AnnouncementBar';

export function Header() {
  // Distinct products, not total units: one product at qty 9 is a bag with one
  // thing in it, and a badge reading "9" reads as nine different items.
  const count = useCart((s) => s.distinctCount());
  const hydrate = useCart((s) => s.hydrate);
  const { customer, ready } = useAuth();
  const unread = useUnreadNotifications();
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const isHome = pathname === '/';
  useEffect(() => {
    hydrate();
    setMounted(true);
  }, [hydrate]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  // Account owns every /account/* route except Wallet, which has its own icon.
  const isAccountActive = pathname.startsWith('/account') && !isActive('/account/wallet');

  return (
    <header className="sticky top-0 z-40">
      {/* Utility bar — admin-managed, auto-rotating carousel */}
      <AnnouncementBar />

      {/* Nav */}
      <div className="border-b border-border-subtle bg-surface-card">
        <div className="mx-auto flex max-w-page items-center gap-4 px-4 py-3.5 sm:gap-7 sm:px-10">
          {!isHome && (
            <Link
              href="/"
              aria-label="Back to home"
              title="Back to home"
              className="grid h-10 w-10 flex-none place-items-center rounded-pill border border-border-default text-text-secondary transition-colors hover:border-brand-primary hover:text-brand-primary"
            >
              <RiHome5Line size={20} />
            </Link>
          )}
          <Link href="/" className="flex-none">
            <Image src="/images/logo.png" alt="Barakath" width={40} height={40} className="h-10 w-auto object-contain" priority />
          </Link>

          <Link
            href="/search"
            className="hidden max-w-[420px] flex-1 items-center gap-2.5 rounded-pill border border-border bg-surface-app px-[18px] py-[11px] sm:flex"
          >
            <RiSearchLine size={18} className="text-text-tertiary" />
            <span className="font-ui text-sm text-text-tertiary">Search perfumes, books, abayas…</span>
          </Link>

          <nav className="ml-auto flex items-center gap-4 text-text-secondary sm:gap-5">
            <Link href="/search" className="sm:hidden" aria-label="Search"><RiSearchLine size={22} /></Link>
            <NavIcon href="/categories" label="Categories" active={isActive('/categories')}>
              <RiGridLine size={22} />
            </NavIcon>
            <NavIcon href="/account/wallet" label="Wallet" active={isActive('/account/wallet')}>
              <RiWalletLine size={22} />
            </NavIcon>
            <NavIcon href="/account" label="Account" active={isAccountActive}>
              <RiUserLine size={22} />
              {mounted && customer && unread > 0 && (
                <span
                  aria-label="New notifications"
                  className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-surface-card bg-error"
                />
              )}
            </NavIcon>
            <NavIcon href="/bag" label="Bag" active={isActive('/bag')}>
              <RiShoppingBagLine size={22} />
              {mounted && count > 0 && (
                <span className="absolute -right-2 -top-1.5 grid min-w-[18px] place-items-center rounded-pill bg-brand-gold-strong px-[5px] py-[3px] font-ui text-[10px] font-extrabold text-white">
                  {count}
                </span>
              )}
            </NavIcon>

            {/* Sign in — shown when logged out (OTP backend still pending) */}
            {mounted && ready && !customer && (
              <Link
                href="/signin"
                className="ml-1 inline-flex h-9 items-center rounded-pill bg-brand-primary px-4 font-ui text-[13px] font-bold text-white transition-colors hover:bg-brand-primary-dark"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}

/**
 * Header action icon. The active route is highlighted in gold — per the design,
 * where the category / wallet / profile icon turns gold on its own screen.
 */
function NavIcon({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative transition-colors',
        active ? 'text-brand-gold' : 'text-text-secondary hover:text-text-primary',
      )}
    >
      {children}
    </Link>
  );
}
