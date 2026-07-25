'use client';
/**
 * ⚠️  MOCK OTP SERVICE — DEVELOPMENT ONLY. This is NOT MSG91.
 *
 * Kept on disk as the escape hatch while MSG91 finishes enabling web requests
 * for our widget: flip NEXT_PUBLIC_USE_MOCK_OTP=true (see otpService.ts) and
 * the sign-in flow works end-to-end with no other change.
 *
 * Behaviour (same shape as the real service, so nothing above it changes):
 *   • sendOtp   → generates a random 6-digit code, opens a fake session in
 *                 sessionStorage, and TOASTS the code — the only way to read it
 *                 without an SMS. The real service never returns a code, so
 *                 this affordance lives here rather than in the UI.
 *   • resendOtp → new code for the same fake session, same 3-resend budget.
 *   • verifyOtp → checks the entered code, then signs the user in with a REAL
 *                 Firebase Auth session using a deterministic per-phone
 *                 email/password credential. Deterministic ⇒ the SAME phone
 *                 always maps to the SAME uid — the very uid the real backend
 *                 reuses too (resolveUid() in functions/src/auth/otp.ts), so
 *                 wishlist/orders/wallet survive a switch in either direction.
 */
import { toast } from 'sonner';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { OtpError, type OtpService, type OtpSession } from './otpService';

/** Fixed dev password for the deterministic mock credential (≥6 chars). */
const MOCK_PASSWORD = 'barakath-mock-otp-2026';
/** Mirrors the server's limits so the UI behaves identically under the mock. */
const EXPIRES_IN_SEC = 10 * 60;
const RESEND_AFTER_SEC = 30;
const MAX_RESENDS = 3;

/** Deterministic dummy email so one phone ⇒ one Firebase user ⇒ one uid. */
const mockEmail = (e164: string) => `otp_${e164.replace(/\D/g, '')}@mock.barakath.app`;
const sessionKey = (sessionId: string) => `mock-otp:${sessionId}`;

/** The fake session doc — the mock's stand-in for `otpSessions/{id}`. */
interface MockSession {
  phone: string;
  code: string;
  resends: number;
  expiresAt: number;
}

function gen6(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readSession(sessionId: string): MockSession | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(sessionId));
    return raw ? (JSON.parse(raw) as MockSession) : null;
  } catch {
    return null;
  }
}

function writeSession(sessionId: string, s: MockSession): void {
  try {
    sessionStorage.setItem(sessionKey(sessionId), JSON.stringify(s));
  } catch {
    /* ignore storage errors — dev only */
  }
}

/** Load a live session or throw the same OtpError the real backend would. */
function loadSession(sessionId: string): MockSession {
  const s = readSession(sessionId);
  if (!s) throw new OtpError('session-expired', 'This sign-in has expired. Request a new code.');
  if (s.expiresAt < Date.now()) {
    throw new OtpError('expired', 'That code has expired. Request a new one.');
  }
  return s;
}

/** DEV ONLY — the real service cannot do this; MSG91 keeps the code. */
function announce(code: string): void {
  toast.success(`Your OTP is ${code}`, {
    description: 'Development mode — enter this code to continue.',
    duration: 15000,
  });
}

export const mockOtpService: OtpService = {
  async sendOtp(e164) {
    const sessionId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const code = gen6();
    writeSession(sessionId, {
      phone: e164,
      code,
      resends: 0,
      expiresAt: Date.now() + EXPIRES_IN_SEC * 1000,
    });
    await wait(600); // simulate the SMS round-trip for a realistic UX
    announce(code);
    return {
      session: {
        sessionId,
        expiresInSec: EXPIRES_IN_SEC,
        resendAfterSec: RESEND_AFTER_SEC,
        maxResends: MAX_RESENDS,
      },
    };
  },

  async resendOtp(session: OtpSession) {
    const s = loadSession(session.sessionId);
    if (s.resends >= MAX_RESENDS) {
      throw new OtpError('exhausted', 'No resends left. Start again with a new code.');
    }
    const code = gen6();
    writeSession(session.sessionId, { ...s, code, resends: s.resends + 1 });
    await wait(600);
    announce(code);
    return { resendsLeft: MAX_RESENDS - (s.resends + 1), resendAfterSec: RESEND_AFTER_SEC };
  },

  async verifyOtp(session: OtpSession, code: string) {
    const s = loadSession(session.sessionId);
    await wait(500); // simulate verification latency
    if (code !== s.code) throw new OtpError('invalid-code', 'That code is incorrect.');

    // Correct code → establish a real Firebase session (sign in, or create the
    // account the first time this phone logs in).
    const email = mockEmail(s.phone);
    let isNewUser = false;
    try {
      await signInWithEmailAndPassword(auth, email, MOCK_PASSWORD);
    } catch {
      await createUserWithEmailAndPassword(auth, email, MOCK_PASSWORD);
      isNewUser = true;
    }
    try {
      sessionStorage.removeItem(sessionKey(session.sessionId)); // single-use
    } catch {
      /* ignore */
    }
    return { isNewUser };
  },
};
