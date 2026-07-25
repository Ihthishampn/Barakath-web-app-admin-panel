'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { collection, doc, orderBy, query, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
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

/** Firestore batches cap at 500 writes — chunked so a >500-unread inbox
 *  doesn't fail atomically and leave everything unread. Mirrors the Flutter
 *  app's `notifications_repository.dart` `markAllRead`. */
const MARK_READ_CHUNK = 400;

function markAllRead(uid: string, unread: InboxNotification[]): void {
  if (unread.length === 0) return;
  for (let i = 0; i < unread.length; i += MARK_READ_CHUNK) {
    const batch = writeBatch(db);
    unread
      .slice(i, i + MARK_READ_CHUNK)
      .forEach((n) => batch.update(doc(db, 'customers', uid, 'notifications', n.id), { read: true, readAt: serverTimestamp() }));
    batch.commit().catch(() => {});
  }
  reportBroadcastOpens([...new Set(unread.map(broadcastIdOf).filter((id): id is string => !!id))]);
}

/** Single-row mark-read, fired on tap — mirrors the app's `markRead` on `_onTap`. */
function markOneRead(uid: string, n: InboxNotification): void {
  if (n.read) return;
  updateDoc(doc(db, 'customers', uid, 'notifications', n.id), { read: true, readAt: serverTimestamp() }).catch(() => {});
  reportBroadcastOpens(broadcastIdOf(n) ? [broadcastIdOf(n) as string] : []);
}

/** Calendar-day bucketing against local "now" — same two buckets as the app's
 *  `_list` (`notifications_screen.dart`): everything from today, then everything
 *  older in one "Earlier" group. */
function isToday(d: Date, now: Date): boolean {
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
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
  // highlight is visible while viewing, then clears for the next visit) — same
  // "mirror the web on leave" contract the app's `dispose()` documents.
  const unreadRef = useRef<InboxNotification[]>([]);
  unreadRef.current = data.filter((n) => !n.read);
  useEffect(() => {
    return () => markAllRead(uid, unreadRef.current);
  }, [uid]);

  const unreadCount = unreadRef.current.length;
  const now = new Date();
  const today = data.filter((n) => n.createdAt?.toDate && isToday(n.createdAt.toDate(), now));
  const earlier = data.filter((n) => !(n.createdAt?.toDate && isToday(n.createdAt.toDate(), now)));

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

  function renderRow(n: InboxNotification) {
    const Icon = iconFor(n);
    const unread = !n.read;
    const dest = destinationOf(n);
    // Unchanged row layout — only the element wrapping it (and the read/unread
    // tint) varies, so a navigable row looks and measures exactly like an
    // inert one.
    const cls = `relative flex gap-3.5 border-b border-border-subtle px-5 py-4 last:border-b-0 ${unread ? 'bg-brand-primary-subtle' : ''}`;
    const body = (
      <>
        {/* Unread: solid brand fill + white icon. Read: subtle fill + brand
            icon. Mirrors the app's `AppNotification.palette` treatment. */}
        <span
          className={`flex h-10 w-10 flex-none items-center justify-center rounded-full ${
            unread ? 'bg-brand-primary text-white' : 'bg-surface-app text-brand-primary'
          }`}
        >
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-ui text-[14px] font-bold leading-[1.3] text-text-primary">{n.title}</div>
          <div className="mt-0.5 font-ui text-[13px] font-medium leading-[1.4] text-text-secondary">{n.body}</div>
        </div>
        <span className="flex-none font-ui text-[12px] font-medium text-text-tertiary">
          {n.createdAt?.toDate ? timeAgo(n.createdAt.toDate()) : ''}
        </span>
        {/* Unread dot — same indicator the app draws on its notification cards. */}
        {unread && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-brand-primary" />}
      </>
    );
    // Immediate single-row mark-read on tap, same as the app's `_onTap` —
    // in addition to (not instead of) the mark-all-on-leave sweep above.
    const onClick = () => markOneRead(uid, n);

    // No deep link (or one this build cannot resolve) → the row stays a
    // plain, non-navigable <div>, but tapping it still marks it read.
    if (!dest) {
      return (
        <div key={n.id} onClick={onClick} className={`${cls} cursor-pointer`}>
          {body}
        </div>
      );
    }
    // A "Custom URL" broadcast leaves the site — new tab, and never with
    // an opener handle on our window.
    if (dest.external) {
      return (
        <a key={n.id} href={dest.href} target="_blank" rel="noopener noreferrer" onClick={onClick} className={cls}>
          {body}
        </a>
      );
    }
    // In-site: navigating unmounts this page, which flushes any remaining
    // read receipts (see the cleanup effect above) — but this row is marked
    // the instant it's tapped, same timing as the app.
    return (
      <Link key={n.id} href={dest.href} onClick={onClick} className={cls}>
        {body}
      </Link>
    );
  }

  return (
    <div className="max-w-[720px]">
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => markAllRead(uid, unreadRef.current)}
          disabled={unreadCount === 0}
          className={`font-ui text-[13px] font-bold ${
            unreadCount > 0 ? 'text-brand-primary hover:underline' : 'cursor-default text-text-tertiary'
          }`}
        >
          Mark all read
        </button>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-card">
        {/* Two buckets, same as the app's Today/Earlier split — everything
            from the local calendar day, then everything older in one group. */}
        {today.length > 0 && (
          <div className="border-b border-border-subtle px-5 pb-1.5 pt-4 font-ui text-[11px] font-extrabold uppercase tracking-wide text-text-tertiary">
            Today
          </div>
        )}
        {today.map(renderRow)}
        {earlier.length > 0 && (
          <div className="border-b border-border-subtle px-5 pb-1.5 pt-4 font-ui text-[11px] font-extrabold uppercase tracking-wide text-text-tertiary">
            Earlier
          </div>
        )}
        {earlier.map(renderRow)}
      </div>
    </div>
  );
}
