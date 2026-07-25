'use client';
/**
 * OTP service boundary.
 *
 * The whole login UI (signin / create-profile pages) and the auth store talk
 * ONLY to `otpService` through this interface — they never know whether the
 * implementation is the dev mock or the real MSG91 backend.
 *
 * ┌─ MOCK ⇄ REAL ──────────────────────────────────────────────────────────┐
 * │ One env line in web/.env.local, no code change:                         │
 * │     NEXT_PUBLIC_USE_MOCK_OTP=true    → dev mock (code shown in a toast)  │
 * │     NEXT_PUBLIC_USE_MOCK_OTP=false   → real MSG91 (default)              │
 * │ Restart `next dev` after changing it — NEXT_PUBLIC_* is inlined at build │
 * │ time. The mock stays on disk on purpose: MSG91 still has to enable web   │
 * │ requests for our widget, so we may need to fall back at short notice.    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * The real implementation is a thin client over the deployed asia-south1
 * callables in functions/src/auth/otp.ts — that file is the contract.
 */

/**
 * Server-owned state for one OTP attempt. It is opaque to the UI: the UI only
 * hands it back to `resendOtp` / `verifyOtp` and reads the countdown numbers.
 */
export interface OtpSession {
  /** `otpSessions/{id}` — the only handle the client is allowed to hold. */
  sessionId: string;
  /** Lifetime of the code MSG91 sent (seconds). */
  expiresInSec: number;
  /** Seconds to wait before a resend is accepted. Drives the UI countdown. */
  resendAfterSec: number;
  /** How many resends the server will grant for this session in total. */
  maxResends: number;
}

export interface OtpSendResult {
  session: OtpSession;
}

export interface OtpResendResult {
  /** Resends still available after this one. 0 ⇒ the user must start again. */
  resendsLeft: number;
  resendAfterSec: number;
}

export interface OtpVerifyResult {
  /** First-ever sign-in for this phone (no `customers/{uid}` doc server-side). */
  isNewUser: boolean;
}

/**
 * Every failure mode the backend can report, collapsed into the handful of
 * distinct things a customer can actually DO about it.
 *
 * These map 1:1 onto the callable status codes in functions/src/auth/otp.ts —
 * `invalid-argument` is the only ambiguous one, so each call site decides
 * whether it meant "bad phone" or "wrong code".
 */
export type OtpErrorKind =
  | 'invalid-phone' // invalid-argument on sendOtp
  | 'invalid-code' // invalid-argument on verifyOtp — wrong digits, retryable
  | 'expired' // deadline-exceeded — code timed out, needs a new one
  | 'exhausted' // resource-exhausted — attempt / resend / per-number cap hit
  | 'precondition' // failed-precondition — resend cooldown, or code already used
  | 'session-expired' // not-found — the session doc is gone, start again
  | 'network' // unavailable — SMS provider or connectivity, always retryable
  | 'blocked' // permission-denied — the account is blocked
  | 'unknown';

/**
 * Thrown by every OtpService method. Carries the server's own customer-facing
 * sentence in `message` (see functions/src/auth/otp.ts — it writes them for
 * exactly this purpose) plus the `kind` the UI branches on.
 */
export class OtpError extends Error {
  constructor(
    readonly kind: OtpErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'OtpError';
  }
}

export interface OtpService {
  /**
   * Send an OTP to an E.164 phone number and open a session.
   * The code is delivered by SMS and is NEVER returned to the client.
   * @throws OtpError
   */
  sendOtp(e164: string): Promise<OtpSendResult>;
  /**
   * Re-send the code for an existing session (cheaper and safer than opening a
   * new one — it reuses MSG91's reqId and counts against the session's resend
   * budget instead of the per-number hourly send cap).
   * @throws OtpError
   */
  resendOtp(session: OtpSession): Promise<OtpResendResult>;
  /**
   * Verify the code and, on success, establish a real Firebase Auth session.
   * @throws OtpError
   */
  verifyOtp(session: OtpSession, code: string): Promise<OtpVerifyResult>;
}

import { mockOtpService } from './mockOtpService';
import { msg91OtpService } from './msg91OtpService';

/**
 * ← Active provider. Real MSG91 unless the mock is explicitly opted into, so a
 * missing/typo'd env var can never silently ship the mock to production.
 *
 * The mock is additionally refused outright in a production build. It signs in
 * with a DETERMINISTIC email plus a hardcoded password, against the real
 * Firebase project — so if that env var ever leaked into a deployed build,
 * anyone who knew the scheme could sign in as any phone number. Real MSG91 is
 * working again, so nothing legitimate needs this path outside local dev.
 */
const mockRequested = process.env.NEXT_PUBLIC_USE_MOCK_OTP === 'true';
const mockAllowed = process.env.NODE_ENV !== 'production';

if (mockRequested && !mockAllowed) {
  // Loud, not silent: a production build that asked for the mock is a
  // misconfiguration someone must fix, not something to paper over.
  console.error(
    '[otp] NEXT_PUBLIC_USE_MOCK_OTP=true was ignored in a production build — using real MSG91.',
  );
}

export const otpService: OtpService =
  mockRequested && mockAllowed ? mockOtpService : msg91OtpService;
