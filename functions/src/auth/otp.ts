/**
 * MSG91 OTP authentication — sendOtp / resendOtp / verifyOtp.
 *
 * Replaces the mock OTP service both clients shipped with (a random code held
 * in sessionStorage plus a deterministic email/password Firebase credential).
 *
 * WHY THE WHOLE FLOW RUNS HERE, not in the clients:
 *   - MSG91's widget token never reaches a browser or an APK. It lives in
 *     Secret Manager and is only ever read by this function.
 *   - Web and Flutter get an identical contract, so there is one implementation
 *     of the abuse rules, the resend cooldown and the attempt cap instead of
 *     two that drift. No widget JS in Next.js, no extra Flutter dependency, and
 *     no MSG91 UI — the existing sign-in screens are untouched.
 *   - MSG91's own `verifyAccessToken` round-trip is unnecessary in this shape:
 *     it exists so a server can validate a JWT produced by a CLIENT-side widget
 *     flow. We call verifyOtp ourselves, so MSG91's success response IS the
 *     verification.
 *
 * The session doc is server-only (`otpSessions` is denied to every client in
 * firestore.rules) and never stores the code itself — MSG91 holds that.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { z } from 'zod';
import { getAuth } from 'firebase-admin/auth';
import { db, callableOpts, Timestamp } from '../_lib/admin.js';

const MSG91_AUTH_TOKEN = defineSecret('MSG91_AUTH_TOKEN');

/**
 * Widget id is not a secret — it is public in a client-side widget install.
 *
 * This is the widget MSG91 labels "web", and it is used for BOTH storefronts on
 * purpose. OTP here is entirely server-side: the app and the website both call
 * these callables, and the callable calls MSG91 — so every request reaches
 * MSG91 from a server, whichever client started it.
 *
 * The separately-issued "mobile" widget (36647068766e363335383838) is for
 * MSG91's embedded client SDK and rejects server traffic outright — verified
 * against the live API, which answers it with:
 *   {"message":"Web requests are not allowed for this widget.","type":"error"}
 * while this one answers {"type":"success"}. Swapping this id for that one
 * would take sign-in down on both clients, so do not "fix" it to match the
 * platform names.
 */
const WIDGET_ID = '3667776b4155303831303638';
const BASE = 'https://control.msg91.com/api/v5/widget';

/** SMS. MSG91 channel ids: 11 SMS, 12 email, 13 whatsapp, 14 voice. */
const CHANNEL_SMS = 11;

const SESSIONS = 'otpSessions';
const OTP_TTL_MS = 10 * 60 * 1000; // MSG91's own code lifetime
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_RESENDS = 3;
const MAX_ATTEMPTS = 5;
/** Per-phone send ceiling, counted over the window below. */
const MAX_SENDS_PER_WINDOW = 5;
const SEND_WINDOW_MS = 60 * 60 * 1000;

/** Legacy mock credential — the SAME phone must keep the SAME uid. */
const legacyEmail = (digits: string) => `otp_${digits}@mock.barakath.app`;

const PhoneSchema = z.object({
  // E.164 without '+': MSG91 wants `919876543210`.
  phone: z.string().regex(/^\d{10,15}$/, 'Enter a valid mobile number.'),
});

interface Msg91Response {
  type?: string;
  message?: string;
  hasError?: boolean;
}

/**
 * Call MSG91. Network faults and MSG91-level errors are normalised into
 * HttpsError so the clients can show one consistent set of messages.
 */
async function msg91(path: string, body: Record<string, unknown>): Promise<string> {
  let res: Response;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    res = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, widgetId: WIDGET_ID, tokenAuth: MSG91_AUTH_TOKEN.value() }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
  } catch {
    // Timeout or DNS/socket failure — retryable, and distinct from a bad code.
    throw new HttpsError('unavailable', 'Could not reach the SMS service. Please try again.');
  }

  let json: Msg91Response;
  try {
    json = (await res.json()) as Msg91Response;
  } catch {
    throw new HttpsError('unavailable', 'The SMS service returned an unreadable response.');
  }

  if (json.type === 'success' && typeof json.message === 'string') return json.message;

  const detail = String(json.message ?? 'Unknown error');
  // MSG91 reports a wrong/expired code through the same error shape as a
  // config problem, so classify on the text rather than surfacing it verbatim.
  const lowered = detail.toLowerCase();
  if (lowered.includes('otp not match') || lowered.includes('invalid otp')) {
    throw new HttpsError('invalid-argument', 'That code is incorrect.');
  }
  if (lowered.includes('expired')) {
    throw new HttpsError('deadline-exceeded', 'That code has expired. Request a new one.');
  }
  console.error(`MSG91 ${path} failed: ${detail}`);
  throw new HttpsError('unavailable', 'Could not send the code right now. Please try again.');
}

/**
 * Claim one send against this phone's hourly quota.
 *
 * Transactional on a per-phone counter doc, NOT a count() over sessions. The
 * query form read-then-wrote, so N concurrent sendOtp calls all saw the same
 * pre-send count and every one of them passed — and this endpoint is
 * unauthenticated, so that was free SMS bombing at the store's expense.
 *
 * Throws resource-exhausted when the quota is spent; the window slides by
 * resetting the counter once the current one has elapsed.
 */
async function claimSendQuota(phone: string): Promise<void> {
  const ref = db.doc(`otpQuotas/${phone}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const startedAt = Number(snap.get('windowStartedAtMs') ?? 0);
    const fresh = now - startedAt >= SEND_WINDOW_MS;
    const used = fresh ? 0 : Number(snap.get('sends') ?? 0);
    if (used >= MAX_SENDS_PER_WINDOW) {
      throw new HttpsError(
        'resource-exhausted',
        'Too many codes requested for this number. Please try again in an hour.',
      );
    }
    tx.set(
      ref,
      {
        phone,
        sends: used + 1,
        windowStartedAtMs: fresh ? now : startedAt,
        updatedAt: Timestamp.fromMillis(now),
      },
      { merge: true },
    );
  });
}

export const sendOtp = onCall({ ...callableOpts, secrets: [MSG91_AUTH_TOKEN] }, async (req) => {
  const parsed = PhoneSchema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Enter a valid mobile number.');
  const { phone } = parsed.data;

  // Claimed BEFORE the SMS goes out: a send that MSG91 then refuses still costs
  // the quota, which is the safe direction for an unauthenticated endpoint.
  await claimSendQuota(phone);

  const reqId = await msg91('sendOtp', { identifier: phone });

  const now = Date.now();
  const ref = db.collection(SESSIONS).doc();
  await ref.set({
    id: ref.id,
    phone,
    reqId,
    attempts: 0,
    resends: 0,
    verified: false,
    createdAt: Timestamp.fromMillis(now),
    lastSentAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(now + OTP_TTL_MS),
  });

  return {
    sessionId: ref.id,
    expiresInSec: OTP_TTL_MS / 1000,
    resendAfterSec: RESEND_COOLDOWN_MS / 1000,
    maxResends: MAX_RESENDS,
  };
});

/** Load a live session, or explain precisely why it cannot be used. */
async function loadSession(sessionId: string) {
  const ref = db.collection(SESSIONS).doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'This sign-in has expired. Request a new code.');
  }
  const s = snap.data() as Record<string, unknown>;
  if (s.verified === true) {
    throw new HttpsError('failed-precondition', 'This code has already been used.');
  }
  if ((s.expiresAt as Timestamp).toMillis() < Date.now()) {
    throw new HttpsError('deadline-exceeded', 'That code has expired. Request a new one.');
  }
  return { ref, s };
}

export const resendOtp = onCall({ ...callableOpts, secrets: [MSG91_AUTH_TOKEN] }, async (req) => {
  const parsed = z.object({ sessionId: z.string().min(1) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Missing session.');
  const { ref, s } = await loadSession(parsed.data.sessionId);

  // Claim the resend transactionally BEFORE the SMS, the way verifyOtp claims
  // an attempt. Read-check-then-write let two concurrent taps both pass the
  // cooldown and the 3-resend budget, and each one costs a real SMS.
  const resends = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    const used = Number(fresh.get('resends') ?? 0);
    if (fresh.get('verified') === true) {
      throw new HttpsError('failed-precondition', 'This code has already been used.');
    }
    if (used >= MAX_RESENDS) {
      throw new HttpsError('resource-exhausted', 'No resends left. Start again with a new code.');
    }
    const waitedMs = Date.now() - (fresh.get('lastSentAt') as Timestamp).toMillis();
    if (waitedMs < RESEND_COOLDOWN_MS) {
      throw new HttpsError(
        'failed-precondition',
        `Please wait ${Math.ceil((RESEND_COOLDOWN_MS - waitedMs) / 1000)}s before requesting another code.`,
      );
    }
    tx.update(ref, { resends: used + 1, lastSentAt: Timestamp.now() });
    return used + 1;
  });

  // A resend is a REAL SMS, so it has to come out of the same per-phone hourly
  // budget sendOtp claims from. It did not: the ceiling was 5 sends/hour/phone,
  // but each of those 5 sessions carried 3 free resends, so an unauthenticated
  // caller could push 20 messages/hour at one handset (and at the store's SMS
  // bill) — 4x the documented cap — simply by calling resendOtp after each
  // sendOtp. Claimed AFTER the session transaction on purpose: the cooldown and
  // the 3-resend budget are checked first, so a client hammering the button
  // cannot burn the phone's hourly quota on requests that were never going to
  // send anything.
  await claimSendQuota(String(s.phone));

  await msg91('retryOtp', { reqId: s.reqId, retryChannel: CHANNEL_SMS });

  return { resendsLeft: MAX_RESENDS - resends, resendAfterSec: RESEND_COOLDOWN_MS / 1000 };
});

/**
 * Resolve the Firebase uid for a verified phone.
 *
 * The VERIFIED PHONE is the identity. The legacy email is only a migration
 * bridge, and it is deliberately consulted second.
 *
 * Why the order matters so much: every pre-MSG91 customer signed up through the
 * mock service, which created an Email/Password user keyed on the DERIVABLE
 * address `otp_<digits>@mock.barakath.app` — their orders, wallet, wishlist and
 * affiliate records all hang off that uid, so it has to be reused or they are
 * orphaned. But that address is guessable for any phone number, and the
 * Email/Password provider is open for sign-up. Trusting it first meant an
 * attacker could pre-create `otp_<victim>@mock.barakath.app`, and the victim's
 * genuine OTP login would then land on an account whose password the attacker
 * still held. So the bridge only applies to accounts that predate the cutover;
 * anything created at that address afterwards is not evidence of anything.
 */
const LEGACY_MOCK_CUTOVER_MS = Date.parse('2026-07-23T00:00:00Z');

async function resolveUid(phone: string): Promise<string> {
  const auth = getAuth();
  const e164 = `+${phone}`;
  const email = legacyEmail(phone);

  // 1. The phone itself — the only identifier MSG91 actually proved.
  try {
    return (await auth.getUserByPhoneNumber(e164)).uid;
  } catch {
    /* not attached yet — try the migration bridge */
  }

  // 2. A genuine pre-cutover mock account for this number.
  try {
    const user = await auth.getUserByEmail(email);
    const createdMs = Date.parse(user.metadata.creationTime);
    if (Number.isFinite(createdMs) && createdMs < LEGACY_MOCK_CUTOVER_MS) {
      // Attach the verified phone so step 1 finds it next time and the bridge
      // is never needed for this account again.
      await auth.updateUser(user.uid, { phoneNumber: e164 }).catch(() => undefined);
      return user.uid;
    }
    // Post-cutover squatter on the derivable address. Do NOT hand the session
    // to it; fall through and create a phone-owned account instead.
    console.warn(`otp: ignoring post-cutover account at ${email}`);
  } catch {
    /* no account at that address at all */
  }

  // Phone-only. The legacy address is deliberately NOT claimed for new accounts:
  // it buys nothing now that step 1 resolves by phone, and attaching it would
  // fail outright whenever a squatter already holds it — turning someone else's
  // land-grab into a sign-in outage for a legitimate customer.
  const created = await auth.createUser({ phoneNumber: e164 });
  return created.uid;
}

export const verifyOtp = onCall({ ...callableOpts, secrets: [MSG91_AUTH_TOKEN] }, async (req) => {
  const parsed = z
    .object({ sessionId: z.string().min(1), code: z.string().regex(/^\d{4,8}$/, 'Enter the code.') })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Enter the code from the SMS.');
  const { sessionId, code } = parsed.data;

  const { ref, s } = await loadSession(sessionId);

  // Claim an attempt BEFORE calling MSG91, so a client that fires the same
  // request twice (double tap, retried network call) cannot buy extra guesses.
  const attempts = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    const n = Number(fresh.get('attempts') ?? 0);
    if (fresh.get('verified') === true) {
      throw new HttpsError('failed-precondition', 'This code has already been used.');
    }
    if (n >= MAX_ATTEMPTS) {
      throw new HttpsError('resource-exhausted', 'Too many incorrect attempts. Request a new code.');
    }
    tx.update(ref, { attempts: n + 1 });
    return n + 1;
  });

  await msg91('verifyOtp', { reqId: s.reqId, otp: code });

  // Single-use: burn the session in the same breath as the success, so a
  // replayed verify cannot mint a second token.
  await ref.update({ verified: true, verifiedAt: Timestamp.now(), attempts });

  const phone = String(s.phone);
  const uid = await resolveUid(phone);

  // A blocked customer must not be able to obtain a fresh session at all.
  const cust = await db.doc(`customers/${uid}`).get();
  if (cust.exists && cust.get('isBlocked') === true) {
    throw new HttpsError('permission-denied', 'Your account has been blocked. Please contact support.');
  }

  const token = await getAuth().createCustomToken(uid, { phone });
  return { token, uid, isNewUser: !cust.exists };
});
