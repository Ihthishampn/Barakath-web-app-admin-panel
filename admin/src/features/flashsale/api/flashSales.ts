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
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import type { FlashSale, FlashSaleStatus, Visibility } from '@barkath/shared';
import { db, storage, functions } from '@/lib/firebase';
import { deleteStorageFolder } from '@/lib/storage';
import { useLiveCollection } from '@/hooks/firestoreCache';

export const FLASH_SALES_KEY = 'flashSales:starts-desc';

/** All flash sales, newest window first, real-time. */
export function useFlashSalesList() {
  return useLiveCollection<FlashSale>(FLASH_SALES_KEY, () =>
    query(collection(db, 'flashSales'), orderBy('startsAt', 'desc')),
  );
}

export type FlashSaleBadgeTone = 'success' | 'info' | 'neutral' | 'error';

/** List/detail status pill. Status is kept fresh by the `flashSaleStatusFlip`
 *  sweep (every 15 min); this just maps the stored value to a tone. */
export function deriveFlashSaleBadge(s: FlashSaleStatus): { label: string; tone: FlashSaleBadgeTone } {
  switch (s) {
    case 'active':
      return { label: 'Active', tone: 'success' };
    case 'scheduled':
      return { label: 'Scheduled', tone: 'info' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'error' };
    default:
      return { label: 'Ended', tone: 'neutral' };
  }
}

/** Reserve a Firestore doc id for a new sale (so its image can upload pre-save). */
export function newFlashSaleId(): string {
  return doc(collection(db, 'flashSales')).id;
}

export async function getFlashSale(id: string): Promise<FlashSale | null> {
  const snap = await getDoc(doc(db, 'flashSales', id));
  return snap.exists() ? (snap.data() as FlashSale) : null;
}

export async function deleteFlashSale(id: string): Promise<void> {
  await deleteDoc(doc(db, 'flashSales', id));
  await deleteStorageFolder(`flashSales/${id}`);
}

export interface FlashSaleFormValues {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  bannerImageUrl: string | null;
  productIds: string[];
  /** The sale's product list as loaded from the server, before this edit's
   *  changes — lets `saveFlashSale` tell "removed from this sale" apart from
   *  "never was in it". Empty for a new sale. */
  previousProductIds: string[];
  visibility: Visibility;
  /** Set only by the "Cancel this sale" action; every other save recomputes
   *  scheduled/active/ended from the dates so the panel never has to wait for
   *  the next sweep to reflect a date change the admin just made. */
  cancelled: boolean;
}

/** scheduled / active / ended from the window alone — mirrors the server sweep
 *  (`flashSaleStatusFlip`) so a save reflects instantly, not after the next run. */
function computeStatus(startsAt: Date, endsAt: Date): FlashSaleStatus {
  const now = Date.now();
  if (now < startsAt.getTime()) return 'scheduled';
  if (now <= endsAt.getTime()) return 'active';
  return 'ended';
}

/**
 * Create or update a flash sale. Admin is a rules-gated writer
 * (`canWrite('flashSale')`), so this is a direct client write — no Cloud
 * Function, same as banners/categories/coupons.
 */
export async function saveFlashSale(values: FlashSaleFormValues, isNew: boolean): Promise<string> {
  const status: FlashSaleStatus = values.cancelled
    ? 'cancelled'
    : computeStatus(values.startsAt, values.endsAt);

  const base: Record<string, unknown> = {
    name: values.name.trim(),
    status,
    startsAt: Timestamp.fromDate(values.startsAt),
    endsAt: Timestamp.fromDate(values.endsAt),
    bannerImageUrl: values.bannerImageUrl,
    productIds: values.productIds,
    visibility: values.visibility,
    updatedAt: serverTimestamp(),
  };

  if (isNew) {
    await setDoc(doc(db, 'flashSales', values.id), {
      id: values.id,
      overrides: {},
      createdBy: 'admin',
      ...base,
      createdAt: serverTimestamp(),
    });
  } else {
    await updateDoc(doc(db, 'flashSales', values.id), base);
  }

  await syncProductFlashFlags(values.id, values.productIds, values.previousProductIds);
  return values.id;
}

/**
 * Keep each product's own `isFlashSale` flag in step with campaign membership,
 * via the `adminSyncFlashSaleProducts` callable — NOT a direct client write.
 * `products` writes need `canWrite('products')` in the rules, so a sub-admin
 * granted only `flashSale.edit` would have a direct batch write denied here
 * (exactly the bug `adminFanOutCategoryTint` exists to avoid for categories).
 * The callable runs with admin credentials instead.
 *
 * Two independent things both call themselves "flash sale" — the per-product
 * toggle on the product form (a standalone opt-in the storefront falls back to
 * when no campaign is configured) and this campaign's `productIds`. Without
 * this, a product added ONLY here would show in the campaign's countdown rail
 * on web (which reads `productIds` directly) but never in the app (which has
 * no notion of campaigns and reads `isFlashSale` alone) — and worse, it could
 * still show up in New Arrivals, since that exclusion is also keyed on
 * `isFlashSale`, breaking the "never both" rule the storefront relies on.
 *
 * Scope is deliberately narrow: newly-added products are flagged true; a
 * product REMOVED from the list in this same edit is flagged false. A sale
 * that simply runs its course (ends/cancelled) does NOT auto-clear the flag —
 * that would risk silently switching off a flag an admin set independently of
 * any campaign. Turning it off after a sale ends is a deliberate follow-up
 * action (the per-product toggle, or removing it here before saving).
 */
async function syncProductFlashFlags(
  saleId: string,
  productIds: string[],
  previousProductIds: string[],
): Promise<void> {
  const added = productIds.filter((id) => !previousProductIds.includes(id));
  const removed = previousProductIds.filter((id) => !productIds.includes(id));
  if (added.length === 0 && removed.length === 0) return;

  await httpsCallable(functions, 'adminSyncFlashSaleProducts')({ saleId, added, removed });
}

/** Upload a flash-sale banner image to Storage under `flashSales/{id}/…`. */
export async function uploadFlashSaleImage(saleId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'png';
  const path = `flashSales/${saleId}/image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: file.type || 'image/png' });
  return getDownloadURL(r);
}
