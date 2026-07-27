'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  RiUser3Line, RiShoppingBagLine, RiHeartLine, RiWalletLine, RiUserHeartLine, RiMapPinLine,
  RiNotificationLine, RiSettingsLine, RiLogoutBoxRLine, RiGiftLine, RiRefreshLine, RiCloseLine,
} from '@remixicon/react';
import { useAuth, signOutCustomer } from '@/lib/auth';
import { useUnreadNotifications } from '@/lib/notifications';
import { cn } from '@/lib/cn';

// Prototype account sidebar entries.
const NAV = [
  { label: 'Personal information', href: '/account/profile', icon: RiUser3Line },
  { label: 'My orders', href: '/account/orders', icon: RiShoppingBagLine },
  { label: 'My returns', href: '/account/returns', icon: RiRefreshLine },
  { label: 'Wishlist', href: '/account/wishlist', icon: RiHeartLine },
  { label: 'Rewards', href: '/account/rewards', icon: RiGiftLine },
  { label: 'Wallet', href: '/account/wallet', icon: RiWalletLine },
  { label: 'Affiliate wallet', href: '/account/affiliate', icon: RiUserHeartLine },
  { label: 'Saved addresses', href: '/account/addresses', icon: RiMapPinLine },
  { label: 'Notifications', href: '/account/notifications', icon: RiNotificationLine },
  { label: 'Settings', href: '/account/settings', icon: RiSettingsLine },
];

/**
 * Persistent account layout — the profile sidebar lives HERE, in a route
 * `layout`, not inside each page. Next.js keeps a layout mounted across
 * navigations between its child routes, so moving between tabs (My orders →
 * Wishlist → …) swaps only the inner content instead of tearing down and
 * rebuilding the whole shell (avatar re-fetch, nav flash) on every click.
 *
 * It also owns the auth gate: children mount only once auth is `ready` AND a
 * customer is present, so every account page mounts with a valid `customer.uid`
 * in hand. That is what stops the "No orders yet / No returns yet" flash — the
 * data hooks never run a uid-less query first; they start loading against the
 * real query straight away.
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const { customer, ready } = useAuth();
  const unread = useUnreadNotifications();
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Log out asks first — a single mis-tap on the sidebar used to sign the
  // customer straight out. Same design as the app's confirm dialog.
  const [confirmLogout, setConfirmLogout] = useState(false);

  if (!ready) {
    return <div className="mx-auto max-w-page px-5 py-20 text-center font-ui text-sm text-text-tertiary sm:px-10">Loading…</div>;
  }
  if (!customer) {
    return (
      <div className="mx-auto grid max-w-page place-items-center px-5 py-24 sm:px-10">
        <div className="rounded-2xl border border-border-subtle bg-surface-card px-8 py-12 text-center">
          <p className="font-display text-lg font-extrabold text-text-primary">Sign in to your account</p>
          <p className="mt-2 font-ui text-sm text-text-secondary">View orders, wallet, addresses and more.</p>
          <Link href="/signin" className="mt-5 inline-flex h-11 items-center rounded-pill bg-brand-primary px-6 font-ui text-sm font-bold text-white hover:bg-brand-primary-dark">Sign in</Link>
        </div>
      </div>
    );
  }

  const initials = customer.name?.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '·';

  const logout = async () => {
    setBusy(true);
    await signOutCustomer();
    router.push('/');
  };

  return (
    <div className="mx-auto grid max-w-page gap-6 px-5 py-8 sm:px-10 md:grid-cols-[280px_1fr]">
      {/* Mobile-only nav: the full vertical sidebar below would otherwise stack
          on top of every page and push the actual content far down the screen.
          On mobile we show a compact horizontal, scrollable chip bar instead;
          the sidebar reappears from `md` up (see `hidden md:block` on it), so
          the desktop/laptop layout is untouched. */}
      <nav className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:hidden">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'relative flex flex-none items-center gap-2 rounded-pill border px-4 py-2 font-ui text-[13px] font-bold transition-colors',
                active
                  ? 'border-brand-primary bg-brand-primary-subtle text-brand-primary'
                  : 'border-border-default bg-surface-card text-text-secondary',
              )}
            >
              <Icon size={16} className={active ? 'text-brand-primary' : 'text-text-tertiary'} />
              {item.label}
              {item.href === '/account/notifications' && unread > 0 && (
                <span aria-label={`${unread} unread`} className="h-2 w-2 flex-none rounded-full bg-error" />
              )}
            </Link>
          );
        })}
        <button
          onClick={() => setConfirmLogout(true)}
          disabled={busy}
          className="flex flex-none items-center gap-2 rounded-pill border border-error/40 px-4 py-2 font-ui text-[13px] font-bold text-error disabled:opacity-50"
        >
          <RiLogoutBoxRLine size={16} /> Log out
        </button>
      </nav>

      <aside className="hidden h-max rounded-2xl border border-border-subtle bg-surface-card p-5 md:block">
        <div className="mb-3 flex items-center gap-3 px-2 pb-3">
          {customer.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={customer.avatarUrl}
              alt=""
              className="h-12 w-12 flex-none rounded-pill bg-brand-primary-subtle object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <span
            className={cn(
              'grid h-12 w-12 flex-none place-items-center rounded-pill bg-brand-primary-subtle font-display text-[15px] font-extrabold text-brand-primary',
              customer.avatarUrl && 'hidden',
            )}
          >
            {initials}
          </span>
          <div className="min-w-0">
            <div className="truncate font-display text-[15px] font-extrabold text-text-primary">{customer.name}</div>
            <div className="truncate font-ui text-xs text-text-tertiary">{customer.phone}</div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-[10px] px-3.5 py-3 font-ui text-sm font-semibold transition-colors',
                  active ? 'bg-brand-primary-subtle text-brand-primary' : 'text-text-secondary hover:bg-surface-app',
                )}
              >
                <Icon size={19} className={active ? 'text-brand-primary' : 'text-text-tertiary'} />
                <span className="flex-1">{item.label}</span>
                {item.href === '/account/notifications' && unread > 0 && (
                  <span
                    aria-label={`${unread} unread`}
                    className="h-2.5 w-2.5 flex-none rounded-full bg-error"
                  />
                )}
              </Link>
            );
          })}
          <button
            onClick={() => setConfirmLogout(true)}
            disabled={busy}
            className="mt-1 flex items-center gap-3 rounded-[10px] px-3.5 py-3 font-ui text-sm font-semibold text-error hover:bg-error-subtle disabled:opacity-50"
          >
            <RiLogoutBoxRLine size={19} /> Log out
          </button>
        </nav>
      </aside>

      <div>{children}</div>

      {/* Log-out confirmation — same design as the app's AppDialog (centered
          card, red medallion, stacked full-width buttons). */}
      {confirmLogout && (
        <div
          className="fixed inset-0 z-50 grid place-items-center px-6"
          style={{ background: 'var(--scrim)' }}
          onMouseDown={(e) => e.target === e.currentTarget && !busy && setConfirmLogout(false)}
        >
          <div className="w-full max-w-[360px] rounded-2xl bg-surface-card p-7 text-center shadow-lg">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-error-subtle">
              <RiCloseLine size={24} className="text-error" />
            </div>
            <h2 className="mt-4 font-display text-lg font-extrabold text-text-primary">Log out?</h2>
            <p className="mt-2 font-ui text-sm text-text-secondary">
              You’ll need to sign in again to place orders.
            </p>
            <button
              type="button"
              onClick={() => void logout()}
              disabled={busy}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-pill bg-error font-ui text-[15px] font-bold text-white hover:opacity-90 disabled:opacity-60"
            >
              {busy ? 'Logging out…' : 'Log out'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmLogout(false)}
              disabled={busy}
              className="mt-1 flex h-11 w-full items-center justify-center font-ui text-sm font-bold text-text-secondary hover:text-text-primary disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
