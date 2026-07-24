/**
 * notifyCustomer — the single writer of a per-event customer notification.
 *
 * Until now `adminSendBroadcastNotification` was the ONLY thing that ever wrote
 * `customers/{uid}/notifications`, so the inbox promised "order updates, rewards
 * and wallet activity" and delivered nothing but marketing. Every real event —
 * an order moving, a refund landing, a commission clearing — now goes through
 * here, which:
 *
 *   · honours the customer's own `preferences` (the four per-channel toggles the
 *     settings screens have always written and NOTHING has ever read);
 *   · writes ONE inbox document, addressed by a caller-chosen deterministic id
 *     so a re-run of the triggering operation cannot notify twice;
 *   · pushes to that customer's registered devices with the shared payload
 *     (notifications/push.ts) so the tap can actually be routed;
 *   · NEVER throws. A notification is an accessory to the operation that
 *     triggered it — a failed push must never fail an order status change, a
 *     refund or a payout.
 */
import { db, FieldValue } from '../_lib/admin.js';
import { pushDataPayload, sendPush, tokensForCustomers, type PushDeepLink } from './push.js';

/**
 * Which of the customer's preference toggles gates a notification.
 *
 * The names are the ones both storefront settings screens write
 * (web account/settings/notifications, app Settings) and the ones declared on
 * `Customer['preferences']` in packages/shared. 'system' has no toggle of its
 * own — only the master switch applies.
 */
export type NotifyChannel = 'order' | 'wallet' | 'affiliate' | 'promotions' | 'system';

const CHANNEL_PREF: Record<NotifyChannel, string | null> = {
  order: 'notifyOrderUpdates',
  wallet: 'notifyWalletActivity',
  affiliate: 'notifyAffiliateEarnings',
  promotions: 'notifyPromotions',
  system: null,
};

/**
 * Whether this customer wants this channel.
 *
 * A MISSING flag means enabled: every customer created before a toggle existed
 * (and every customer document written by a client that does not send the whole
 * `preferences` map) must keep receiving what they always received. Only an
 * explicit `false` opts out — exactly the rule broadcast.ts already applies to
 * `notificationsEnabled`/`notifyPromotions`.
 */
export function isChannelEnabled(
  prefs: Record<string, unknown> | undefined | null,
  channel: NotifyChannel,
): boolean {
  if (prefs?.notificationsEnabled === false) return false;
  const key = CHANNEL_PREF[channel];
  if (key && prefs?.[key] === false) return false;
  return true;
}

export interface NotifyInput {
  customerId: string;
  /**
   * Document id for the inbox row — DETERMINISTIC, derived from the event.
   *
   * This is the idempotency key. Every trigger here can re-run (an admin
   * re-marking an order delivered, a retried callable, a transaction retry), and
   * the row is written with `create()`, so a repeat lands on an id that already
   * exists and the whole call — inbox row AND push — becomes a no-op.
   */
  notificationId: string;
  channel: NotifyChannel;
  /**
   * Semantic category, from packages/shared NOTIFICATION_CATEGORIES:
   * order_status | spin_reward | wallet | affiliate | promo | system | support.
   * Written to BOTH `category` (web reads this) and `type` (the app falls back
   * to it, and the broadcast fan-out has always written it).
   */
  category: 'order_status' | 'spin_reward' | 'wallet' | 'affiliate' | 'promo' | 'system' | 'support';
  title: string;
  body: string;
  deepLink?: PushDeepLink | null;
  /** Explicit icon override the clients already understand. */
  iconType?: 'truck' | 'gift' | 'check' | 'wallet' | null;
  iconColor?: 'green' | 'amber' | 'blue' | 'red' | 'gray' | null;
  /** Cross-references, as declared on the shared InboxNotification shape. */
  related?: {
    orderId?: string | null;
    orderShortId?: string | null;
    couponId?: string | null;
    withdrawalId?: string | null;
    ticketId?: string | null;
  };
  /** Extra string-valued keys for the push `data` block (all stringified). */
  pushExtra?: Record<string, string | number | null | undefined>;
}

/** Firestore's ALREADY_EXISTS — the row (and therefore the push) already happened. */
function isAlreadyExists(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  return code === 6 || code === 'already-exists';
}

/**
 * Write one inbox row and push it. Resolves to whether anything was delivered.
 * Swallows every error by design (see the file header).
 */
export async function notifyCustomer(input: NotifyInput): Promise<boolean> {
  try {
    const uid = input.customerId;
    if (!uid || !input.notificationId) return false;

    const custSnap = await db.doc(`customers/${uid}`).get();
    if (!custSnap.exists) return false;
    const prefs = custSnap.get('preferences') as Record<string, unknown> | undefined;
    if (!isChannelEnabled(prefs, input.channel)) return false;

    const ref = db.doc(`customers/${uid}/notifications/${input.notificationId}`);
    const now = FieldValue.serverTimestamp();
    const related = input.related ?? {};
    try {
      // create(), not set(): ALREADY_EXISTS is what makes a replayed trigger a
      // no-op instead of resetting a row the customer has already read.
      await ref.create({
        id: ref.id,
        title: input.title,
        body: input.body,
        // `category` is what the web inbox renders from; `type` is what the app
        // falls back to and what the broadcast fan-out has always written.
        category: input.category,
        type: input.category,
        iconType: input.iconType ?? null,
        iconColor: input.iconColor ?? null,
        deepLink: input.deepLink
          ? { type: input.deepLink.type, target: input.deepLink.target ?? null }
          : null,
        relatedOrderId: related.orderId ?? null,
        relatedOrderShortId: related.orderShortId ?? null,
        relatedCouponId: related.couponId ?? null,
        relatedWithdrawalId: related.withdrawalId ?? null,
        relatedTicketId: related.ticketId ?? null,
        // Not a broadcast — markBroadcastOpened must never try to count this one.
        broadcastId: null,
        read: false,
        readAt: null,
        archived: false,
        archivedAt: null,
        pushSent: false,
        pushSentAt: null,
        pushError: null,
        createdAt: now,
      });
    } catch (e) {
      if (isAlreadyExists(e)) return false; // already delivered — do not re-buzz
      throw e;
    }

    // Push is best-effort on top of the inbox row, which is the source of truth.
    const tokens = await tokensForCustomers([uid]);
    if (tokens.length === 0) return true;
    const { sent } = await sendPush({
      tokens,
      title: input.title,
      body: input.body,
      data: pushDataPayload({
        notificationId: ref.id,
        category: input.category,
        deepLink: input.deepLink ?? null,
        extra: {
          orderId: related.orderId ?? undefined,
          orderShortId: related.orderShortId ?? undefined,
          withdrawalId: related.withdrawalId ?? undefined,
          ...(input.pushExtra ?? {}),
        },
      }),
    });
    if (sent > 0) {
      await ref.update({ pushSent: true, pushSentAt: FieldValue.serverTimestamp() }).catch(() => undefined);
    }
    return true;
  } catch (e) {
    console.error('notifyCustomer failed', input.notificationId, e);
    return false;
  }
}

/** Rupee formatting for notification copy (₹1,234.50 → "₹1,234.50", ₹1,200 → "₹1,200"). */
export function rupees(paise: number): string {
  const value = Math.abs(Number(paise) || 0) / 100;
  const whole = Number.isInteger(value);
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
