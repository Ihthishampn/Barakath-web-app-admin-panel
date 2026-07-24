'use client';
/**
 * `/r/{CODE}` — the affiliate referral landing page.
 *
 * Both clients share `https://barakath.com/r/{CODE}` (see REFERRAL_SHARE_BASE)
 * and the Flutter app has always built the same link, but the website had no
 * such route, no middleware and no rewrite — every share 404'd, so a referral
 * could only ever be applied by typing the code by hand.
 *
 * The route group is cosmetic: it puts this page inside the normal shop
 * chrome (header/footer). The URL is still /r/{CODE}.
 *
 * Signed out → straight to registration with the code PRE-FILLED (the friend's
 * code field is already there; `linkReferral` binds it permanently at the end
 * of sign-up).
 * Signed in  → handled explicitly rather than silently ignored: an account with
 * no referrer yet can apply the code from here, one that already has a referrer
 * is told so, and an affiliate's own code is refused by the callable with its
 * own message.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RiUserHeartLine } from '@remixicon/react';
import { useAuth } from '@/lib/auth';
import { normaliseReferralCode, stashReferralCode } from '@/lib/affiliate';
import { linkReferral } from '@/components/auth/authActions';
import { Button } from '@/components/ui/Button';

export default function ReferralLandingPage({ params }: { params: { code: string } }) {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const customer = useAuth((s) => s.customer);
  const ready = useAuth((s) => s.ready);

  const code = normaliseReferralCode(safeDecode(params.code));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Remember it the moment the page opens, so the code survives a detour
  // through /signin or /create-profile (see stashReferralCode).
  useEffect(() => {
    if (code) stashReferralCode(code);
  }, [code]);

  // A visitor with no account: registration, code pre-filled.
  useEffect(() => {
    if (!ready || user) return;
    router.replace(code ? `/register?ref=${encodeURIComponent(code)}` : '/register');
  }, [ready, user, code, router]);

  // Signed in but with no customer document yet — finish the profile first;
  // that screen asks for the friend's code and reads the stash above.
  useEffect(() => {
    if (!ready || !user || customer) return;
    router.replace('/create-profile');
  }, [ready, user, customer, router]);

  const apply = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await linkReferral(code);
    setBusy(false);
    if (res.status === 'invalid' || res.status === 'error') {
      setError(res.message);
      return;
    }
    router.replace('/');
  }, [busy, code, router]);

  if (!ready || !user || !customer) return <Shell>{null}</Shell>;

  if (!code) {
    return (
      <Shell>
        <p className="font-display text-lg font-extrabold text-text-primary">That referral link is incomplete</p>
        <p className="mt-2 max-w-sm font-ui text-sm text-text-secondary">
          Ask your friend to share their link again.
        </p>
        <Link href="/listing" className="mt-6">
          <Button theme="gold" size="l">Start shopping</Button>
        </Link>
      </Shell>
    );
  }

  // Already attributed — permanent by design (linkReferral refuses to re-point
  // a link), so this states the fact instead of offering a button that fails.
  if (customer.referredBy) {
    return (
      <Shell>
        <p className="font-display text-lg font-extrabold text-text-primary">
          Your account is already linked
        </p>
        <p className="mt-2 max-w-sm font-ui text-sm text-text-secondary">
          A referral code can only be applied once, and yours is already set to{' '}
          <span className="font-bold text-text-primary">{customer.referredBy.affiliateCode}</span>.
        </p>
        <Link href="/listing" className="mt-6">
          <Button theme="gold" size="l">Start shopping</Button>
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="font-display text-lg font-extrabold text-text-primary">You&apos;ve been referred</p>
      <p className="mt-2 max-w-sm font-ui text-sm text-text-secondary">
        Apply your friend&apos;s code to your account. It can only be done once, and it can&apos;t be
        changed later.
      </p>
      <div className="mt-5 rounded-[10px] border border-dashed border-brand-gold-border bg-brand-gold-subtle px-6 py-3.5 font-ui text-lg font-extrabold tracking-[1px] text-brand-gold-strong">
        {code}
      </div>
      {error && <p className="mt-3 max-w-sm font-ui text-[13px] font-semibold text-error">{error}</p>}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button theme="primary" size="l" disabled={busy} onClick={() => void apply()}>
          {busy ? 'Applying…' : 'Apply code'}
        </Button>
        <Link href="/listing">
          <Button theme="neutral" size="l" outline>Not now</Button>
        </Link>
      </div>
    </Shell>
  );
}

/** `decodeURIComponent` throws on a malformed escape (`/r/%`) — that is a bad
 *  link, not a crash. */
function safeDecode(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The empty/centred state this section already uses elsewhere in the shop. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-page flex-col items-center px-4 py-24 text-center sm:px-10">
      <div className="grid h-20 w-20 place-items-center rounded-full bg-brand-primary-subtle text-brand-primary">
        <RiUserHeartLine size={36} />
      </div>
      <div className="mt-6 flex flex-col items-center">{children}</div>
    </div>
  );
}
