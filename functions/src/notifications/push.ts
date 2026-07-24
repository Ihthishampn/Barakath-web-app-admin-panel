/**
 * Shared FCM plumbing — token lookup, the `data` payload every push carries,
 * multicast delivery and dead-token pruning.
 *
 * Extracted from notifications/broadcast.ts so the admin fan-out and the
 * per-event notifications (notifications/notify.ts) send BYTE-IDENTICAL
 * payloads. Two copies of this would drift, and the half that drifted would be
 * the half whose pushes silently stop routing.
 */
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging';
import { db } from '../_lib/admin.js';

/** Firestore `in` filter cap, and FCM's per-multicast token cap. */
export const IN_FILTER_MAX = 30;
export const MULTICAST_MAX = 500;

/**
 * FCM error codes that mean this registration token will NEVER deliver again —
 * the app was uninstalled, its data cleared, or the token was rotated/burned.
 *
 * Anything else (quota, unavailable, an internal error) is transient and the
 * token must be kept.
 */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export function isDeadTokenError(err: { code?: string } | undefined): boolean {
  return !!err?.code && DEAD_TOKEN_CODES.has(err.code);
}

/**
 * Delete `fcmTokens` rows FCM has just told us are dead.
 *
 * Nothing else ever removes them. `PushTokenService` (app) deletes its own row
 * on sign-out and on rotation, but an uninstall, a cleared app storage or its
 * `permission-denied` recovery path (which deliberately burns the token and
 * leaves the old row behind) all orphan one — permanently. Left alone the
 * collection fills with addresses that can never be delivered to, and every
 * later push pays to look them up and push to them. Best-effort: a failure here
 * must never turn a delivered notification into a failed call.
 */
export async function pruneDeadTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  // Firestore caps a commit at 500 writes.
  for (let i = 0; i < tokens.length; i += 400) {
    const batch = db.batch();
    for (const t of tokens.slice(i, i + 400)) batch.delete(db.doc(`fcmTokens/${t}`));
    await batch.commit().catch((e) => console.error('push: dead token prune failed', e));
  }
}

/**
 * Registration tokens for these customers. The document id IS the token (see
 * `PushTokenService` in the app), and Firestore caps an `in` filter at 30
 * values, so the id list is chunked.
 */
export async function tokensForCustomers(customerIds: string[]): Promise<string[]> {
  const ids = [...new Set(customerIds.filter(Boolean))];
  const tokens: string[] = [];
  for (let i = 0; i < ids.length; i += IN_FILTER_MAX) {
    const snap = await db
      .collection('fcmTokens')
      .where('customerId', 'in', ids.slice(i, i + IN_FILTER_MAX))
      .get()
      .catch(() => null);
    snap?.docs.forEach((d) => {
      if (d.id) tokens.push(d.id);
    });
  }
  return tokens;
}

/**
 * A notification's destination, exactly as it is stored on the inbox document
 * (`deepLink: { type, target }`) — see notifications/broadcast.ts and the app's
 * AppNotification.fromDoc.
 */
export interface PushDeepLink {
  type: string;
  target?: string | null;
  label?: string;
}

/**
 * In-app route for a deep link, per surface.
 *
 * Clients can route from `deepLinkType`/`deepLinkTarget` alone, but a ready-made
 * path means a tapped push needs no mapping table on either side — and the two
 * surfaces genuinely differ (`/order/{id}` in the app vs `/account/orders/{id}`
 * on the web). Empty string = "no destination", never a broken route.
 */
function routesFor(dl: PushDeepLink | null | undefined): { app: string; web: string } {
  const t = (dl?.target ?? '').trim();
  switch (dl?.type) {
    case 'home':
      return { app: '/home', web: '/' };
    case 'product':
      return t ? { app: `/product/${t}`, web: `/product/${t}` } : { app: '', web: '' };
    case 'category':
      return t ? { app: `/category/${t}`, web: `/c/${t}` } : { app: '', web: '' };
    case 'order':
      return t ? { app: `/order/${t}`, web: `/account/orders/${t}` } : { app: '', web: '' };
    case 'wallet':
      return { app: '/wallet', web: '/account/wallet' };
    case 'affiliate':
      return { app: '/affiliate', web: '/account/affiliate' };
    case 'coupons':
      return { app: '/my-coupons', web: '/coupons' };
    case 'notifications':
      return { app: '/notifications', web: '/account/notifications' };
    case 'url':
      // Absolute http(s) only — the app refuses to launch anything else, and the
      // broadcast callable rejects the other shapes before they reach here.
      return { app: t, web: t };
    default:
      return { app: '', web: '' };
  }
}

export interface PushPayloadInput {
  /** The inbox document id this push corresponds to. */
  notificationId: string;
  /** Semantic category (order_status | wallet | affiliate | promo | …). */
  category: string;
  deepLink?: PushDeepLink | null;
  /** Set only for an admin broadcast, so the client can report the open. */
  broadcastId?: string | null;
  /** Extra string-valued keys (orderId, orderShortId, amountPaise, …). */
  extra?: Record<string, string | number | null | undefined>;
}

/**
 * The `data` block carried by EVERY push.
 *
 * Without it a tapped notification reaches the client with nothing but a title
 * and a body: the `deepLink` an admin configured never leaves the server, so
 * neither client can route the tap. FCM requires every data value to be a
 * STRING — a number or null silently fails the whole send with
 * `messaging/invalid-argument`, which is also one of the codes that prunes a
 * live token — so everything is stringified here and empty values are dropped.
 */
export function pushDataPayload(input: PushPayloadInput): Record<string, string> {
  const dl = input.deepLink ?? null;
  const routes = routesFor(dl);
  const raw: Record<string, string | number | null | undefined> = {
    notificationId: input.notificationId,
    category: input.category,
    deepLinkType: dl?.type ?? 'none',
    deepLinkTarget: dl?.target ?? '',
    // Ready-made destinations (see routesFor).
    appPath: routes.app,
    webPath: routes.web,
    broadcastId: input.broadcastId ?? '',
    ...(input.extra ?? {}),
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined) continue;
    const s = String(v);
    if (s.length === 0 && k !== 'deepLinkTarget') continue;
    out[k] = s;
  }
  return out;
}

export interface SendPushInput {
  tokens: string[];
  title: string;
  body: string;
  data: Record<string, string>;
}

/**
 * Multicast a notification+data message to [tokens], pruning whatever FCM
 * reports as permanently dead. Best-effort: never throws.
 *
 * The `notification` block is kept so the OS renders the alert itself (a
 * data-only message would show nothing while the app is backgrounded), and the
 * same title/body/data are mirrored into the `android` and `webpush` blocks so
 * both transports render and route identically.
 */
export async function sendPush(input: SendPushInput): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  try {
    const dead: string[] = [];
    for (let i = 0; i < input.tokens.length; i += MULTICAST_MAX) {
      const chunk = input.tokens.slice(i, i + MULTICAST_MAX);
      const message: MulticastMessage = {
        tokens: chunk,
        notification: { title: input.title, body: input.body },
        data: input.data,
        android: {
          // A transactional alert is worthless once the phone wakes up an hour
          // later; 'high' also wakes the app so a data handler can run.
          priority: 'high',
          notification: { title: input.title, body: input.body },
        },
        webpush: {
          // Chrome drops a background push it deems low priority.
          headers: { Urgency: 'high' },
          notification: { title: input.title, body: input.body },
          // NOTE: `fcmOptions.link` is deliberately NOT set — it must be an
          // absolute https URL and the storefront origin is not configured
          // anywhere on the server. `data.webPath` carries the destination for
          // the service worker's notificationclick handler instead.
          data: input.data,
        },
      };
      const res = await getMessaging().sendEachForMulticast(message).catch((e) => {
        console.error('push: multicast failed', e);
        return null;
      });
      if (!res) {
        failed += chunk.length;
        continue;
      }
      sent += res.successCount;
      failed += res.failureCount;
      res.responses.forEach((r, idx) => {
        if (!r.success && isDeadTokenError(r.error)) dead.push(chunk[idx]!);
      });
    }
    await pruneDeadTokens(dead);
  } catch (e) {
    console.error('push: send failed', e);
  }
  return { sent, failed };
}
