'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { collection, doc, orderBy, query, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  RiTruckLine, RiGiftLine, RiCheckLine, RiWalletLine, RiUserHeartLine,
  RiPriceTag3Line, RiCustomerService2Line, RiNotification3Line,
} from '@remixicon/react';
import type { RemixiconComponentType } from '@remixicon/react';
import type { InboxNotification, NotificationCategory } from '@barkath/shared';
import { useAuth } from '@/lib/auth';
import { db, functions } from '@/lib/firebase';
import { useCollection } from '@/lib/useCollection';
import { deepLinkDestination, readDeepLink } from '@/lib/deepLink';
import { AccountShell } from '@/components/account/AccountShell';

const CATEGORY_ICON: Record<NotificationCategory, RemixiconComponentType> = {
  order_status: RiTruckLine,
  spin_reward: RiGiftLine,
  wallet: RiWalletLine,
  affiliate: RiUserHeartLine,
  promo: RiPriceTag3Line,
  system: RiNotification3Line,
  support: RiCustomerService2Line,
};

const ICON_TYPE: Record<string, RemixiconComponentType> = {
  truck: RiTruckLine,
  gift: RiGiftLine,
  check: RiCheckLine,
  wallet: RiWalletLine,
};

function iconFor(n: InboxNotification): RemixiconComponentType {
  return (n.iconType && ICON_TYPE[n.iconType]) || CATEGORY_ICON[n.category] || RiNotification3Line;
}

/** Max broadcast ids per `markBroadcastOpened` call (matches the callable). */
const OPEN_BATCH_MAX = 50;

/**
 * `broadcastId` is written onto every broadcast-sourced inbox row by the
 * `adminSendBroadcastNotification` function, but the shared InboxNotification
 * type does not declare it yet — read it off the raw doc.
 */
function broadcastIdOf(n: InboxNotification): string | null {
  return (n as unknown as { broadcastId?: string | null }).broadcastId ?? null;
}

/**
 * Where a row leads, or null for the (unchanged) inert row.
 *
 * Same reason as `broadcastIdOf`: the function writes `deepLink` as an OBJECT
 * ({type,target,label}) while the shared type still declares it as a string, so
 * it is read off the raw doc and narrowed by `readDeepLink`.
 */
function destinationOf(n: InboxNotification) {
  return deepLinkDestination(readDeepLink((n as unknown as { deepLink?: unknown }).deepLink));
}

/**
 * Count broadcast opens — once per customer per broadcast.
 *
 * `broadcasts.opened` is a cross-user counter on a CF-only-write collection, so
 * the callable owns the increment. It can only ever be attributed while a row is
 * still unread: this page flips rows to read on leave, and the app only reports
 * opens for rows IT flips, so a broadcast read on the website was uncountable
 * afterwards and the admin's Opened column silently undercounted.
 * Best-effort — the read receipt is the source of truth and must not fail
 * because a stat write did.
 */
function reportBroadcastOpens(ids: string[]): void {
  if (ids.length === 0) return;
  const call = httpsCallable(functions, 'markBroadcastOpened');
  for (let i = 0; i < ids.length; i += OPEN_BATCH_MAX) {
    call({ broadcastIds: ids.slice(i, i + OPEN_BATCH_MAX) }).catch(() => {});
  }
}

/** Compact relative time: "2h", "1d", "3w". */
function timeAgo(d: Date): string {
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  const w = Math.floor(days / 7);
  if (w < 5) return `${w}w`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function NotificationsPage() {
  return (
    <AccountShell title="Notifications">
      <NotificationsBody />
    </AccountShell>
  );
}

function NotificationsBody() {
  const uid = useAuth((s) => s.customer)!.uid;
  const { data, loading, error } = useCollection<InboxNotification>(
    () => query(collection(db, 'customers', uid, 'notifications'), orderBy('createdAt', 'desc')),
    [uid],
  );

  // Mark unread notifications as read when the user leaves the page (so the
  // highlight is visible while viewing, then clears for the next visit).
  const unreadRef = useRef<InboxNotification[]>([]);
  unreadRef.current = data.filter((n) => !n.read);
  useEffect(() => {
    return () => {
      const unread = unreadRef.current;
      if (unread.length === 0) return;
      const batch = writeBatch(db);
      unread.forEach((n) => batch.update(doc(db, 'customers', uid, 'notifications', n.id), { read: true }));
      batch.commit().catch(() => {});
      // Report the opens in the same pass that consumes the unread flag.
      reportBroadcastOpens([
        ...new Set(unread.map(broadcastIdOf).filter((id): id is string => !!id)),
      ]);
    };
  }, [uid]);

  if (loading) {
    return (
      <div className="max-w-[720px] overflow-hidden rounded-2xl border border-border-subtle bg-surface-card">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3.5 border-b border-border-subtle px-5 py-4 last:border-b-0">
            <div className="h-10 w-10 flex-none animate-pulse rounded-full bg-neutral-200" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-200" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-200" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-[720px] rounded-2xl border border-border-subtle bg-surface-card px-8 py-12 text-center">
        <p className="font-ui text-sm font-semibold text-text-secondary">Could not load your notifications.</p>
        <p className="mt-1 font-ui text-[13px] text-text-tertiary">Please check your connection and try again.</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="grid max-w-[720px] place-items-center rounded-2xl border border-border-subtle bg-surface-card px-8 py-14 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-brand-primary-subtle text-brand-primary">
          <RiNotification3Line size={26} />
        </div>
        <p className="mt-4 font-display text-lg font-extrabold text-text-primary">You're all caught up</p>
        <p className="mt-1.5 max-w-sm font-ui text-sm text-text-secondary">Order updates, rewards and wallet activity will show up here.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[720px] overflow-hidden rounded-2xl border border-border-subtle bg-surface-card">
      {data.map((n) => {
        const Icon = iconFor(n);
        const unread = !n.read;
        const dest = destinationOf(n);
        // Unchanged row markup — only the element wrapping it varies, so a
        // navigable row looks and measures exactly like an inert one.
        const cls = `flex gap-3.5 border-b border-border-subtle px-5 py-4 last:border-b-0 ${unread ? 'bg-brand-primary-subtle' : ''}`;
        const body = (
          <>
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-surface-app text-brand-primary">
              <Icon size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-ui text-[14px] font-bold leading-[1.3] text-text-primary">{n.title}</div>
              <div className="mt-0.5 font-ui text-[13px] font-medium leading-[1.4] text-text-secondary">{n.body}</div>
            </div>
            <span className="flex-none font-ui text-[12px] font-medium text-text-tertiary">
              {n.createdAt?.toDate ? timeAgo(n.createdAt.toDate()) : ''}
            </span>
          </>
        );

        // No deep link (or one this build cannot resolve) → the row stays a
        // plain, non-navigable <div>, exactly as before.
        if (!dest) {
          return (
            <div key={n.id} className={cls}>
              {body}
            </div>
          );
        }
        // A "Custom URL" broadcast leaves the site — new tab, and never with
        // an opener handle on our window.
        if (dest.external) {
          return (
            <a key={n.id} href={dest.href} target="_blank" rel="noopener noreferrer" className={cls}>
              {body}
            </a>
          );
        }
        // In-site: navigating unmounts this page, which is what flushes the
        // read receipts (see the cleanup effect above) — the same "tap marks
        // it read" behaviour the app has.
        return (
          <Link key={n.id} href={dest.href} className={cls}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}
