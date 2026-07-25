'use client';
/**
 * Real MSG91 OTP — a thin client over the deployed asia-south1 callables in
 * functions/src/auth/otp.ts (sendOtp / resendOtp / verifyOtp).
 *
 * Nothing MSG91-specific lives here on purpose: the widget id and the auth
 * token stay in the function (Secret Manager), the browser only ever sees a
 * sessionId. `verifyOtp` returns a Firebase CUSTOM token, so the session is
 * completed with signInWithCustomToken — the same uid a legacy mock-created
 * account already had (the CF reuses it), so orders/wallet/wishlist survive.
 *
 * Every method throws OtpError; the callers (components/auth/authActions.ts)
 * turn that into one toast.
 */
import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { auth, functions } from '@/lib/firebase';
import { OtpError, type OtpErrorKind, type OtpService } from './otpService';

/** Wire shapes — mirror the callables' returns exactly. */
interface SendResponse {
  sessionId: string;
  expiresInSec: number;
  resendAfterSec: number;
  maxResends: number;
}
interface ResendResponse {
  resendsLeft: number;
  resendAfterSec: number;
}
interface VerifyResponse {
  token: string;
  uid: string;
  isNewUser: boolean;
}

/** Callable errors surface as FirebaseError with `code` = `functions/<status>`. */
const KIND_BY_CODE: Record<string, OtpErrorKind> = {
  'functions/deadline-exceeded': 'expired',
  'functions/resource-exhausted': 'exhausted',
  'functions/failed-precondition': 'precondition',
  'functions/not-found': 'session-expired',
  'functions/unavailable': 'network',
  'functions/permission-denied': 'blocked',
  // The SDK reports an unreachable backend (offline, CORS, cold-start timeout)
  // as `internal` with no useful message — retryable, same as `unavailable`.
  'functions/internal': 'network',
};

/** Used only when the server did not give us a sentence of its own. */
const FALLBACK: Record<OtpErrorKind, string> = {
  'invalid-phone': 'Enter a valid mobile number.',
  'invalid-code': 'That code is incorrect.',
  expired: 'That code has expired. Request a new one.',
  exhausted: 'Too many attempts. Please try again later.',
  precondition: 'Please wait a moment before requesting another code.',
  'session-expired': 'This sign-in has expired. Request a new code.',
  network: 'Could not reach the SMS service. Please try again.',
  blocked: 'Your account has been blocked. Please contact support.',
  unknown: 'Something went wrong. Please try again.',
};

/**
 * Normalise anything thrown by a callable into an OtpError.
 *
 * `invalidArgument` disambiguates the one status the server reuses: on sendOtp
 * it means the phone was rejected, on verifyOtp it means the code was wrong.
 */
function toOtpError(e: unknown, invalidArgument: OtpErrorKind): OtpError {
  if (e instanceof OtpError) return e;
  const code = String((e as { code?: unknown })?.code ?? '');
  const kind = code === 'functions/invalid-argument' ? invalidArgument : (KIND_BY_CODE[code] ?? 'unknown');
  // Prefer the server's message — it is written for customers. `internal` is
  // the SDK's own placeholder for "we never reached the function", not copy.
  const raw = (e as { message?: string })?.message?.trim();
  const usable = raw && !/^internal$/i.test(raw) ? raw : FALLBACK[kind];
  return new OtpError(kind, usable);
}

/** MSG91 wants E.164 WITHOUT the '+': `+91 98765 43210` → `919876543210`. */
function msg91Phone(e164: string): string {
  return e164.replace(/\D/g, '');
}

export const msg91OtpService: OtpService = {
  async sendOtp(e164) {
    try {
      const fn = httpsCallable<{ phone: string }, SendResponse>(functions, 'sendOtp');
      const { data } = await fn({ phone: msg91Phone(e164) });
      return { session: { ...data } };
    } catch (e) {
      throw toOtpError(e, 'invalid-phone');
    }
  },

  async resendOtp(session) {
    try {
      const fn = httpsCallable<{ sessionId: string }, ResendResponse>(functions, 'resendOtp');
      const { data } = await fn({ sessionId: session.sessionId });
      return { resendsLeft: data.resendsLeft, resendAfterSec: data.resendAfterSec };
    } catch (e) {
      throw toOtpError(e, 'session-expired');
    }
  },

  async verifyOtp(session, code) {
    let res: VerifyResponse;
    try {
      const fn = httpsCallable<{ sessionId: string; code: string }, VerifyResponse>(
        functions,
        'verifyOtp',
      );
      res = (await fn({ sessionId: session.sessionId, code })).data;
    } catch (e) {
      throw toOtpError(e, 'invalid-code');
    }

    // Separate try: the code WAS correct and the session is already burned
    // server-side, so a failure here is a sign-in problem, never a bad code —
    // and the same code can never be replayed, hence "request a new code".
    try {
      await signInWithCustomToken(auth, res.token);
    } catch {
      throw new OtpError('session-expired', 'Could not start your session. Please request a new code.');
    }
    return { isNewUser: res.isNewUser };
  },
};
