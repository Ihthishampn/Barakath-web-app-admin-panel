import { useMemo } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  rupeesToPaise,
  type CouponTarget,
  type SpinCampaign,
  type SpinCampaignStatus,
  type SpinPrizeType,
  type SpinSlice,
} from '@barkath/shared';
import { db } from '@/lib/firebase';
import { useLiveCollection, useLiveDoc } from '@/hooks/firestoreCache';

export const SPIN_CAMPAIGNS_KEY = 'spinCampaigns:createdAt-desc';

/**
 * Effective campaign status, computed on read (same approach as coupon expiry).
 *
 * Nothing ever flips a campaign out of `active` when its window closes — there
 * is no spin-campaign sweep — so a finished campaign kept advertising itself as
 * running while `executeSpin` rejected every spin. Deriving the status at read
 * time keeps the admin (and anything built on these readers) honest without a
 * write.
 */
export function effectiveSpinStatus(c: SpinCampaign): SpinCampaignStatus {
  if (c.status !== 'active') return c.status;
  if (c.endsAt && c.endsAt.toMillis() < Date.now()) return 'ended';
  return 'active';
}

function withEffectiveStatus(c: SpinCampaign): SpinCampaign {
  const status = effectiveSpinStatus(c);
  return status === c.status ? c : { ...c, status };
}

/** All spin campaigns for the admin list, newest first, real-time. */
export function useSpinCampaignsList() {
  const state = useLiveCollection<SpinCampaign>(SPIN_CAMPAIGNS_KEY, () =>
    query(collection(db, 'spinCampaigns'), orderBy('createdAt', 'desc')),
  );
  return useMemo(
    () => ({ ...state, data: state.data.map(withEffectiveStatus) }),
    [state],
  );
}

/** Single campaign, real-time (seeds instantly from the list cache on remount). */
export function useSpinCampaign(id: string | null) {
  const state = useLiveDoc<SpinCampaign>(id ? `spinCampaigns/${id}` : null);
  return useMemo(
    () => ({ ...state, data: state.data ? withEffectiveStatus(state.data) : null }),
    [state],
  );
}

export async function getSpinCampaign(id: string): Promise<SpinCampaign | null> {
  const snap = await getDoc(doc(db, 'spinCampaigns', id));
  return snap.exists() ? withEffectiveStatus(snap.data() as SpinCampaign) : null;
}

/** Reserve a Firestore doc id so create → detail navigation is deterministic. */
export function newSpinCampaignId(): string {
  return doc(collection(db, 'spinCampaigns')).id;
}

// ── Prize-type ↔ prototype toggle (₹ / % / ==) ─────────────────────
export type SliceKind = 'amount' | 'percent' | 'special';

/** Map a stored prizeType to the three-way toggle the prototype shows. */
export function kindOf(prizeType: SpinPrizeType): SliceKind {
  if (prizeType === 'percent_discount') return 'percent';
  if (prizeType === 'free_shipping' || prizeType === 'better_luck') return 'special';
  return 'amount'; // flat_discount | cashback
}

/** Default prizeType when the user flips to a toggle (keeps existing where it fits). */
export function prizeTypeFor(kind: SliceKind, prev: SpinPrizeType): SpinPrizeType {
  if (kind === 'percent') return 'percent_discount';
  // The `==` toggle covers BOTH special prize types. It used to fall back to
  // free_shipping, so a slice the admin typed as "Better luck next time" was
  // stored as a real free-delivery prize (executeSpin mints a coupon for it and
  // checkout waives delivery), and an existing better_luck row was converted the
  // moment the toggle was touched. Default to the non-issuing outcome and only
  // keep free_shipping on a slice that already is one.
  if (kind === 'special') return prev === 'free_shipping' ? 'free_shipping' : 'better_luck';
  return prev === 'cashback' ? 'cashback' : 'flat_discount';
}

// ── List status badge (derived like products) ──────────────────────
export type SpinBadgeTone = 'success' | 'gold' | 'neutral';

export function deriveSpinStatus(c: SpinCampaign): { label: string; tone: SpinBadgeTone } {
  const status = effectiveSpinStatus(c); // window-aware, so an ended campaign reads Ended
  if (status === 'ended') return { label: 'Ended', tone: 'neutral' };
  if (status === 'paused') return { label: 'Paused', tone: 'gold' };
  if (status === 'draft') return { label: 'Draft', tone: 'neutral' };
  // active — but a campaign whose window hasn't opened yet is only Scheduled
  if (c.startsAt && c.startsAt.toMillis() > Date.now()) return { label: 'Scheduled', tone: 'neutral' };
  return { label: 'Active', tone: 'success' };
}

/** Conversion = coupons issued ÷ total spins, as an integer percent (or null). */
export function conversionPct(c: SpinCampaign): number | null {
  if (!c.totalSpins) return null;
  return Math.round((c.totalCouponsIssued / c.totalSpins) * 100);
}

// ── Form value shapes ──────────────────────────────────────────────
export interface CampaignBasics {
  name: string;
  startDate: string; // yyyy-mm-dd
  endDate: string; // yyyy-mm-dd
  eligibility: CouponTarget;
  /** Max spins per customer per day. */
  spinsPerDay: number;
  activateImmediately: boolean;
}

/**
 * A default starter wheel so a freshly-created campaign is already configurable.
 *
 * Every starter slice is `better_luck` on purpose. "Activate immediately"
 * defaults to on and `startsAt` is today, so the campaign is live to customers
 * the instant it is created — before the admin has even reached the wheel
 * editor the success toast sends them to. A starter wheel carrying real prizes
 * therefore gave away ₹10-off and (uncapped) 10%-off coupons the admin never
 * chose; a wheel that can only lose costs nothing until it is configured.
 */
function starterSlices(): SpinSlice[] {
  const base = { prizeType: 'better_luck' as const, discountValuePaise: null, discountPercent: null, discountMaxCapPaise: null, minCartValuePaise: 0, couponTemplateCode: null, validityDays: 7, secondaryLabel: '', usedCount: 0 };
  return [
    { id: sliceId(), order: 0, weight: 50, displayLabel: 'Better luck next time', ...base },
    { id: sliceId(), order: 1, weight: 50, displayLabel: 'Try again tomorrow', ...base },
  ];
}

/**
 * Campaign-level reward validity the app prints under the wheel ("Rewards
 * become coupons · valid N days"). It has no editor and was frozen at the 7
 * written on create, while the value that actually governs expiry is the
 * per-slice `validityDays` the admin does edit — so the banner promised 7 days
 * on coupons that expired in 3. Derive it from the slices, taking the SHORTEST
 * coupon validity so the customer-facing promise is never longer than the
 * coupon lives.
 */
function rewardExpiryDays(slices: SpinSlice[]): number {
  const days = slices
    .filter((s) => s.prizeType !== 'better_luck' && s.prizeType !== 'cashback')
    .map((s) => Number(s.validityDays ?? 0))
    .filter((d) => d > 0);
  return days.length > 0 ? Math.min(...days) : 7;
}

export function sliceId(): string {
  return `s_${Math.random().toString(36).slice(2, 9)}`;
}

/** Create a draft (or active) campaign, then the caller opens the detail editor. */
export async function createCampaign(id: string, v: CampaignBasics): Promise<string> {
  const status: SpinCampaignStatus = v.activateImmediately ? 'active' : 'draft';
  const slices = starterSlices();
  await setDoc(doc(db, 'spinCampaigns', id), {
    id,
    name: v.name.trim(),
    status,
    startsAt: Timestamp.fromDate(new Date(`${v.startDate}T00:00:00`)),
    endsAt: Timestamp.fromDate(new Date(`${v.endDate}T23:59:59`)),
    slices,
    cooldownHours: 24,
    spinsPerDay: Math.max(1, Math.floor(v.spinsPerDay || 1)),
    rewardCouponExpiryDays: rewardExpiryDays(slices),
    eligibility: v.eligibility,
    totalSpins: 0,
    totalCouponsIssued: 0,
    totalCashbackPaidPaise: 0,
    createdBy: 'admin',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return id;
}

/** Persist the wheel editor: slices (re-ordered) + settings. */
export async function saveCampaign(
  id: string,
  patch: { name: string; slices: SpinSlice[]; eligibility: CouponTarget; startsAt: Timestamp; endsAt: Timestamp; spinsPerDay: number },
): Promise<void> {
  // Defensive defaults: Firestore rejects `undefined`, so a campaign that is
  // missing a field (e.g. legacy/seed data without `eligibility`) would fail to
  // save. Coalesce every field to a valid value.
  const slices = patch.slices.map((s, i) => ({ ...s, order: i }));
  await updateDoc(doc(db, 'spinCampaigns', id), {
    name: (patch.name ?? '').trim(),
    slices,
    // Kept in step with the slices the admin just saved — the app renders it as
    // the reward validity and nothing else ever writes it.
    rewardCouponExpiryDays: rewardExpiryDays(slices),
    eligibility: patch.eligibility ?? 'all',
    spinsPerDay: Math.max(1, Math.floor(patch.spinsPerDay || 1)),
    startsAt: patch.startsAt ?? Timestamp.now(),
    endsAt: patch.endsAt ?? Timestamp.now(),
    updatedAt: serverTimestamp(),
  });
}

export async function setCampaignStatus(id: string, status: SpinCampaignStatus): Promise<void> {
  await updateDoc(doc(db, 'spinCampaigns', id), { status, updatedAt: serverTimestamp() });
}

export async function deleteCampaign(id: string): Promise<void> {
  await deleteDoc(doc(db, 'spinCampaigns', id));
}

// ── Small conversion helpers used by the editor ────────────────────
export const paiseFromRupees = (r: number | ''): number => (r === '' ? 0 : rupeesToPaise(Number(r)));
export const isoDate = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
