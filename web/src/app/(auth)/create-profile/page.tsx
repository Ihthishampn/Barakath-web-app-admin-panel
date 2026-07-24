'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/Button';
import { AuthField } from '@/components/auth/AuthField';
import { EMAIL_RE, completeProfile, formatPhone, linkReferral } from '@/components/auth/authActions';
import { useAuth } from '@/lib/auth';
import { clearStashedReferralCode, readStashedReferralCode } from '@/lib/affiliate';

/** Local (10-digit) portion of an E.164 +91 number for display. */
function localPart(phone: string | undefined): string {
  if (!phone) return '';
  return phone.replace(/^\+?91/, '').replace(/\D/g, '');
}

export default function CreateProfilePage() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const customer = useAuth((s) => s.customer);
  const ready = useAuth((s) => s.ready);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [referral, setReferral] = useState('');
  /** Server's verdict on the code, pinned to the field so it can be corrected. */
  const [referralError, setReferralError] = useState<string | null>(null);
  /** Set once completeProfile has succeeded, so a referral retry never re-saves. */
  const [profileSaved, setProfileSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // Prefill from whatever the auth session already knows.
  useEffect(() => {
    if (customer?.name) setName(customer.name);
    if (customer?.email) setEmail(customer.email);
  }, [customer]);

  // A code captured from a shared `/r/{CODE}` link earlier in this tab — this
  // screen is the other place a friend's code can still be entered, and without
  // this the referral is silently lost for anyone who reaches sign-up through
  // here rather than through /register.
  useEffect(() => {
    const code = readStashedReferralCode();
    if (code) setReferral((cur) => cur || code);
  }, []);

  // No session → nothing to complete. Send them to sign in.
  useEffect(() => {
    if (ready && !user) router.replace('/signin');
  }, [ready, user, router]);

  // Already skipped once → honour it. Sign-in routes here purely off
  // profileComplete, so without this the customer is dropped back on this
  // screen at every sign-in with no way to dismiss it for good.
  useEffect(() => {
    if (ready && customer?.profileSkipped && !customer.profileComplete) router.replace('/');
  }, [ready, customer, router]);

  const phone = localPart(user?.phoneNumber ?? customer?.phone);
  const initial = useMemo(() => (name.trim()[0] ?? 'B').toUpperCase(), [name]);

  const nameOk = name.trim().length > 0;
  const emailOk = email.trim() === '' || EMAIL_RE.test(email.trim());

  /**
   * Someone who registered through /register was already asked there (and, on a
   * bad code, made to fix it), and the callable refuses a second link anyway —
   * so once `referredBy` exists the field is gone rather than asked twice.
   */
  const alreadyReferred = !!customer?.referredBy;

  async function submit() {
    if (busy) return;
    if (!profileSaved) {
      if (!nameOk) return toast.error('Please enter your display name.');
      if (!emailOk) return toast.error('That email address looks invalid.');
    }
    setBusy(true);
    // Re-entry after a refused code: the profile is already stored, so this is
    // purely another attempt at the referral.
    if (!profileSaved) {
      const ok = await completeProfile(name.trim(), email.trim() || null);
      if (!ok) {
        setBusy(false);
        return;
      }
      setProfileSaved(true);
    }
    const res = alreadyReferred ? ({ status: 'skipped' } as const) : await linkReferral(referral);
    setBusy(false);
    // The profile is saved either way — a refused code only holds them here so
    // they can correct it, because sign-up is the last chance to be attributed.
    if (res.status === 'invalid' || res.status === 'error') {
      setReferralError(res.message);
      return;
    }
    clearStashedReferralCode();
    toast.success('Profile saved. Welcome to Barakath!');
    router.replace('/');
  }

  /**
   * Skip → remember it. Writing nothing (the old behaviour) meant
   * profileComplete stayed false and sign-in forced this screen again forever.
   * `profileSkipped` is an owner-writable field on the customer doc.
   */
  async function skip() {
    if (user) {
      try {
        await updateDoc(doc(db, 'customers', user.uid), {
          profileSkipped: true,
          updatedAt: serverTimestamp(),
        });
      } catch {
        /* best-effort — never block leaving this screen */
      }
    }
    router.replace('/');
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="flex w-full max-w-[520px] flex-col gap-[18px] rounded-2xl border border-border-subtle bg-surface-card p-9 shadow-lg">
      <div>
        <h1 className="m-0 mb-1.5 font-display text-[26px] font-extrabold leading-[1.1] tracking-[-0.02em] text-text-primary">
          Create your profile
        </h1>
        <p className="m-0 font-ui text-sm leading-[1.5] text-text-secondary">
          Just the essentials — you can skip and do this later.
        </p>
      </div>

      <div className="flex justify-center">
        <div className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-gradient-to-br from-brand-primary to-brand-primary-dark font-display text-[32px] font-extrabold leading-none text-white">
          {initial}
        </div>
      </div>

      <AuthField
        label="Display name"
        placeholder="Mira Osei"
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="flex flex-col gap-[7px]">
        <span className="font-ui text-[13px] font-bold leading-none text-text-primary">
          WhatsApp number
        </span>
        <div className="rounded-[10px] border border-border bg-neutral-200 px-4 py-[14px] font-ui text-[15px] font-medium leading-none text-text-secondary">
          {phone ? `+91 ${formatPhone(phone)}` : 'Verified number'}
        </div>
      </div>

      {!alreadyReferred && (
        <AuthField
          label="Friend's code"
          optional
          placeholder="MIRA-7Q2K"
          value={referral}
          error={referralError}
          onChange={(e) => {
            setReferral(e.target.value.toUpperCase());
            setReferralError(null); // typing is the correction — drop the stale verdict
          }}
        />
      )}

      <AuthField
        label="Email address"
        optional
        type="email"
        inputMode="email"
        placeholder="mira.osei@email.com"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <div className="mt-1.5">
        <Button theme="primary" size="l" block onClick={submit} disabled={!nameOk || busy}>
          {busy ? 'Saving…' : profileSaved ? 'Apply code' : 'Enter Barakath'}
        </Button>
      </div>

      {/* Once the profile is stored the only thing left is the code, so this is
          "go on without one" rather than "skip the profile". */}
      <button
        type="button"
        onClick={() => (profileSaved ? router.replace('/') : void skip())}
        className="text-center font-ui text-sm font-bold text-brand-primary hover:underline"
      >
        {profileSaved ? 'Continue without a code' : 'Skip for now'}
      </button>
      </div>
    </div>
  );
}
