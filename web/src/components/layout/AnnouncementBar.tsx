'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { AnnouncementItem } from '@barkath/shared';
import { useAnnouncement } from '@/lib/siteSettings';

/** Shown until an admin publishes settings/announcement. */
const DEFAULT_ANNOUNCEMENT = 'Free delivery on Eid orders over ₹1,499 · Shop the collection';
const ROTATE_MS = 5000;

/**
 * The top utility strip. An admin can configure one or more messages
 * (settings/announcement.items); when there's more than one, the strip rotates
 * through them automatically. Falls back to the legacy single message, then to
 * a built-in default, so nothing ever flashes empty on first load.
 */
export function AnnouncementBar() {
  const { data, loading } = useAnnouncement();

  const items: AnnouncementItem[] = useMemo(() => {
    if (loading && !data) {
      return [{ id: 'default', message: DEFAULT_ANNOUNCEMENT, linkLabel: null, linkUrl: null }];
    }
    if (!data) {
      return [{ id: 'default', message: DEFAULT_ANNOUNCEMENT, linkLabel: null, linkUrl: null }];
    }
    if (!data.active) return [];
    // Prefer the items list; fall back to the legacy single message.
    const list = data.items?.length
      ? data.items
      : data.message
        ? [{ id: 'legacy', message: data.message, linkLabel: data.linkLabel ?? null, linkUrl: data.linkUrl ?? null }]
        : [];
    return list.filter((i) => i.message?.trim());
  }, [data, loading]);

  const [i, setI] = useState(0);
  const count = items.length;

  // Auto-rotate only when there's more than one message.
  useEffect(() => {
    if (count < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % count), ROTATE_MS);
    return () => clearInterval(t);
  }, [count]);

  // A message removed in the admin must not leave the index out of range.
  useEffect(() => {
    if (i >= count) setI(0);
  }, [i, count]);

  if (count === 0) return null;
  const active = items[Math.min(i, count - 1)]!;

  return (
    <div className="relative flex items-center justify-center gap-2 overflow-hidden bg-brand-primary-dark px-3 py-[9px] font-ui text-xs font-semibold text-white">
      <span className="text-brand-gold">✦</span>
      {/* keyed so each message fades in as it rotates */}
      <span key={active.id} className="animate-[fadeIn_0.4s_ease] text-center">
        {active.message}
      </span>
      {active.linkUrl && active.linkLabel && (
        <Link href={active.linkUrl} className="text-brand-gold underline underline-offset-2">
          {active.linkLabel}
        </Link>
      )}
    </div>
  );
}
