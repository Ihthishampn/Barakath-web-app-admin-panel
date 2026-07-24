'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  RiUser3Line, RiShoppingBagLine, RiHeartLine, RiWalletLine, RiUserHeartLine, RiMapPinLine,
  RiNotificationLine, RiSettingsLine, RiLogoutBoxRLine, RiGiftLine, RiRefreshLine,
} from '@remixicon/react';
import { useAuth, signOutCustomer } from '@/lib/auth';
import { useUnreadNotifications } from '@/lib/notifications';
import { cn } from '@/lib/cn';

// Prototype account sidebar + Personal info / Wishlist.
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

/** Shared account layout: profile + left nav sidebar (prototype §account). */
export function AccountShell({ title, children }: { title?: string; children: React.ReactNode }) {
  const { customer, ready } = useAuth();
  const unread = useUnreadNotifications();
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Log out asks first — a single mis-tap on the sidebar used to sign the
  // customer straight out. Mirrors the confirm dialog the app and admin already
  // show, reusing this site's own cancel-order modal design.
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
      <aside className="h-max rounded-2xl border border-border-subtle bg-surface-card p-5">
        <div className="mb-3 flex items-center gap-3 px-2 pb-3">
          {/* `avatarUrl` is uploaded from Personal information but was never
              rendered anywhere — the sidebar always showed initials, so the
              upload looked like it had silently failed. Initials remain the
              fallback (and the fallback if the image 404s). */}
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

      <div>
        {title && <h1 className="mb-5 font-display text-[26px] font-extrabold tracking-[-0.02em] text-text-primary">{title}</h1>}
        {children}
      </div>

      {/* Log-out confirmation — same treatment as the cancel-order dialog. */}
      {confirmLogout && (
        <div
          className="fixed inset-0 z-50 grid place-items-center px-4"
          style={{ background: 'var(--scrim)' }}
          onMouseDown={(e) => e.target === e.currentTarget && !busy && setConfirmLogout(false)}
        >
          <div className="w-full max-w-[420px] rounded-2xl border border-border-subtle bg-surface-card p-7 shadow-lg">
            <h2 className="font-display text-lg font-extrabold text-text-primary">Log out?</h2>
            <p className="mt-1.5 font-ui text-[13px] leading-relaxed text-text-secondary">
              You’ll need to sign in again to place orders and see your account.
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmLogout(false)}
                disabled={busy}
                className="inline-flex h-10 items-center rounded-pill border border-border-default px-5 font-ui text-sm font-bold text-text-primary hover:bg-neutral-200 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                disabled={busy}
                className="inline-flex h-10 items-center rounded-pill bg-error px-5 font-ui text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
              >
                {busy ? 'Logging out…' : 'Log out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
