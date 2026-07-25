'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  clearStashedReferralCode,
  normaliseReferralCode,
  readStashedReferralCode,
} from '@/lib/affiliate';
import { Button } from '@/components/ui/Button';
import { AuthBrandPanel } from '@/components/auth/AuthBrandPanel';
import { AuthField } from '@/components/auth/AuthField';
import { OtpInput } from '@/components/auth/OtpInput';
import {
  EMAIL_RE,
  OTP_RE,
  PHONE_RE,
  completeProfile,
  digitsOnly,
  formatPhone,
  linkReferral,
  requestOtp,
  resendOtp,
  verifyOtp,
} from '@/components/auth/authActions';

const RESEND_SECONDS = 30;

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [referral, setReferral] = useState('');
  /** Server's verdict on the code, pinned to the field so it can be corrected. */
  const [referralError, setReferralError] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  /**
   * 'referral' is entered ONLY after the account exists and the code was
   * rejected: sign-up is now the only chance to be attributed, so the customer
   * gets to fix the code instead of losing the referral to a passing toast.
   */
  const [step, setStep] = useState<'form' | 'code' | 'referral'>('form');
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [resendsLeft, setResendsLeft] = useState(0);
  /**
   * Double-submit guard. `busy` drives the UI, but two events in the same tick
   * (the OtpInput auto-completing on the sixth digit while the "Verify" button
   * is clicked) both read the pre-update state — so the guard that actually
   * blocks the second call has to be a ref. Same guard the sign-in screen uses;
   * without it a second `verifyOtp` runs against an already-burned session and
   * reports failure over the top of a successful registration.
   */
  const inFlight = useRef(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  /**
   * Pre-fill the friend's code for someone who arrived through a shared
   * referral link (`/r/{CODE}` → `/register?ref=CODE`, see app/(shop)/r/[code]).
   * The stash is the fallback for a visitor who bounced via /signin first.
   *
   * Read straight off `window.location` rather than through `useSearchParams`,
   * which would force this whole screen behind a Suspense boundary for no gain
   * — the page is client-only already.
   */
  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get('ref');
    const code = normaliseReferralCode(fromQuery) || readStashedReferralCode();
    if (code) setReferral((cur) => cur || code);
  }, []);

  const nameOk = name.trim().length > 0;
  const phoneOk = PHONE_RE.test(phone);
  const emailOk = email.trim() === '' || EMAIL_RE.test(email.trim());
  const formOk = nameOk && phoneOk && emailOk;

  const submitForm = useCallback(async () => {
    if (inFlight.current) return;
    if (!nameOk) return toast.error('Please enter your display name.');
    if (!phoneOk) return toast.error('Enter a valid 10-digit mobile number.');
    if (!emailOk) return toast.error('That email address looks invalid.');
    inFlight.current = true;
    setBusy(true);
    const { ok, reason, resendAfterSec, maxResends } = await requestOtp(phone, 'signup');
    inFlight.current = false;
    setBusy(false);
    if (reason === 'already_registered') {
      toast.error('This number is already registered. Please sign in instead.');
      return;
    }
    if (ok) {
      setStep('code');
      // The cooldown is the server's to decide — it also enforces it, so a
      // locally-guessed value would just produce a rejected resend.
      setResendIn(resendAfterSec ?? RESEND_SECONDS);
      setResendsLeft(maxResends ?? 0);
      toast.success('Code sent — check your messages.');
    }
  }, [nameOk, phoneOk, emailOk, phone]);

  /**
   * Resend on the CURRENT session. Re-running submitForm would open a whole new
   * session and burn one of the five codes this number gets per hour, instead
   * of one of the session's three free resends.
   */
  const resend = useCallback(async () => {
    if (inFlight.current || resendIn > 0 || resendsLeft <= 0) return;
    inFlight.current = true;
    setBusy(true);
    const r = await resendOtp();
    inFlight.current = false;
    setBusy(false);
    if (r.restart) {
      setStep('form');
      setOtp('');
      return;
    }
    if (r.resendsLeft !== undefined) setResendsLeft(r.resendsLeft);
    if (r.ok) setResendIn(r.resendAfterSec ?? RESEND_SECONDS);
  }, [resendIn, resendsLeft]);

  const finish = useCallback(
    async (code: string) => {
      if (!OTP_RE.test(code) || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      const { signedIn } = await verifyOtp(phone, code, 'signup');
      if (!signedIn) {
        inFlight.current = false;
        setBusy(false);
        // The code the boxes still hold is spent — retyping it would only fail
        // again, so clear them for the fresh one the customer has to request.
        setOtp('');
        return;
      }
      // New account: persist the details we collected up-front, then enter the shop.
      const saved = await completeProfile(name.trim(), email.trim() || null);
      // linkReferral refuses to run against an incomplete profile ("Complete
      // your profile first."), which would park the customer on the referral
      // step with a code that is perfectly valid. Skip it and let them finish
      // the profile instead of blaming their friend's code.
      const res = saved ? await linkReferral(referral) : { status: 'skipped' as const };
      setBusy(false);
      // The account is created and signed in either way — never fail sign-up on
      // a referral code. A correctable outcome just parks the customer on the
      // code field; anything else (linked, empty, already linked) walks on.
      if (res.status === 'invalid' || res.status === 'error') {
        inFlight.current = false;
        setReferralError(res.message);
        setStep('referral');
        return;
      }
      // Settled one way or the other — the captured referral link has done its
      // job and must not pre-fill a later, unrelated sign-up in this tab.
      if (saved) clearStashedReferralCode();
      // Deliberately stays in flight: navigation is next, and re-enabling the
      // form would invite a second submit against an already-burned code.
      router.replace(saved ? '/' : '/create-profile');
    },
    [phone, name, email, referral, router],
  );

  /** Retry the rejected code (or drop it — an empty field links nothing). */
  const retryReferral = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const res = await linkReferral(referral);
    setBusy(false);
    if (res.status === 'invalid' || res.status === 'error') {
      inFlight.current = false;
      setReferralError(res.message);
      return;
    }
    clearStashedReferralCode();
    router.replace('/');
  }, [referral, router]);

  return (
    <div className="grid min-h-screen bg-surface-card lg:grid-cols-[1fr_560px]">
      <AuthBrandPanel
        title="Create your account"
        accent="Barakath"
        accentPosition="before"
        subtitle="Join for exclusive Eid drops, wallet rewards and Spin & Win."
        glow="top-right"
      />

      <div className="mx-auto flex w-full max-w-[460px] flex-col justify-center gap-4 px-6 py-12 sm:px-10">
        <Link href="/" className="mb-2 lg:hidden">
          <Image src="/images/logo.png" alt="Barakath" width={140} height={40} className="h-9 w-auto object-contain" />
        </Link>
        <div>
          <h2 className="m-0 mb-1.5 font-display text-[26px] font-extrabold leading-[1.1] tracking-[-0.02em] text-text-primary">
            Register
          </h2>
          <p className="m-0 font-ui text-sm leading-[1.5] text-text-secondary">
            Create an account in under a minute.
          </p>
        </div>

        <AuthField
          label="Display name"
          placeholder="Mira Osei"
          autoComplete="name"
          value={name}
          disabled={step !== 'form'}
          onChange={(e) => setName(e.target.value)}
        />

        <PhoneField
          value={phone}
          disabled={step !== 'form'}
          onChange={(v) => setPhone(v)}
        />

        <AuthField
          label="Email address"
          optional
          type="email"
          inputMode="email"
          placeholder="mira.osei@email.com"
          autoComplete="email"
          value={email}
          disabled={step !== 'form'}
          onChange={(e) => setEmail(e.target.value)}
        />

        <AuthField
          label="Friend's code"
          optional
          placeholder="MIRA-7Q2K"
          value={referral}
          // Editable again on the 'referral' step — that step exists precisely
          // so a rejected code can be corrected.
          disabled={step === 'code'}
          error={referralError}
          onChange={(e) => {
            setReferral(e.target.value.toUpperCase());
            setReferralError(null); // typing is the correction — drop the stale verdict
          }}
        />

        {step === 'form' ? (
          <div className="mt-1.5 flex flex-col gap-3">
            <Button theme="primary" size="l" block onClick={submitForm} disabled={!formOk || busy}>
              {busy ? 'Sending…' : 'Create account'}
            </Button>
            <p className="m-0 text-center font-ui text-[11px] leading-[1.5] text-text-tertiary">
              By continuing you agree to our{' '}
              <Link href="/terms" className="font-bold text-brand-primary hover:underline">
                Terms &amp; Conditions
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="font-bold text-brand-primary hover:underline">
                Privacy Policy
              </Link>
            </p>
          </div>
        ) : step === 'referral' ? (
          <div className="mt-1.5 flex flex-col gap-4">
            <div className="h-px bg-border-subtle" />
            <div className="font-ui text-[13px] font-medium leading-[1.5] text-text-secondary">
              Your account is ready — only the friend&apos;s code above was refused.
              Correct it, or continue without one (it can&apos;t be added later).
            </div>
            <Button theme="primary" size="l" block onClick={retryReferral} disabled={busy}>
              {busy ? 'Applying…' : 'Apply code'}
            </Button>
            <button
              type="button"
              onClick={() => router.replace('/')}
              disabled={busy}
              className="w-fit font-ui text-[13px] font-bold leading-none text-brand-primary hover:underline disabled:opacity-60"
            >
              Continue without a code
            </button>
          </div>
        ) : (
          <div className="mt-1.5 flex flex-col gap-4">
            <div className="h-px bg-border-subtle" />
            <div className="font-ui text-[13px] font-bold leading-none text-text-primary">
              Enter the 6-digit code sent to +91 {formatPhone(phone)}
            </div>
            <OtpInput value={otp} onChange={setOtp} onComplete={finish} disabled={busy} />
            <Button
              theme="primary"
              size="l"
              block
              onClick={() => finish(otp)}
              disabled={!OTP_RE.test(otp) || busy}
            >
              {busy ? 'Verifying…' : 'Verify & create account'}
            </Button>
            {resendIn > 0 ? (
              <span className="font-ui text-[13px] font-medium leading-none text-text-tertiary">
                Resend code in 00:{String(resendIn).padStart(2, '0')}
              </span>
            ) : (
              <button
                type="button"
                onClick={resend}
                disabled={busy || resendsLeft <= 0}
                className="w-fit font-ui text-[13px] font-bold leading-none text-brand-primary hover:underline disabled:opacity-60"
              >
                Resend code
              </button>
            )}
          </div>
        )}

        {/* The account exists (and is signed in) by the 'referral' step, so the
            sign-in prompt would be nonsense there. */}
        {step !== 'referral' && (
          <div className="text-center font-ui text-sm font-medium leading-none text-text-secondary">
            Already have an account?{' '}
            <Link href="/signin" className="font-bold text-brand-primary hover:underline">
              Sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

/** +91 prefixed WhatsApp number field, styled like the other register fields. */
function PhoneField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-[7px]">
      <span className="font-ui text-[13px] font-bold leading-none text-text-primary">
        Number
      </span>
      <div
        className={`flex items-center gap-3 rounded-[10px] border border-border bg-surface-card px-4 py-[14px] ${
          disabled ? 'opacity-60' : ''
        }`}
      >
        <span className="border-r border-border-subtle pr-3 font-ui text-[15px] font-bold leading-none text-text-primary">
          +91
        </span>
        <input
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="00000 00000"
          disabled={disabled}
          value={formatPhone(value)}
          onChange={(e) => onChange(digitsOnly(e.target.value, 10))}
          className="w-full bg-transparent font-ui text-[15px] font-medium leading-none text-text-primary outline-none placeholder:text-text-tertiary"
        />
      </div>
    </div>
  );
}
