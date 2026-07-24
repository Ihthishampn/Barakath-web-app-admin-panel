import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { BANNER_PLACEMENTS, type Banner, type BannerPlacement } from '@barkath/shared';
import { db, storage } from '@/lib/firebase';
import { deleteStorageFolder } from '@/lib/storage';
import { useLiveCollection } from '@/hooks/firestoreCache';

export const BANNERS_KEY = 'banners:order-asc';

/** Placement the app queries for. Also the only value this form can produce. */
export const APP_PLACEMENT: BannerPlacement = BANNER_PLACEMENTS[0]; // 'app'

/**
 * KNOWN GAP — the banner form has no placement control, so every banner saved
 * here is `placement: 'app'` and the web hero (which queries
 * placement=='website') can only ever show the seeded banner. The fix is a
 * placement Select on BannerFormPage bound to BANNER_PLACEMENTS, which is a UI
 * change and therefore deferred. Do NOT work around it by writing companion
 * docs: a banner is one row, and the two surfaces need different artwork
 * aspects (app 16:9, web 3:1), so one image cannot serve both anyway.
 */

/** All banners, ordered by their manual `order` (ascending), real-time. */
export function useBannersList() {
  return useLiveCollection<Banner>(BANNERS_KEY, () =>
    query(collection(db, 'banners'), orderBy('order', 'asc')),
  );
}

export type BannerBadgeTone = 'success' | 'neutral';

/** Derive the list status pill from `publishLive` (prototype: Live / Draft). */
export function deriveBannerStatus(b: Banner): { label: string; tone: BannerBadgeTone } {
  return b.publishLive ? { label: 'Live', tone: 'success' } : { label: 'Draft', tone: 'neutral' };
}

/** Reserve a Firestore doc id for a new banner (so its image can upload pre-save). */
export function newBannerId(): string {
  return doc(collection(db, 'banners')).id;
}

export async function getBanner(id: string): Promise<Banner | null> {
  const snap = await getDoc(doc(db, 'banners', id));
  return snap.exists() ? (snap.data() as Banner) : null;
}

export async function deleteBanner(id: string): Promise<void> {
  await deleteDoc(doc(db, 'banners', id));
  await deleteStorageFolder(`banners/${id}`);
}

/** Toggle publish state (used by the list cards + form). */
export async function setBannerPublished(id: string, publishLive: boolean): Promise<void> {
  await updateDoc(doc(db, 'banners', id), {
    publishLive,
    updatedAt: serverTimestamp(),
  });
}

export interface BannerFormValues {
  id: string;
  title: string;
  imageUrl: string;
  attachedProductId: string | null;
  publishLive: boolean;
  placement: BannerPlacement;
  /**
   * Carousel position — lowest first, matching the list's and both storefronts'
   * orderBy('order','asc'). `null` means "leave it alone": a new banner is
   * appended to the end, an existing one keeps the position it already had.
   */
  order: number | null;
}

/**
 * The order value that appends a new banner to the end of the carousel.
 * `Date.now()` is monotonic, so a fresh banner always sorts after every
 * previously-created one without reading the collection first.
 */
export const appendOrder = (): number => Date.now();

/**
 * Create or update a banner. Admin is a rules-gated writer, so this is a direct
 * client write — no Cloud Function (banners are allowed for admins in rules).
 *
 * `order` is written on EVERY save now, not only on create. It used to be
 * stamped once with Date.now() and never touched again, so the hero carousel
 * was permanently locked into creation order with no way to reorder it.
 */
export async function saveBanner(values: BannerFormValues, isNew: boolean): Promise<string> {
  const base: Record<string, unknown> = {
    title: values.title.trim(),
    imageUrl: values.imageUrl,
    attachedProductId: values.attachedProductId,
    publishLive: values.publishLive,
    placement: values.placement,
    updatedAt: serverTimestamp(),
  };
  // A NaN here would sort unpredictably against every other banner, so an
  // unusable value is dropped rather than stored.
  if (values.order != null && Number.isFinite(values.order)) {
    base.order = Math.max(0, Math.round(values.order));
  }

  if (isNew) {
    await setDoc(doc(db, 'banners', values.id), {
      id: values.id,
      order: appendOrder(),
      ...base,
      createdAt: serverTimestamp(),
    });
  } else {
    await updateDoc(doc(db, 'banners', values.id), base);
  }
  return values.id;
}

/** Upload a banner image to Storage under `banners/{id}/…` and return its URL. */
export async function uploadBannerImage(bannerId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'png';
  const path = `banners/${bannerId}/image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: file.type || 'image/png' });
  return getDownloadURL(r);
}
