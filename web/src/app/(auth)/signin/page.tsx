'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { AuthBrandPanel } from '@/components/auth/AuthBrandPanel';
import { OtpInput } from '@/components/auth/OtpInput';
import {
  OTP_RE,
  PHONE_RE,
  digitsOnly,
  formatPhone,
  requestOtp,
  resendOtp,
  verifyOtp,
} from '@/components/auth/authActions';

/** Only a fallback — the server tells us the real cooldown with every send. */
const RESEND_SECONDS = 30;

export default function SignInPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  /** null until the server has told us the budget for this session. */
  const [resendsLeft, setResendsLeft] = useState<number | null>(null);
  /**
   * Double-tap guard. The `sending` / `verifying` flags drive the UI, but two
   * events in the same tick (button click + OtpInput auto-complete, or an
   * impatient second click) would both read the pre-update state, so the guard
   * that actually blocks the second call has to be a ref.
   */
  const inFlight = useRef(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  const phoneValid = PHONE_RE.test(phone);
  const otpValid = OTP_RE.test(otp);

  /** Back to step 1 with nothing stale left over (dead/expired session). */
  const backToPhone = useCallback(() => {
    setStep('phone');
    setOtp('');
    setResendIn(0);
    setResendsLeft(null);
  }, []);

  const send = useCallback(async () => {
    if (!phoneValid || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    const { ok, reason, resendAfterSec, maxResends } = await requestOtp(phone, 'signin');
    inFlight.current = false;
    setSending(false);
    if (reason === 'not_registered') {
      toast.error('No account found for this number. Please register first.');
      return;
    }
    // Any other failure (bad number, rate limit, SMS provider down) has already
    // been toasted with the server's own wording by requestOtp.
    if (!ok) return;
    setStep('code');
    setOtp('');
    setResendsLeft(maxResends ?? null);
    setResendIn(resendAfterSec ?? RESEND_SECONDS);
    toast.success('Code sent — check your messages.');
  }, [phone, phoneValid]);

  /**
   * Resend on the SAME session — never a second `send`, which would spend one
   * of the number's hourly codes instead of one of the session's 3 resends.
   * Only ever user-initiated: nothing here auto-retries.
   */
  const resend = useCallback(async () => {
    if (inFlight.current || resendIn > 0 || resendsLeft === 0) return;
    inFlight.current = true;
    setSending(true);
    const { ok, restart, resendAfterSec, resendsLeft: left } = await resendOtp();
    inFlight.current = false;
    setSending(false);
    if (restart) return backToPhone();
    if (left !== undefined) setResendsLeft(left);
    if (!ok) return; // resendOtp toasted why (cooldown, budget spent, network)
    setOtp('');
    setResendIn(resendAfterSec ?? RESEND_SECONDS);
  }, [resendIn, resendsLeft, backToPhone]);

  const finishVerify = useCallback(
    async (code: string) => {
      // OTP_RE also stops a short/empty code from ever reaching the server.
      if (!OTP_RE.test(code) || inFlight.current) return;
      inFlight.current = true;
      setVerifying(true);
      const { signedIn, needsProfile, restart } = await verifyOtp(phone, code, 'signin');
      if (signedIn) {
        // Deliberately stay disabled: navigation is next, and re-enabling the
        // button would invite a second submit against an already-burned code.
        // First-time users still need to complete their profile.
        router.replace(needsProfile ? '/create-profile' : '/');
        return;
      }
      inFlight.current = false;
      setVerifying(false);
      // Wrong code: clear the boxes so retyping can't resubmit the same digits.
      setOtp('');
      // Expired / used / too many attempts — the session is dead, start over.
      if (restart) backToPhone();
    },
    [phone, router, backToPhone],
  );

  return (
    <div className="grid min-h-screen bg-surface-card lg:grid-cols-[1fr_560px]">
      <AuthBrandPanel
        title="Premium finds,"
        accent="handpicked for you"
        subtitle="Sign in with your mobile number — no passwords. Perfumes, books, clothing and Islamic essentials await."
        glow="bottom-left"
      />

      <div className="mx-auto flex w-full max-w-[460px] flex-col justify-center gap-8 px-6 py-12 sm:gap-10 sm:px-10">
        {/* mobile-only logo (brand panel is desktop-only) */}
        <Link href="/" className="lg:hidden">
          <Image src="/images/logo.png" alt="Barakath" width={140} height={40} className="h-9 w-auto object-contain" />
        </Link>

        {/* Step 1 — phone */}
        <div className="flex flex-col gap-[22px]">
          <div>
            <h2 className="m-0 mb-1.5 font-display text-[22px] font-extrabold leading-tight tracking-[-0.02em] text-text-primary sm:text-[26px]">
              Enter your mobile number
            </h2>
            <p className="m-0 font-ui text-sm leading-[1.5] text-text-secondary">
              We&apos;ll text you a 6-digit code to verify.
            </p>
          </div>

          <PhoneEntry
            value={phone}
            onChange={setPhone}
            onEnter={send}
            editable={step === 'phone'}
            onEdit={backToPhone}
          />

          {step === 'phone' && (
            <Button
              theme="primary"
              size="l"
              block
              onClick={send}
              disabled={!phoneValid || sending}
            >
              {sending ? 'Sending…' : 'Send OTP'}
            </Button>
          )}

          {step === 'phone' && (
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
          )}
        </div>

        {step === 'code' && (
          <>
            <div className="h-px bg-border-subtle" />

            <div className="flex flex-col gap-4">
              <div className="font-ui text-[13px] font-bold leading-none text-text-primary">
                Enter 6-digit code
              </div>
              <OtpInput
                value={otp}
                onChange={setOtp}
                onComplete={finishVerify}
                disabled={verifying || sending}
              />

              <Button
                theme="primary"
                size="l"
                block
                onClick={() => finishVerify(otp)}
                disabled={!otpValid || verifying || sending}
              >
                {verifying ? 'Verifying…' : 'Verify & continue'}
              </Button>

              {resendIn > 0 ? (
                <div className="font-ui text-[13px] font-medium leading-none text-text-tertiary">
                  Resend code in 00:{String(resendIn).padStart(2, '0')}
                </div>
              ) : resendsLeft === 0 ? (
                /* Budget spent — the server refuses more, so don't offer it. */
                <div className="font-ui text-[13px] font-medium leading-none text-text-tertiary">
                  No resends left — edit your number to start again.
                </div>
              ) : (
                <button
                  type="button"
                  onClick={resend}
                  disabled={sending || verifying}
                  className="w-fit font-ui text-[13px] font-bold leading-none text-brand-primary hover:underline disabled:opacity-60"
                >
                  {sending ? 'Sending…' : 'Resend code'}
                </button>
              )}

            </div>
          </>
        )}

        {/* Always visible — matches the prototype's form footer */}
        <div className="font-ui text-[13px] font-medium text-text-secondary">
          New to Barakath?{' '}
          <Link href="/register" className="font-bold text-brand-primary hover:underline">
            Register
          </Link>
        </div>
      </div>
    </div>
  );
}

/** +91 prefixed number field. Read-only summary once the code step is active. */
function PhoneEntry({
  value,
  onChange,
  onEnter,
  editable,
  onEdit,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  editable: boolean;
  onEdit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const active = PHONE_RE.test(value) || value.length > 0;
  return (
    <div>
      <div className="mb-2 font-ui text-[13px] font-bold leading-none text-text-primary">
        Mobile number
      </div>
      <div
        className={`flex items-center gap-3 rounded-[12px] px-4 py-[15px] transition-colors ${
          editable && active ? 'border-2 border-brand-primary' : 'border-[1.5px] border-border'
        }`}
      >
        <span className="border-r border-border-subtle pr-3 font-ui text-[15px] font-bold leading-none text-text-primary">
          +91
        </span>
        {editable ? (
          <input
            ref={inputRef}
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="00000 00000"
            value={formatPhone(value)}
            onChange={(e) => onChange(digitsOnly(e.target.value, 10))}
            onKeyDown={(e) => e.key === 'Enter' && onEnter()}
            className="w-full bg-transparent font-ui text-[15px] font-medium leading-none text-text-primary outline-none placeholder:text-text-tertiary"
          />
        ) : (
          <button
            type="button"
            onClick={onEdit}
            className="flex w-full items-center justify-between font-ui text-[15px] font-medium leading-none text-text-primary"
          >
            <span>{formatPhone(value)}</span>
            <span className="font-ui text-[13px] font-bold text-brand-primary">Edit</span>
          </button>
        )}
      </div>
    </div>
  );
}
