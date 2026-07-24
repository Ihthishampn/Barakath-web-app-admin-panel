'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { deepLinkDestination, deepLinkFromData } from '@/lib/deepLink';
import { onForegroundMessage, syncPushToken } from '@/lib/push';

/**
 * Keeps this browser's FCM registration current, and shows pushes that arrive
 * while the tab is focused.
 *
 * FCM deliberately does NOT display a notification for a foregrounded page —
 * without this a broadcast that landed while the customer was on the site
 * simply vanished. The alert is the existing sonner toast (no new UI), and its
 * action routes through the SAME deep-link mapping the inbox rows and the
 * service worker use.
 *
 * Everything here no-ops silently when web push is unconfigured (no VAPID key)
 * or unsupported by the browser — see src/lib/push.ts.
 */
export function PushBridge() {
  const router = useRouter();
  const uid = useAuth((s) => s.customer?.uid ?? null);

  // Re-register on every sign-in. Never prompts (see syncPushToken): a customer
  // who has already allowed notifications just keeps a live token, which FCM
  // rotates on its own schedule.
  useEffect(() => {
    if (!uid) return;
    void syncPushToken(uid);
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    let unsub: (() => void) | null = null;
    let cancelled = false;

    void onForegroundMessage((payload) => {
      const data = (payload.data ?? {}) as Record<string, string>;
      const title = payload.notification?.title ?? data.title ?? 'Barakath';
      const body = payload.notification?.body ?? data.body;
      const dest = deepLinkDestination(deepLinkFromData(data));
      toast(title, {
        description: body,
        action: dest
          ? {
              label: 'View',
              onClick: () => {
                if (dest.external) window.open(dest.href, '_blank', 'noopener,noreferrer');
                else router.push(dest.href);
              },
            }
          : undefined,
      });
    }).then((u) => {
      if (cancelled) u?.();
      else unsub = u;
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [uid, router]);

  return null;
}
