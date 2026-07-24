/**
 * adminSendBroadcastNotification — critical fan-out: records the broadcast,
 * writes a per-user inbox notification for every targeted customer (batched),
 * and best-effort FCM push. broadcasts + per-user notifications are CF-only-write.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { FieldPath, type Query, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { db, FieldValue, callableOpts } from '../_lib/admin.js';
import { requireCustomer, requireModule, writeAudit } from '../_lib/guards.js';
import { pushDataPayload, sendPush, tokensForCustomers } from './push.js';

/** Accepts only an absolute http(s) URL — the app refuses to launch anything else. */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const DeepLinkSchema = z
  .object({
    type: z.string(),
    target: z.string().nullable().optional(),
    label: z.string().optional(),
  })
  // A 'url' deep link with no scheme (or a custom one like barkath://) makes the
  // notification card silently inert in the app, which only refuses to launch
  // http/https. Reject it here rather than fan out a dead destination.
  .refine((d) => d.type !== 'url' || isHttpUrl((d.target ?? '').trim()), {
    message: 'Custom link must be a full http:// or https:// URL.',
  });

const Schema = z.object({
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(200),
  audience: z.enum(['all', 'affiliates', 'new_30d']),
  deepLink: DeepLinkSchema.nullable().optional(),
  /**
   * Caller-supplied idempotency key (stable across retries of the SAME composed
   * message). The fan-out is not instantaneous, so a failed/timed-out call used
   * to be re-sent by hand and re-delivered to everyone already written.
   */
  requestId: z.string().min(1).max(120).optional(),
});

/**
 * Re-check a product/category deep-link target server-side.
 *
 * The admin picker lists every product regardless of status, so a draft or
 * hidden target can be chosen; the app deep-links straight to the doc with no
 * status check and would render an unpublished product in full.
 */
async function assertDeepLinkTarget(deepLink: { type: string; target?: string | null } | null | undefined) {
  if (!deepLink) return;
  if (deepLink.type !== 'product' && deepLink.type !== 'category') return;
  const id = (deepLink.target ?? '').trim();
  if (!id) throw new HttpsError('invalid-argument', 'Choose a deep-link target.');

  const snap = await db.doc(`${deepLink.type === 'product' ? 'products' : 'categories'}/${id}`).get();
  if (!snap.exists || snap.get('deletedAt')) {
    throw new HttpsError('invalid-argument', 'That deep-link target no longer exists.');
  }
  if (snap.get('visibility') === 'hidden') {
    throw new HttpsError('invalid-argument', 'That deep-link target is hidden from customers.');
  }
  if (deepLink.type === 'product' && snap.get('status') !== 'published') {
    throw new HttpsError('invalid-argument', 'That product is not published yet.');
  }
}

/**
 * Customers of an audience segment, ordered so the set can be paged with a
 * cursor — a single `.get()` of the whole `customers` collection could not fit
 * in the callable's memory or time budget once the base grew.
 */
function audienceQuery(audience: string): Query {
  const col = db.collection('customers');
  if (audience === 'affiliates') {
    return col.where('affiliate.enabled', '==', true).orderBy(FieldPath.documentId());
  }
  if (audience === 'new_30d') {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    // A range filter must lead the sort order, so page on createdAt itself.
    return col.where('createdAt', '>=', cutoff).orderBy('createdAt');
  }
  return col.orderBy(FieldPath.documentId());
}

/**
 * Whether a customer may receive an admin broadcast.
 *
 * Blocked accounts cannot sign in (their Auth user is disabled), so writing to
 * their inbox only deflates the Opened/Sent ratio. `preferences` are the
 * customer's own opt-outs from web/app settings: the master push switch and the
 * "Promotions & offers" channel, which is what an admin broadcast is.
 */
function isBroadcastEligible(doc: QueryDocumentSnapshot): boolean {
  if (doc.get('isBlocked') === true) return false;
  const prefs = doc.get('preferences') as Record<string, unknown> | undefined;
  if (prefs?.notificationsEnabled === false) return false;
  if (prefs?.notifyPromotions === false) return false;
  return true;
}

// Token lookup, the shared `data` payload, multicast delivery and dead-token
// pruning all live in ./push.ts now — the per-event notifications
// (notifications/notify.ts) reuse exactly the same code, so the two can never
// send differently-shaped pushes.

/** Customers scanned (and inbox rows written) per page/commit. */
const PAGE_SIZE = 450;

export const adminSendBroadcastNotification = onCall(
  // The fan-out is O(audience): the v2 default of 60s cannot cover a large
  // customer base, and dying mid-way used to leave a permanently wrong record.
  { ...callableOpts, timeoutSeconds: 540 },
  async (req) => {
    const { uid: actor } = await requireModule(req, 'notifications', 'create');
    const parsed = Schema.safeParse(req.data);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message;
      throw new HttpsError('invalid-argument', issue || 'Invalid notification payload.');
    }
    const { title, body, audience, deepLink, requestId } = parsed.data;
    await assertDeepLinkTarget(deepLink);

    const now = FieldValue.serverTimestamp();

    // Idempotency: a resend of the same composed message reuses its broadcast
    // doc instead of minting a second "Sent" row and a second fan-out.
    let bref = db.collection('broadcasts').doc();
    let resuming = false;
    if (requestId) {
      const prior = await db.collection('broadcasts').where('requestId', '==', requestId).limit(1).get();
      const existing = prior.docs[0];
      if (existing) {
        if (existing.get('status') === 'sent') {
          return { ok: true, reach: (existing.get('reach') as number) ?? 0, id: existing.id };
        }
        bref = existing.ref; // resume a 'sending'/'failed' attempt in place
        resuming = true;
      }
    }

    // Record the broadcast as in-flight. `reach` is unknown until the audience
    // has been walked, and claiming 'sent' up front made a failed run read as a
    // complete one forever.
    await bref.set(
      {
        id: bref.id, title, body, audience, deepLink: deepLink ?? null,
        requestId: requestId ?? null,
        reach: 0, status: 'sending',
        sentByUid: actor, sentAt: now,
        // A resumed attempt keeps the row it already has in the admin's list —
        // and its `opened` count, which is guarded by per-customer marker docs
        // that would not be claimed a second time.
        ...(resuming ? {} : { opened: 0, createdAt: now }),
      },
      { merge: true },
    );

    // Per-user inbox writes, paged + batched (≤450/commit). The notification id
    // is the broadcast id, so re-running a partial fan-out addresses the rows it
    // already wrote instead of duplicating them.
    //
    // `recipientIds` is the reach (everyone who holds this notification);
    // `freshIds` is only the rows THIS attempt created, and is what the push
    // below targets — a resumed run must not re-buzz a phone that was already
    // notified by the attempt that died.
    const recipientIds: string[] = [];
    const freshIds: string[] = [];
    try {
      const base = audienceQuery(audience);
      let cursor: QueryDocumentSnapshot | undefined;
      for (;;) {
        const page = await (cursor ? base.startAfter(cursor) : base).limit(PAGE_SIZE).get();
        if (page.empty) break;
        cursor = page.docs[page.docs.length - 1];

        const eligible = page.docs.filter(isBroadcastEligible);
        if (eligible.length > 0) {
          // A resume must SKIP rows the earlier attempt already delivered. The
          // write below is a plain `set()` (no merge) because a new row has to
          // carry `read: false` for the unread query to see it — but replaying
          // that over a delivered row resets `read`/`archived`, so a customer
          // who had already read (or dismissed) the message watches it turn
          // unread again. One batched read per page, only on a resume.
          let toWrite = eligible;
          if (resuming) {
            const existing = await db.getAll(
              ...eligible.map((c) => db.doc(`customers/${c.id}/notifications/${bref.id}`)),
            );
            const delivered = new Set(
              existing.filter((s) => s.exists).map((s) => s.ref.parent.parent!.id),
            );
            toWrite = eligible.filter((c) => !delivered.has(c.id));
          }
          if (toWrite.length > 0) {
            const batch = db.batch();
            for (const c of toWrite) {
              const nref = db.doc(`customers/${c.id}/notifications/${bref.id}`);
              batch.set(nref, {
                id: nref.id, title, body, type: 'broadcast', deepLink: deepLink ?? null,
                broadcastId: bref.id, read: false, archived: false, createdAt: now,
              });
            }
            await batch.commit();
          }
          eligible.forEach((c) => recipientIds.push(c.id));
          toWrite.forEach((c) => freshIds.push(c.id));
        }
        if (page.size < PAGE_SIZE) break;
      }
    } catch (e) {
      // The record must never outlive the run claiming success.
      await bref.set({ status: 'failed', reach: recipientIds.length }, { merge: true }).catch(() => undefined);
      throw e instanceof HttpsError ? e : new HttpsError('internal', 'Could not deliver the notification.');
    }

    // Inbox writes are the source of truth and are now complete.
    await bref.set({ status: 'sent', reach: recipientIds.length }, { merge: true });

    // Best-effort FCM push to registered tokens. Firestore caps an `in` filter
    // at 30 values and multicast at 500 tokens, so the audience is chunked
    // through both — it used to be truncated to the first 10 customers while
    // still reporting full reach.
    //
    // The push now carries a `data` block as well as the `notification` one.
    // Without it the deep link the admin configured never left the server: the
    // device received a title and a body and nothing else, so a tapped push
    // could only ever open the app's launch screen — while the very same
    // destination sat on the inbox row the customer had to go and find by hand.
    // The inbox document id IS the broadcast id, so `notificationId` and
    // `broadcastId` are the same value and the client can both route the tap and
    // report the open (markBroadcastOpened).
    try {
      const tokens = await tokensForCustomers(freshIds);
      await sendPush({
        tokens,
        title,
        body,
        data: pushDataPayload({
          notificationId: bref.id,
          category: 'promo',
          deepLink: deepLink ?? null,
          broadcastId: bref.id,
        }),
      });
    } catch {
      /* push is best-effort; inbox writes are the source of truth */
    }

    await writeAudit({ actorUid: actor, action: 'notification.broadcast', entity: 'broadcasts', entityId: bref.id, meta: { audience, reach: recipientIds.length } });
    return { ok: true, reach: recipientIds.length, id: bref.id };
  },
);

/** Max broadcast ids a single markBroadcastOpened call may report. */
const OPEN_BATCH_MAX = 50;

const OpenedSchema = z.object({
  broadcastIds: z.array(z.string().min(1)).min(1).max(OPEN_BATCH_MAX),
});

/**
 * markBroadcastOpened — counts a customer's first open of a broadcast.
 *
 * `broadcasts.opened` was written once as 0 and never touched again, so the
 * admin's Opened column read 0% forever. It is a cross-user counter on a
 * CF-only-write collection, so the client cannot increment it directly: the app
 * calls this when it marks a broadcast-sourced notification read.
 *
 * Counted AT MOST ONCE per customer per broadcast — the increment is guarded by
 * a `broadcasts/{id}/opens/{uid}` marker doc claimed in the same transaction, so
 * re-reading (or re-opening) an inbox never inflates the number.
 */
export const markBroadcastOpened = onCall(callableOpts, async (req) => {
  const { uid } = requireCustomer(req);
  const parsed = OpenedSchema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid broadcast open payload.');
  const ids = [...new Set(parsed.data.broadcastIds)];

  let counted = 0;
  for (const id of ids) {
    const bref = db.collection('broadcasts').doc(id);
    const openRef = bref.collection('opens').doc(uid);
    // The caller must actually HOLD this broadcast. `opened` is a cross-user
    // metric on a CF-only-write collection, and the id is the only argument —
    // without this any signed-in customer could walk the broadcast ids they can
    // see in their own inbox (or guess them) and drive the admin's Opened column
    // past 100% of a reach they were never part of. The per-user inbox row is
    // written by the fan-out with the broadcast's own id, so receipt is a single
    // document lookup.
    const inboxRef = db.doc(`customers/${uid}/notifications/${id}`);
    const didCount = await db.runTransaction(async (tx) => {
      // All reads before any write.
      const [bSnap, oSnap, inbox] = await Promise.all([
        tx.get(bref),
        tx.get(openRef),
        tx.get(inboxRef),
      ]);
      // Deleted broadcast, already counted, or never delivered to this customer.
      if (!bSnap.exists || oSnap.exists || !inbox.exists) return false;
      tx.set(openRef, {
        id: uid, broadcastId: id, customerId: uid, openedAt: FieldValue.serverTimestamp(),
      });
      tx.update(bref, { opened: FieldValue.increment(1) });
      return true;
    });
    if (didCount) counted++;
  }

  return { ok: true, counted };
});
