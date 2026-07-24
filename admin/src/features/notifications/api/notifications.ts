import { collection, orderBy, query, type Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { Customer } from '@barkath/shared';
import { db, functions } from '@/lib/firebase';
import { useLiveCollection } from '@/hooks/firestoreCache';

/**
 * A previously-sent (or scheduled/automated) push broadcast, read straight from
 * the top-level `broadcasts` collection. There is no shared type for this record
 * yet, so it is defined locally. The document is written server-side by the
 * `adminSendBroadcastNotification` Cloud Function (FCM fan-out + per-user inbox
 * writes); the admin only READS this collection.
 *
 * NOTE FOR THE INTEGRATOR: a Firestore rule for `broadcasts` is required —
 * admin read; Cloud-Function write only. See the module summary.
 */
export type BroadcastStatus = 'sent' | 'sending' | 'scheduled' | 'automated' | 'failed' | 'draft';

export interface Broadcast {
  /** Document id (stored in the doc by the CF, per this codebase's convention). */
  id: string;
  title: string;
  body: string;
  /** Audience segment id (see AUDIENCES). */
  audience: string;
  /** Denormalized human label for the audience, if the CF stored one. */
  audienceLabel?: string | null;
  deepLink?: DeepLink | null;
  /** How many devices/users were targeted (the "Sent" column). */
  reach?: number | null;
  /** How many opened it (the "Opened" column) — may be absent. */
  opened?: number | null;
  status: BroadcastStatus;
  sentAt?: Timestamp | null;
  createdAt?: Timestamp | null;
}

/**
 * The part of a sent broadcast the create form can be reopened with ("Send
 * similar"). Only plain, structured-cloneable fields — it travels in router
 * state, so Firestore Timestamps are deliberately left behind.
 */
export type BroadcastTemplate = Pick<Broadcast, 'title' | 'body' | 'audience' | 'deepLink'>;

export const BROADCASTS_KEY = 'broadcasts:createdAt-desc';

/** All broadcasts, newest first, real-time (plain admin read — not a CF). */
export function useBroadcastsList() {
  return useLiveCollection<Broadcast>(BROADCASTS_KEY, () =>
    query(collection(db, 'broadcasts'), orderBy('createdAt', 'desc')),
  );
}

// ── Status badge mapping (colours from the prototype) ────────────────
type BadgeTone = 'success' | 'info' | 'gold' | 'error' | 'neutral';

export function broadcastBadge(status: BroadcastStatus): { label: string; tone: BadgeTone } {
  switch (status) {
    case 'sent':
      return { label: 'Sent', tone: 'success' };
    case 'sending':
      return { label: 'Sending', tone: 'info' };
    case 'automated':
      return { label: 'Automated', tone: 'info' };
    case 'scheduled':
      return { label: 'Scheduled', tone: 'gold' };
    case 'failed':
      return { label: 'Failed', tone: 'error' };
    default:
      return { label: 'Draft', tone: 'neutral' };
  }
}

// ── Audience segments + reach estimate ───────────────────────────────
export interface AudienceOption {
  value: string;
  label: string;
}

/** Selectable audience segments. Reach is estimated live from `customers`. */
export const AUDIENCES: AudienceOption[] = [
  { value: 'all', label: 'All users' },
  { value: 'affiliates', label: 'Affiliate members' },
  { value: 'new_30d', label: 'New in last 30 days' },
];

export function audienceLabel(value: string): string {
  return AUDIENCES.find((a) => a.value === value)?.label ?? value;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether a customer will actually be written to by a broadcast.
 *
 * Mirrors `isBroadcastEligible` in functions/src/notifications/broadcast.ts —
 * blocked accounts are skipped (they cannot sign in, so counting them only
 * deflates the Opened/Sent ratio) and so are the customer's own opt-outs: the
 * master push switch and the "Promotions & offers" channel, which is what an
 * admin broadcast is. Keep the two predicates identical, or the estimate stops
 * matching what the Cloud Function sends.
 */
function isBroadcastEligible(c: Customer): boolean {
  if (c.isBlocked) return false;
  const prefs = c.preferences as Partial<Customer['preferences']> | undefined;
  if (prefs?.notificationsEnabled === false) return false;
  if (prefs?.notifyPromotions === false) return false;
  return true;
}

/**
 * Estimate how many users an audience segment reaches, from the real customer
 * list (same source the Customers screen loads). Grounded — no fabricated
 * numbers: every segment is a concrete filter over the loaded docs.
 */
export function estimateReach(audience: string, customers: Customer[]): number {
  const now = Date.now();
  const reachable = customers.filter(isBroadcastEligible);
  switch (audience) {
    case 'all':
      return reachable.length;
    case 'affiliates':
      return reachable.filter((c) => c.affiliate?.enabled).length;
    case 'new_30d':
      return reachable.filter((c) => {
        const ms = c.createdAt?.toMillis?.();
        return ms != null && now - ms <= THIRTY_DAYS_MS;
      }).length;
    default:
      return 0;
  }
}

// ── Deep link picker (target type → target) ──────────────────────────
export type DeepLinkType = 'home' | 'product' | 'category' | 'url';

export interface DeepLink {
  type: DeepLinkType;
  /** productId / categoryId / absolute URL. Empty for `home`. */
  target: string;
  /** Human label for display (preview / list). */
  label: string;
}

export const DEEP_LINK_TYPES: { value: DeepLinkType; label: string }[] = [
  { value: 'home', label: 'Home (no target)' },
  { value: 'product', label: 'Product' },
  { value: 'category', label: 'Category' },
  { value: 'url', label: 'Custom URL' },
];

/** Whether a chosen deep-link type needs a target selected. */
export function deepLinkNeedsTarget(type: DeepLinkType): boolean {
  return type !== 'home';
}

/**
 * Whether a custom deep-link URL can actually be opened.
 *
 * The app launches a notification's URL only when it parses and its scheme is
 * http/https (a deliberate guard); anything else — `www.barkath.com/eid`,
 * `barkath://spin` — makes the card silently inert. The Cloud Function rejects
 * the same shapes, so validate here to fail before the fan-out.
 */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Field limits (validation) ────────────────────────────────────────
export const TITLE_MAX = 60;
export const BODY_MAX = 160;

// ── Sending — CRITICAL: Cloud Function (FCM fan-out + inbox writes) ───
export interface SendBroadcastInput {
  title: string;
  body: string;
  audience: string;
  deepLink: DeepLink | null;
  /**
   * Idempotency key, stable for as long as the same message is being composed.
   * A send that fails part-way through the fan-out is naturally retried by the
   * admin; without this the retry mints a second broadcast and re-delivers to
   * everyone already written.
   */
  requestId?: string;
}

/**
 * Send a broadcast push notification. This is CRITICAL work (FCM fan-out +
 * per-user inbox writes) and must run server-side, so it calls the
 * `adminSendBroadcastNotification` Cloud Function. The function is not deployed
 * yet, so this rejects with `not-found` — surface it via `cfError`.
 */
export async function sendBroadcast(input: SendBroadcastInput): Promise<void> {
  const call = httpsCallable(functions, 'adminSendBroadcastNotification');
  await call(input);
}
