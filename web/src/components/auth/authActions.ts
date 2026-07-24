'use client';
import { toast } from 'sonner';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { OtpError, otpService, type OtpSession } from '@/lib/otp/otpService';
import { ensureCustomerDoc, completeCustomerProfile } from '@/lib/customerDoc';
import { userExists, registerUser } from '@/lib/userDirectory';

/**
 * Business-logic layer for the login flow. The UI (signin / create-profile)
 * calls ONLY these functions; the actual OTP transport lives behind
 * `otpService` (swap mock ⇄ MSG91 with one env line — see lib/otp/otpService.ts).
 */

/** India mobile: exactly 10 digits, first digit 6-9. */
export const PHONE_RE = /^[6-9]\d{9}$/;
/** 6-digit numeric OTP. */
export const OTP_RE = /^\d{6}$/;
/** Loose email check — only used when a value is present (email is optional). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Strip everything but digits and clamp to `max` characters. */
export function digitsOnly(value: string, max: number): string {
  return value.replace(/\D/g, '').slice(0, max);
}

/** `98765 43210` presentation for a 10-digit local number. */
export function formatPhone(local: string): string {
  const d = digitsOnly(local, 10);
  return d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
}

/** E.164 for India: `+91XXXXXXXXXX`. */
export function toE164(local: string): string {
  return `+91${digitsOnly(local, 10)}`;
}

export type AuthMode = 'signin' | 'signup';

export interface SendOtpResult {
  ok: boolean;
  /** Seconds the UI must count down before offering "Resend code" (server-owned). */
  resendAfterSec?: number;
  /** Total resends the server will grant for this session. */
  maxResends?: number;
  /** Set when the request was blocked by the users-collection existence gate. */
  reason?: 'not_registered' | 'already_registered';
}
export interface ResendOtpResult {
  ok: boolean;
  /** Fresh cooldown to run the UI countdown from. */
  resendAfterSec?: number;
  /** 0 ⇒ budget spent; the UI must stop offering "Resend code". */
  resendsLeft?: number;
  /** true when the session is unusable — the UI must return to the phone step. */
  restart?: boolean;
}
export interface VerifyOtpResult {
  /** true only when a Firebase session was actually established. */
  signedIn: boolean;
  /** true when the customer still needs to complete their profile. */
  needsProfile: boolean;
  /** true when the session is unusable — the UI must return to the phone step. */
  restart?: boolean;
}

/**
 * The OTP session currently in flight.
 *
 * Module state rather than a parameter because there is only ever one sign-in
 * happening in a tab, and it keeps `requestOtp` / `verifyOtp` at the exact
 * signatures the signin and register screens already call.
 */
let session: OtpSession | null = null;

/** Show the backend's own sentence — it is written for customers. */
function toastOtpError(e: unknown, fallback: string): void {
  toast.error(e instanceof OtpError ? e.message : fallback);
}

/**
 * Kinds that mean "this session is dead" — no code the user types can work any
 * more, so the UI has to go back to the phone step and request a fresh one.
 */
function isFatal(e: unknown): boolean {
  if (!(e instanceof OtpError)) return false;
  return (
    e.kind === 'expired' ||
    e.kind === 'session-expired' ||
    e.kind === 'exhausted' ||
    e.kind === 'precondition' || // on verify this is "code already used"
    e.kind === 'blocked' // the server burns the session before this check
  );
}

/**
 * Request an OTP for a 10-digit local number, gated by the users collection:
 *   - mode 'signin' → the number MUST already exist (else `not_registered`).
 *   - mode 'signup' → the number must NOT exist yet (else `already_registered`).
 * Returns ok=false + a `reason` when the gate blocks it.
 */
export async function requestOtp(localPhone: string, mode: AuthMode): Promise<SendOtpResult> {
  try {
    const e164 = toE164(localPhone);
    const exists = await userExists(e164);
    if (mode === 'signin' && !exists) return { ok: false, reason: 'not_registered' };
    if (mode === 'signup' && exists) return { ok: false, reason: 'already_registered' };

    // A new send supersedes anything in flight for the previous number.
    session = null;
    const { session: s } = await otpService.sendOtp(e164);
    session = s;
    return { ok: true, resendAfterSec: s.resendAfterSec, maxResends: s.maxResends };
  } catch (e) {
    toastOtpError(e, "Couldn't send the code. Please try again.");
    return { ok: false };
  }
}

/**
 * Re-send the code for the session `requestOtp` opened.
 *
 * Deliberately NOT a second `requestOtp`: a resend reuses MSG91's reqId and is
 * charged against this session's 3-resend budget, whereas a fresh send eats one
 * of the 5 codes the number is allowed per hour.
 */
export async function resendOtp(): Promise<ResendOtpResult> {
  if (!session) {
    // Nothing to resend (reload, or the phone was edited) — restart cleanly.
    toast.error('This sign-in has expired. Request a new code.');
    return { ok: false, restart: true };
  }
  try {
    const { resendsLeft, resendAfterSec } = await otpService.resendOtp(session);
    toast.success('Code sent — check your messages.');
    return { ok: true, resendsLeft, resendAfterSec };
  } catch (e) {
    toastOtpError(e, "Couldn't resend the code. Please try again.");
    const kind = e instanceof OtpError ? e.kind : 'unknown';
    // On a RESEND, 'precondition' is the cooldown and 'exhausted' is the spent
    // resend budget — neither kills the session, and the code already sent is
    // still valid, so the user stays on the code step. Anything else fatal
    // (expired, session gone) does mean starting over.
    const keep = kind === 'precondition' || kind === 'exhausted' || !isFatal(e);
    if (!keep) session = null;
    return { ok: false, resendsLeft: kind === 'exhausted' ? 0 : undefined, restart: !keep };
  }
}

/**
 * Verify an OTP → establish a Firebase session → ensure the customer doc exists.
 * On sign-up, also records the phone in the users directory.
 * Returns signedIn=false + toast for an incorrect code.
 */
export async function verifyOtp(localPhone: string, code: string, mode: AuthMode): Promise<VerifyOtpResult> {
  if (!session) {
    toast.error('This sign-in has expired. Request a new code.');
    return { signedIn: false, needsProfile: false, restart: true };
  }
  const active = session;
  const e164 = toE164(localPhone);
  try {
    await otpService.verifyOtp(active, code);
    session = null; // single-use, mirroring the server burning the session
  } catch (e) {
    toastOtpError(e, "Couldn't verify the code. Please try again.");
    if (isFatal(e)) session = null;
    return { signedIn: false, needsProfile: false, restart: isFatal(e) };
  }

  // Past this point the code was right and the Firebase session exists; a
  // failure here is Firestore, not OTP — and the session is already burned, so
  // the only way forward is a brand-new code.
  let profileComplete: boolean;
  try {
    ({ profileComplete } = await ensureCustomerDoc(e164));
  } catch {
    toast.error("Signed you in, but we couldn't load your profile. Please try again.");
    return { signedIn: false, needsProfile: false, restart: true };
  }

  // The users directory is only the pre-auth "is this number registered?" index
  // — it is NOT the account. Failing to write it used to be reported as a failed
  // verification, which stranded a customer on /register: they were signed in,
  // their customer document existed, the OTP session was burned, and the screen
  // never navigated away. Record the failure and carry on.
  if (mode === 'signup') {
    try {
      await registerUser(e164);
    } catch {
      /* index-only write — the account is already usable without it */
    }
  }
  return { signedIn: true, needsProfile: !profileComplete };
}

/** Persist name/email on the customer doc and mark the profile complete. */
export async function completeProfile(name: string, email: string | null): Promise<boolean> {
  try {
    await completeCustomerProfile(name, email);
    return true;
  } catch {
    toast.error('Could not save your profile. Please try again.');
    return false;
  }
}

/** Surface the Cloud Function's own error message when present. */
function errMessage(e: unknown, fallback: string): string {
  const m = (e as { message?: string })?.message;
  return m && !m.startsWith('INTERNAL') ? m : fallback;
}

/**
 * What became of a referral code. Sign-up is now the ONLY chance a customer has
 * to be attributed (checkout no longer takes a code), so the caller has to be
 * able to tell "wrong code, ask again" from "nothing left to do" — a single
 * fire-and-forget toast silently lost the attribution.
 */
export type ReferralLinkResult =
  /** The field was left empty. It is optional — nothing was attempted. */
  | { status: 'skipped' }
  | { status: 'linked'; affiliateName: string | null }
  /** Already attributed (this account has a referrer) — re-asking is pointless. */
  | { status: 'already-linked'; message: string }
  /** The code itself is wrong: unknown, disabled affiliate, or the caller's own. */
  | { status: 'invalid'; message: string }
  /** Transport/unknown failure — the SAME code is worth retrying as-is. */
  | { status: 'error'; message: string };

/**
 * Attach the caller to an affiliate via their referral code.
 *
 * MUST be called only once the customer doc exists — the `linkReferral`
 * callable writes `customers/{uid}.referredBy` and bumps the affiliate's
 * referredCount.
 *
 * Never throws: by the time we get here the account already exists, so a
 * mistyped code must not fail registration. It reports what happened instead,
 * and the caller decides whether to keep the customer on the form to fix it.
 *
 * The success path and 'already-linked' toast here because both mean "carry
 * on"; the two correctable outcomes stay silent so the caller can pin them
 * against the field rather than firing a toast that scrolls away.
 */
export async function linkReferral(rawCode: string): Promise<ReferralLinkResult> {
  // Codes are stored upper-case (see referralCode() in functions/src/affiliate).
  const code = rawCode.trim().toUpperCase();
  if (!code) return { status: 'skipped' };
  try {
    const fn = httpsCallable<{ code: string }, { ok: boolean; affiliateName?: string }>(
      functions,
      'linkReferral',
    );
    const { data } = await fn({ code });
    const affiliateName = data.affiliateName || null;
    toast.success(
      affiliateName ? `Referral applied — thanks to ${affiliateName}!` : 'Referral code applied.',
    );
    return { status: 'linked', affiliateName };
  } catch (e) {
    const errCode = (e as { code?: string })?.code ?? '';
    const message = errMessage(e, "We couldn't apply that referral code.");
    // The server raises `failed-precondition` for four different situations and
    // only its own sentence tells them apart (see functions/src/affiliate/
    // referral.ts) — so match the message, and fall back to "retryable" for
    // anything unrecognised rather than blaming a code that may be fine.
    if (errCode === 'functions/not-found') return { status: 'invalid', message };
    if (errCode === 'functions/invalid-argument') return { status: 'invalid', message };
    if (errCode === 'functions/failed-precondition') {
      if (message.startsWith('Your account is already linked')) {
        toast.message(message);
        return { status: 'already-linked', message };
      }
      // 'no longer active' (affiliate disabled) and 'your own referral code' are
      // both fixed by entering a DIFFERENT code; 'Complete your profile first.'
      // is not, but it resolves itself on retry once the doc lands.
      if (message.startsWith('Complete your profile')) return { status: 'error', message };
      return { status: 'invalid', message };
    }
    return { status: 'error', message };
  }
}
