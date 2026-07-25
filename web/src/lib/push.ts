'use client';
/**
 * Web push (FCM) for the storefront.
 *
 * `adminSendBroadcastNotification` has always multicast to the top-level
 * `fcmTokens` collection — `where('customerId','in',[…])`, **document id IS the
 * registration token** — but only the Flutter app ever wrote a row there
 * (app/lib/core/services/push_token_service.dart). The website had no service
 * worker, no VAPID key and no getToken call, so a broadcast could never reach a
 * browser. This module is the web writer, and it writes the SAME document shape
 * as the app because ONE collection serves both platforms and firestore.rules
 * constrains it (`customerId == uid()` on create/update/delete).
 *
 * ── VAPID ─────────────────────────────────────────────────────────────────
 * Web push additionally needs the project's Web Push certificate key pair,
 * which can only be generated in Firebase Console ▸ Project settings ▸ Cloud
 * Messaging ▸ Web Push certificates. Paste the public key into
 * `NEXT_PUBLIC_FIREBASE_VAPID_KEY` in web/.env.local.
 * Without it {@link pushConfigured} is false and EVERYTHING here no-ops: no
 * prompt, no console noise, no broken UI — the settings row simply does not
 * offer web push. Nothing else on the site changes.
 */
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type MessagePayload,
  type Messaging,
} from 'firebase/messaging';
import { app, db } from './firebase';

/** Public Web Push certificate key. Empty ⇒ web push is switched off. */
export const PUSH_VAPID_KEY = (process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? '').trim();

/** Has the owner pasted a VAPID key in yet? */
export const pushConfigured = (): boolean => PUSH_VAPID_KEY.length > 0;

/**
 * Device-local memory of the row we last wrote — the browser equivalent of the
 * app's SharedPreferences bookkeeping, so a rotated token cleans up after
 * itself and an unchanged one costs no write at all.
 */
const LS_TOKEN = 'barakath.fcmToken';
const LS_UID = 'barakath.fcmTokenUid';

const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode — we just lose the rotation bookkeeping */
  }
};
const lsDel = (k: string) => {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
};

/**
 * Serialises every mutation, exactly as the app's `_queue` does: sign-in can
 * emit more than once and a token refresh can land mid-registration, and two
 * concurrent runs would race on the "previous token" bookkeeping and orphan a
 * row.
 */
let chain: Promise<unknown> = Promise.resolve();
function queue<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

// ── Support / permission ────────────────────────────────────────────────────

let supportedPromise: Promise<boolean> | null = null;
/** Browser can do web push at all (Safari < 16.4, http:, private modes cannot). */
export function pushSupported(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  supportedPromise ??= isSupported()
    .then((ok) => ok && 'serviceWorker' in navigator && 'Notification' in window)
    .catch(() => false);
  return supportedPromise;
}

export type PushPermission = NotificationPermission | 'unsupported';

export function pushPermission(): PushPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

// ── Messaging instance + service worker ─────────────────────────────────────

let messagingInstance: Messaging | null = null;
function messaging(): Messaging {
  messagingInstance ??= getMessaging(app);
  return messagingInstance;
}

/**
 * Register /firebase-messaging-sw.js, handing it the Firebase web config on the
 * query string — a static file under /public cannot read NEXT_PUBLIC_* values.
 * The URL is stable, so repeat calls resolve the same registration.
 */
let swPromise: Promise<ServiceWorkerRegistration> | null = null;
function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  swPromise ??= navigator.serviceWorker.register(
    `/firebase-messaging-sw.js?${new URLSearchParams({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
    }).toString()}`,
    { scope: '/' },
  );
  swPromise.catch(() => {
    swPromise = null; // let a later attempt retry
  });
  return swPromise;
}

// ── Token row (customerId == uid, doc id == token) ──────────────────────────

/**
 * Upsert `fcmTokens/{token}` — identical field set to the app's `_write`, which
 * is what the fan-out filters and prunes on.
 */
async function writeToken(uid: string, token: string, retryAfterReset = true): Promise<boolean> {
  const prevToken = lsGet(LS_TOKEN);
  const prevUid = lsGet(LS_UID);
  if (prevToken === token && prevUid === uid) return true; // already current

  try {
    await setDoc(doc(db, 'fcmTokens', token), {
      id: token,
      customerId: uid,
      platform: 'web',
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    // Someone else's row still owns this token (a shared browser whose previous
    // customer signed out without their delete landing); the rules only let the
    // owner overwrite it. Burn the registration token and take a fresh one —
    // same recovery the app performs.
    const code = (e as { code?: string })?.code ?? '';
    if (retryAfterReset && code.includes('permission-denied')) {
      const fresh = await resetToken();
      if (fresh && fresh !== token) return writeToken(uid, fresh, false);
    }
    return false;
  }

  lsSet(LS_TOKEN, token);
  lsSet(LS_UID, uid);

  // A rotated token leaves the old row pointing at a device that can no longer
  // be reached, so the collection would grow one row per token ever issued.
  if (prevToken && prevToken !== token && prevUid === uid) {
    await deleteDoc(doc(db, 'fcmTokens', prevToken)).catch(() => undefined);
  }
  return true;
}

/** Drop the current registration token and mint a new one. */
async function resetToken(): Promise<string | null> {
  try {
    await deleteToken(messaging());
    const registration = await registerServiceWorker();
    return await getToken(messaging(), { vapidKey: PUSH_VAPID_KEY, serviceWorkerRegistration: registration });
  } catch {
    return null;
  }
}

export type EnablePushResult = 'enabled' | 'denied' | 'unsupported' | 'unconfigured' | 'error';

/**
 * Ask for permission (if it has not been answered), take a token and register
 * it for `uid`.
 *
 * MUST be called from a user gesture — browsers reject `Notification
 * .requestPermission()` otherwise, and a prompt on first paint is exactly the
 * pattern that gets a site permanently blocked.
 */
export function enablePush(uid: string): Promise<EnablePushResult> {
  return queue(async () => {
    if (!pushConfigured()) return 'unconfigured';
    if (!(await pushSupported())) return 'unsupported';
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
    }
    if (permission !== 'granted') return 'denied';
    try {
      const registration = await registerServiceWorker();
      const token = await getToken(messaging(), {
        vapidKey: PUSH_VAPID_KEY,
        serviceWorkerRegistration: registration,
      });
      if (!token) return 'error';
      return (await writeToken(uid, token)) ? 'enabled' : 'error';
    } catch {
      return 'error';
    }
  });
}

/**
 * Re-register silently on an already-granted device. Never prompts, so it is
 * safe to run on every sign-in: FCM rotates tokens on its own schedule and a
 * stale row is a push that silently goes nowhere.
 */
export function syncPushToken(uid: string): Promise<void> {
  return queue(async () => {
    if (!pushConfigured()) return;
    if (!(await pushSupported())) return;
    if (Notification.permission !== 'granted') return;
    try {
      const registration = await registerServiceWorker();
      const token = await getToken(messaging(), {
        vapidKey: PUSH_VAPID_KEY,
        serviceWorkerRegistration: registration,
      });
      if (token) await writeToken(uid, token);
    } catch {
      /* best effort — nothing on the site depends on this succeeding */
    }
  });
}

/**
 * Drop this browser's row.
 *
 * MUST run while the customer is still signed in — the rules only let the owner
 * delete it — or the next customer on a shared browser keeps receiving the
 * previous one's broadcasts.
 */
export function unregisterPushToken(): Promise<void> {
  return queue(async () => {
    const token = lsGet(LS_TOKEN);
    // Forget it locally first: even if the delete never lands, this browser
    // must not believe it still owns a row for the old account.
    lsDel(LS_TOKEN);
    lsDel(LS_UID);
    if (!token) return;
    await deleteDoc(doc(db, 'fcmTokens', token)).catch(() => undefined);
  });
}

/**
 * Foreground messages. FCM does NOT display a notification while the tab has
 * focus — the page has to. Returns an unsubscribe, or null when push is
 * unavailable/unconfigured.
 */
export async function onForegroundMessage(
  handler: (payload: MessagePayload) => void,
): Promise<(() => void) | null> {
  if (!pushConfigured()) return null;
  if (!(await pushSupported())) return null;
  try {
    return onMessage(messaging(), handler);
  } catch {
    return null;
  }
}

export type { MessagePayload };
