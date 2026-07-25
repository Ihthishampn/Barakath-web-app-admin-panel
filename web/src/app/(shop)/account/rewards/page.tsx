'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { RiGiftLine } from '@remixicon/react';
import { toast } from 'sonner';
import type { DiscountType, SpinCampaign, SpinSlice, UserCoupon, UserCouponStatus } from '@barkath/shared';
import { useAuth } from '@/lib/auth';
import { useCollection } from '@/lib/useCollection';
import { db } from '@/lib/firebase';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { CouponCard } from '@/components/wallet/CouponCard';
import { SpinWheel } from '@/components/wallet/SpinWheel';
import { AccountShell } from '@/components/account/AccountShell';
import { useCart } from '@/lib/cart';
import { callApplyCoupon, useCheckoutDraft } from '@/components/checkout/checkout';
import { useOfferCollection } from '@/components/checkout/CouponRewardBanner';
import {
  promoPersonalStatus,
  promoVisibleToCustomer,
  type CustomerOfferFacts,
  type PromoCoupon,
} from '@/components/checkout/offers';
import { WALLET_CF_MSG, callExecuteSpin, couponDisplayStatus, type SpinResult } from '@/components/wallet/actions';

/**
 * A promotional `coupons` doc carries display fields (`title`, `description`,
 * `createdAt`) the cart-pricing `PromoCoupon` type doesn't declare (it only
 * needs pricing/eligibility fields) — widen locally rather than widen that
 * shared type for a field only this page reads.
 */
interface PromoCouponDoc extends PromoCoupon {
  title?: string;
  description?: string;
  createdAt?: { toMillis?: () => number } | null;
}

/**
 * Views a promotional (admin-created) coupon as a "My Coupons" ticket for
 * THIS customer — mirrors the app's `UserCoupon.fromPromo`
 * (app/lib/features/coupons/data/user_coupon.dart). [status] is pre-resolved
 * (`promoPersonalStatus`) so this stays a pure shape-mapper.
 */
function promoToUserCoupon(
  c: PromoCouponDoc,
  status: UserCouponStatus,
  personalUses: number,
  lastUsedAt: Timestamp | null,
  lastOrderId: string | null,
): UserCoupon {
  const issuedAtMs = c.validFrom?.toMillis?.() ?? c.createdAt?.toMillis?.() ?? Date.now();
  const validUntilMs = c.validUntil?.toMillis?.();
  return {
    id: c.id ?? c.code,
    code: c.code,
    title: c.title ?? '',
    description: c.description ?? '',
    discountType: (c.discountType as DiscountType) ?? 'flat',
    discountValuePaise: c.discountValuePaise ?? null,
    discountPercent: c.discountPercent ?? null,
    discountMaxCapPaise: c.discountMaxCapPaise ?? null,
    minCartValuePaise: c.minCartValuePaise ?? 0,
    source: 'promo',
    campaignId: null,
    spinHistoryId: null,
    status,
    issuedAt: Timestamp.fromMillis(issuedAtMs),
    // `expiresAt` is typed non-null, but a "no expiry" promo coupon has none —
    // every display site (CouponCard's `endsInLabel`, `couponDisplayStatus`)
    // already optional-chains `?.toMillis?.()`, so `null` here is safe.
    expiresAt: (validUntilMs != null ? Timestamp.fromMillis(validUntilMs) : null) as unknown as Timestamp,
    usedAt: lastUsedAt,
    usedOnOrderId: lastOrderId,
    usedOnOrderShortId: null,
    // 0 = unlimited (the admin's `maxUsesPerUser` convention — unlike a
    // personal coupon's `maxUsesPerCoupon`, which is never 0), so the
    // "0/2"-style badge (CouponCard's usageLabel) knows to hide itself.
    maxUsesPerCoupon: Math.max(0, Number(c.maxUsesPerUser ?? 0)),
    usesCount: Math.max(0, personalUses),
    isNew: false,
    createdAt: Timestamp.fromMillis(issuedAtMs),
    updatedAt: Timestamp.fromMillis(issuedAtMs),
  };
}

/** Must match SpinWheel's CSS `transition` duration (SPIN_TRANSITION, 3.4s). */
const SPIN_SETTLE_MS = 3400;

const TABS: { key: UserCouponStatus; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'used', label: 'Used' },
  { key: 'expired', label: 'Expired' },
];

/** Locate the campaign slice the server picked, so the wheel can land on it. */
function matchSliceIndex(slices: SpinSlice[], result: SpinResult): number {
  if (result.sliceId) {
    const byId = slices.findIndex((s) => s.id === result.sliceId);
    if (byId !== -1) return byId;
  }
  let i = slices.findIndex(
    (s) => s.displayLabel === result.label && s.secondaryLabel === result.secondaryLabel && s.prizeType === result.prizeType,
  );
  if (i === -1) i = slices.findIndex((s) => s.displayLabel === result.label && s.prizeType === result.prizeType);
  if (i === -1) i = slices.findIndex((s) => s.displayLabel === result.label);
  if (i === -1) i = slices.findIndex((s) => s.prizeType === result.prizeType);
  return i;
}

/**
 * Whether `now` falls inside the campaign's configured window.
 *
 * `status == 'active'` alone is not enough: nothing ever flips a campaign when
 * its window opens or closes, while `executeSpin` rejects any spin outside
 * startsAt…endsAt. Mirrors the app's SpinRepository._isLive so both surfaces
 * pick the same campaign when several are active, instead of rendering a wheel
 * that can only fail.
 */
function isLive(c: SpinCampaign): boolean {
  const now = Date.now();
  const startsAt = c.startsAt?.toMillis?.();
  const endsAt = c.endsAt?.toMillis?.();
  if (startsAt && startsAt > now) return false;
  if (endsAt && endsAt < now) return false;
  return true;
}

function isFunctionsCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === `functions/${code}`;
}

export default function RewardsPage() {
  const { customer } = useAuth();
  const uid = customer?.uid;
  const router = useRouter();
  const setDraft = useCheckoutDraft((s) => s.set);

  const campaigns = useCollection<SpinCampaign>(
    () => query(collection(db, 'spinCampaigns'), where('status', '==', 'active')),
    [],
  );
  const campaign = useMemo(() => campaigns.data.find(isLive), [campaigns.data]);

  // The customer's own spin history (live), used to derive today's usage.
  const spinHistory = useCollection<{ campaignId: string; createdAt?: { toMillis?: () => number } }>(
    () => (uid ? query(collection(db, 'spinHistory'), where('customerId', '==', uid)) : null),
    [uid],
  );

  // Spins left today = the campaign's per-day cap minus the spins this customer
  // has already taken on it since IST midnight, PLUS any admin-granted spins.
  // Resets daily, admin-controlled, and updates live as the admin edits the
  // campaign or the customer spins.
  //
  // `spinsRemaining` (adminGrantSpins) is a bonus balance the server spends once
  // the daily cap is exhausted. Ignoring it here made every grant unspendable:
  // the button is disabled and spin() returns before the callable is even
  // called, so the admin's "Granted 5 spins" did nothing the customer could use.
  const spinsLeft = useMemo(() => {
    if (!campaign) return 0;
    const perDay = Math.max(1, Number(campaign.spinsPerDay ?? 1));
    const IST_OFFSET_MS = 5.5 * 3600_000;
    const istMidnight = Math.floor((Date.now() + IST_OFFSET_MS) / 86400_000) * 86400_000 - IST_OFFSET_MS;
    const usedToday = spinHistory.data.filter(
      (h) => h.campaignId === campaign.id && (h.createdAt?.toMillis?.() ?? 0) >= istMidnight,
    ).length;
    const granted = Math.max(0, Number(customer?.spinsRemaining ?? 0));
    return Math.max(0, perDay - usedToday) + granted;
  }, [campaign, spinHistory.data, customer?.spinsRemaining]);

  const { data: personalCoupons, loading: personalLoading } = useCollection<UserCoupon>(
    () => (uid ? query(collection(db, 'customers', uid, 'coupons'), orderBy('issuedAt', 'desc')) : null),
    [uid],
  );

  // Every admin-created promotional coupon (no status filter — one this
  // customer already redeemed must still show as Used even after the admin
  // pauses it or it expires), plus this customer's own redemption counters
  // for it. Mirrors the app's `OffersRepository.allPromoCoupons` +
  // `customerFacts` (app/lib/features/checkout/data/offers.dart).
  const promoDocs = useOfferCollection<PromoCouponDoc>(() => query(collection(db, 'coupons')), []);
  const couponUsageDocs = useOfferCollection<{
    id: string;
    count?: number;
    lastUsedAt?: Timestamp | null;
    lastOrderId?: string | null;
  }>(() => (uid ? query(collection(db, 'customers', uid, 'couponUsage')) : null), [uid]);

  const offerFacts = useMemo<CustomerOfferFacts>(
    () => ({
      ordersCount: Number(customer?.stats?.ordersCount ?? 0),
      affiliateEnabled: customer?.affiliate?.enabled === true,
      promoUsage: Object.fromEntries(couponUsageDocs.data.map((d) => [d.id, Math.max(0, Number(d.count ?? 0))])),
    }),
    [customer?.stats?.ordersCount, customer?.affiliate?.enabled, couponUsageDocs.data],
  );

  const visiblePromoCoupons = useMemo<UserCoupon[]>(() => {
    const now = Date.now();
    const lastUsedById = new Map(couponUsageDocs.data.map((d) => [d.id, d]));
    return promoDocs.data
      .filter((c) => promoVisibleToCustomer(c, offerFacts, now))
      .map((c) => {
        const usage = lastUsedById.get(c.id ?? '');
        return promoToUserCoupon(
          c,
          promoPersonalStatus(c, offerFacts, now),
          Math.max(0, Number(usage?.count ?? 0)),
          usage?.lastUsedAt ?? null,
          usage?.lastOrderId ?? null,
        );
      });
  }, [promoDocs.data, offerFacts]);

  const allCoupons = useMemo<UserCoupon[]>(
    () => [...personalCoupons, ...visiblePromoCoupons],
    [personalCoupons, visiblePromoCoupons],
  );
  const couponsLoading = personalLoading || promoDocs.loading;

  const [tab, setTab] = useState<UserCouponStatus>('active');
  const [code, setCode] = useState('');
  const [applyingCode, setApplyingCode] = useState(false);
  // Bucket by DISPLAY status (expiry computed on read), so a coupon past its
  // expiresAt shows under Expired even before the daily sweep flips its status.
  const filtered = useMemo(
    () => allCoupons.filter((c) => couponDisplayStatus(c) === tab),
    [allCoupons, tab],
  );

  const [spinning, setSpinning] = useState(false);
  const [deg, setDeg] = useState(0);
  const slices = useMemo(() => [...(campaign?.slices ?? [])].sort((a, b) => a.order - b.order), [campaign]);

  /**
   * Apply a coupon to the bag.
   *
   * This used to push `/bag?coupon=CODE`, but nothing reads that query string —
   * the code was silently dropped. Validate it server-side and put it on the
   * shared checkout draft (what the bag/checkout screens actually read), then
   * go to the bag.
   */
  async function applyCode(value: string) {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed || applyingCode) return;
    const lines = useCart.getState().lines;
    if (lines.length === 0) {
      toast.error('Add something to your bag before applying a coupon.');
      router.push('/bag');
      return;
    }
    setApplyingCode(true);
    try {
      const res = await callApplyCoupon(trimmed, lines);
      setDraft({ coupon: { code: trimmed, discountPaise: res.discountPaise, label: res.label, waiveDelivery: res.waiveDelivery } });
      toast.success(`Coupon ${trimmed} applied`);
      router.push('/bag');
    } catch (e) {
      // Surface the server's own reason (expired, minimum not met, …).
      const m = (e as { message?: string })?.message;
      toast.error(m && !m.startsWith('INTERNAL') ? m : "That coupon couldn't be applied.");
    } finally {
      setApplyingCode(false);
    }
  }

  async function spin() {
    if (spinning) return;
    if (!campaign) {
      toast.error('No active spin campaign right now.');
      return;
    }
    if (spinsLeft <= 0) {
      toast.error('You have no spins left. Check back after more are added.');
      return;
    }
    setSpinning(true);
    try {
      const result = await callExecuteSpin(campaign.id);
      const n = slices.length;
      const matched = n > 0 ? matchSliceIndex(slices, result) : -1;
      const idx = matched >= 0 ? matched : 0;
      const seg = n > 0 ? 360 / n : 0;
      const targetMod = n > 0 ? ((-((idx + 0.5) * seg) % 360) + 360) % 360 : 0;
      setDeg((d) => {
        const currentMod = ((d % 360) + 360) % 360;
        const delta = (((targetMod - currentMod) % 360) + 360) % 360;
        return d + 1800 + delta; // 5 full turns, matching the app
      });
      const params = new URLSearchParams({
        label: result.label,
        secondary: result.secondaryLabel ?? '',
        prizeType: result.prizeType ?? '',
      });
      if (result.couponCode) params.set('code', result.couponCode);
      window.setTimeout(() => router.push(`/spin/result?${params.toString()}`), SPIN_SETTLE_MS);
    } catch (err) {
      if (isFunctionsCode(err, 'resource-exhausted')) {
        toast.error('You have no spins left. Check back after more are added.');
      } else {
        toast.error(WALLET_CF_MSG);
      }
      setSpinning(false);
    }
  }

  const spinLabel = spinning
    ? 'Spinning…'
    : !campaign
      ? 'No active spin'
      : spinsLeft <= 0
        ? 'No spins available'
        : `Spin now · ${spinsLeft} ${spinsLeft === 1 ? 'spin' : 'spins'} left`;

  return (
    <AccountShell title="Rewards">
      {/* ── Spin & Win ─────────────────────────────────────────────── */}
      <section className="mb-8 rounded-2xl border border-border-subtle bg-surface-card p-5 sm:p-7">
        <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-center">
          {/* Wheel */}
          <div className="flex flex-none flex-col items-center gap-5">
            <SpinWheel
              slices={slices}
              deg={deg}
              disabled={spinning || !campaign || spinsLeft <= 0}
              onSpin={() => void spin()}
            />
            <Button
              theme="gold"
              size="l"
              onClick={() => void spin()}
              disabled={spinning || !campaign || spinsLeft <= 0}
              // When there's no spin to take, grey the button out so it clearly
              // reads as unavailable, on top of being non-clickable.
              className={cn(!spinning && (spinsLeft <= 0 || !campaign) && 'opacity-50 grayscale')}
            >
              {spinLabel}
            </Button>
          </div>

          {/* Prizes */}
          <div className="min-w-0 flex-1">
            <h2 className="mb-1.5 font-display text-[22px] font-extrabold leading-tight tracking-[-0.02em] text-text-primary">
              Spin &amp; win rewards
            </h2>
            <p className="mb-4 font-ui text-[14px] leading-relaxed text-text-secondary">
              {spinsLeft > 0
                ? `You have ${spinsLeft} spin${spinsLeft === 1 ? '' : 's'}. Wins drop straight into your coupon wallet below.`
                : 'You have no spins right now — they’re added by the store. Check back soon.'}
            </p>
            {campaigns.loading ? (
              <div className="py-6 text-center font-ui text-sm text-text-tertiary">Loading rewards…</div>
            ) : slices.length === 0 ? (
              <div className="rounded-xl border border-border-subtle bg-surface-app px-6 py-8 text-center font-ui text-sm text-text-tertiary">
                No rewards available right now. Check back soon.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {slices.map((s) => {
                  const isFreeShip = s.prizeType === 'free_shipping';
                  const isMiss = s.prizeType === 'better_luck';
                  return (
                    <div
                      key={s.id}
                      className={cn('rounded-xl border p-3.5 text-center', isFreeShip ? 'border-brand-gold-border bg-brand-gold-subtle' : 'border-border-subtle bg-surface-app')}
                    >
                      <div className={cn('font-display font-extrabold leading-none', isMiss ? 'text-[14px] leading-tight text-text-tertiary' : 'text-lg text-brand-gold-strong')}>
                        {s.displayLabel}
                      </div>
                      <div className={cn('mt-1 font-ui text-[11px] font-medium leading-snug', isFreeShip ? 'text-brand-gold-strong opacity-80' : 'text-text-tertiary')}>
                        {s.secondaryLabel}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Coupon wallet ──────────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 font-display text-[20px] font-extrabold tracking-[-0.02em] text-text-primary">Your coupons</h2>

        {/* Apply a coupon */}
        <div className="mb-5 flex max-w-[640px] gap-3">
          <div className="flex flex-1 items-center gap-2.5 rounded-[10px] border border-dashed border-border-default bg-surface-card px-4 py-3">
            <span className="inline-flex text-brand-primary"><RiGiftLine size={18} /></span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void applyCode(code);
              }}
              placeholder="Enter coupon code"
              className="w-full bg-transparent font-ui text-sm text-text-primary outline-none placeholder:text-text-tertiary"
            />
          </div>
          <Button theme="neutral" outline size="m" onClick={() => void applyCode(code)}>Apply</Button>
        </div>

        {/* Status tabs */}
        <div className="mb-5 flex gap-2">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'rounded-pill px-4 py-1.5 font-ui text-[13px] font-bold transition-colors',
                  active ? 'bg-brand-primary text-white' : 'border border-border-default text-text-secondary hover:bg-surface-app',
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {couponsLoading ? (
          <div className="py-12 text-center font-ui text-sm text-text-tertiary">Loading coupons…</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-border-subtle bg-surface-card px-8 py-12 text-center">
            <p className="font-display text-base font-extrabold text-text-primary">No {tab} coupons</p>
            <p className="mt-2 font-ui text-sm text-text-secondary">
              {tab === 'active' ? 'Spin the wheel above to win coupons for your next order.' : 'Nothing here yet.'}
            </p>
          </div>
        ) : (
          <div className="grid max-w-[840px] gap-3.5 sm:grid-cols-2">
            {filtered.map((c) => (
              <CouponCard key={c.id} coupon={c} onApply={(cp) => void applyCode(cp.code)} />
            ))}
          </div>
        )}
      </section>
    </AccountShell>
  );
}
