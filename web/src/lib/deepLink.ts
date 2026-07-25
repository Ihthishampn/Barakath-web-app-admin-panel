/**
 * Notification deep links — the ONE mapping the website uses.
 *
 * `adminSendBroadcastNotification` (functions/src/notifications/broadcast.ts)
 * validates and writes `deepLink { type, target, label }` onto every inbox doc,
 * and the same values ride along on the FCM push as the flat `deepLinkType` /
 * `deepLinkTarget` data strings. The Flutter app has navigated on them since
 * day one (app/lib/features/notifications/notifications_screen.dart `_onTap`);
 * the website read the field nowhere at all, so every targeted broadcast landed
 * as an inert row.
 *
 * The mapping below is that `_onTap` switch, expressed as hrefs:
 *   product      → /product/{target}      (target is the product DOC id — the
 *                                          CF validates it as `products/{target}`)
 *   category     → /c/{target}            (category doc id == slug)
 *   order        → /account/orders/{target}
 *   wallet       → /account/wallet
 *   affiliate    → /account/affiliate
 *   coupons      → /account/rewards       (web's "My coupons" lives on the
 *                                          rewards/Spin & Win page)
 *   notifications → /account/notifications
 *   home         → /
 *   url          → the target itself, http(s) only
 * Anything else (or a missing target) yields null, and the caller leaves the
 * surface non-navigable — exactly what it did before.
 */

export interface NotificationDeepLink {
  type: string;
  target: string | null;
  label: string | null;
}

export interface DeepLinkDestination {
  href: string;
  /** true for an admin "Custom URL" broadcast — opened in a new tab. */
  external: boolean;
}

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

/**
 * Read `deepLink` off a raw inbox document.
 *
 * The shared `InboxNotification` type still declares `deepLink: string` while
 * the function writes an object, so this takes `unknown` and narrows rather
 * than trusting the declared type. (packages/shared is another lane's file —
 * reported, not edited.)
 */
export function readDeepLink(raw: unknown): NotificationDeepLink | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const type = str(o.type);
  if (!type) return null;
  return { type, target: str(o.target), label: str(o.label) };
}

/**
 * Same link, as it arrives on a push: the server flattens it into string-only
 * `data` (FCM data values are always strings).
 */
export function deepLinkFromData(
  data: Record<string, unknown> | null | undefined,
): NotificationDeepLink | null {
  if (!data) return null;
  const type = str(data.deepLinkType);
  if (!type) return null;
  return { type, target: str(data.deepLinkTarget), label: str(data.deepLinkLabel) };
}

/** Only absolute http(s) — matches the CF's own `isHttpUrl` guard. */
function httpUrl(target: string | null): string | null {
  if (!target) return null;
  try {
    const u = new URL(target);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Where a deep link points, or null when it points nowhere we can go. */
export function deepLinkDestination(
  link: NotificationDeepLink | null | undefined,
): DeepLinkDestination | null {
  if (!link) return null;
  switch (link.type) {
    case 'product':
      return link.target ? { href: `/product/${encodeURIComponent(link.target)}`, external: false } : null;
    case 'category':
      return link.target ? { href: `/c/${encodeURIComponent(link.target)}`, external: false } : null;
    case 'order':
      return link.target ? { href: `/account/orders/${encodeURIComponent(link.target)}`, external: false } : null;
    case 'wallet':
      return { href: '/account/wallet', external: false };
    case 'affiliate':
      return { href: '/account/affiliate', external: false };
    case 'coupons':
      return { href: '/account/rewards', external: false };
    case 'notifications':
      return { href: '/account/notifications', external: false };
    case 'home':
      return { href: '/', external: false };
    case 'url': {
      const href = httpUrl(link.target);
      return href ? { href, external: true } : null;
    }
    default:
      // 'none', or a type this build does not know — inert, as before.
      return null;
  }
}
