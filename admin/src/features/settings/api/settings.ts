import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import type {
  SettingsAffiliate,
  SettingsAnnouncement,
  SettingsDelivery,
  SettingsPaymentGateway,
  SettingsReturns,
  SettingsSearchSuggestions,
  SettingsSupport,
  SettingsTax,
} from '@barkath/shared';
import { db } from '@/lib/firebase';
import { useLiveDoc } from '@/hooks/firestoreCache';

// ── Live reads ─────────────────────────────────────────────────────
export function useDelivery() {
  return useLiveDoc<SettingsDelivery>('settings/delivery');
}
export function useTax() {
  return useLiveDoc<SettingsTax>('settings/tax');
}
export function usePaymentGateway() {
  return useLiveDoc<SettingsPaymentGateway>('settings/paymentGateway');
}
export function useAffiliate() {
  return useLiveDoc<SettingsAffiliate>('settings/affiliate');
}
export function useSupport() {
  return useLiveDoc<SettingsSupport>('settings/support');
}
export function useAnnouncement() {
  return useLiveDoc<SettingsAnnouncement>('settings/announcement');
}
export function useSearchSuggestions() {
  return useLiveDoc<SettingsSearchSuggestions>('settings/searchSuggestions');
}
export function useReturns() {
  return useLiveDoc<SettingsReturns>('settings/returns');
}

// ── Writes (direct client setDoc merge; rules allow admin write) ────
export async function saveDelivery(v: Omit<SettingsDelivery, 'updatedAt'>): Promise<void> {
  await setDoc(doc(db, 'settings', 'delivery'), { ...v, updatedAt: serverTimestamp() }, { merge: true });
}
export async function saveTax(v: Omit<SettingsTax, 'updatedAt'>): Promise<void> {
  await setDoc(doc(db, 'settings', 'tax'), { ...v, updatedAt: serverTimestamp() }, { merge: true });
}
export async function savePaymentGateway(
  v: Omit<SettingsPaymentGateway, 'updatedAt'>,
): Promise<void> {
  await setDoc(
    doc(db, 'settings', 'paymentGateway'),
    { ...v, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** Support contact details shown on the storefront's Help & support page. */
export async function saveSupport(v: Omit<SettingsSupport, 'updatedAt'>): Promise<void> {
  await setDoc(doc(db, 'settings', 'support'), { ...v, updatedAt: serverTimestamp() }, { merge: true });
}

/** Announcement strip shown at the very top of every storefront page. */
export async function saveAnnouncement(
  v: Omit<SettingsAnnouncement, 'updatedAt' | 'startsAt' | 'endsAt'>,
): Promise<void> {
  await setDoc(
    doc(db, 'settings', 'announcement'),
    { ...v, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** Quick-search chips on the storefront's empty search screen. */
export async function saveSearchSuggestions(terms: string[]): Promise<void> {
  await setDoc(
    doc(db, 'settings', 'searchSuggestions'),
    { id: 'searchSuggestions', terms, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** Return window enforced by the storefront's return request form. */
export async function saveReturns(v: Omit<SettingsReturns, 'updatedAt'>): Promise<void> {
  await setDoc(doc(db, 'settings', 'returns'), { ...v, updatedAt: serverTimestamp() }, { merge: true });
}

/** GSTIN: 2-digit state code, 10-char PAN, entity digit, Z, checksum char. */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function isValidGstin(g: string): boolean {
  return GSTIN_RE.test(g.trim().toUpperCase());
}

/** #RGB or #RRGGBB hex. */
export const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidHex(h: string): boolean {
  return HEX_RE.test(h.trim());
}

// Sensible defaults so an empty (never-created) doc renders a fillable form
// rather than a blank/placeholder screen.
export const DEFAULT_DELIVERY: Omit<SettingsDelivery, 'updatedAt'> = {
  id: 'delivery',
  freeDeliveryOverPaise: 0,
  standardFeePaise: 0,
  codSurchargePaise: 0,
  deliveryDaysMin: 2,
  deliveryDaysMax: 5,
};

export const DEFAULT_TAX: Omit<SettingsTax, 'updatedAt'> = {
  id: 'tax',
  gstRate: 0.18,
  gstEnabled: true,
  gstin: '',
  legalName: '',
  businessCity: '',
  businessCountry: 'India',
  pricesIncludeTax: true,
  hsnCodes: {},
};

export const DEFAULT_GATEWAY: Omit<SettingsPaymentGateway, 'updatedAt'> = {
  id: 'paymentGateway',
  razorpayKeyId: '',
  codEnabled: true,
  codMaxAmountPaise: 0,
  walletEnabled: true,
  onlinePaymentEnabled: true,
};
