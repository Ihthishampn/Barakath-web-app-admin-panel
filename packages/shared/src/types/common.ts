/**
 * Barkath — shared structural types.
 * `Ts` abstracts a Firestore Timestamp so the same interfaces serve both the
 * client SDK (admin/web) and the Admin SDK (functions).
 */

/** Minimal Firestore Timestamp surface (both SDKs satisfy this). */
export interface Ts {
  toDate(): Date;
  toMillis(): number;
  seconds: number;
  nanoseconds: number;
}

/** Every document carries `id` equal to its Firestore doc ID (tech-arch §0.6). */
export interface BaseDoc {
  id: string;
  createdAt: Ts;
  updatedAt: Ts;
}

/** Immutable ledger entries: id + createdAt only, no updatedAt. */
export interface LedgerDoc {
  id: string;
  createdAt: Ts;
}

export interface SoftDeletable {
  deletedAt: Ts | null;
}

export interface ImageRef {
  url: string;
  alt: string;
  order: number;
  isPrimary: boolean;
}

/** Snapshot address stored on orders (frozen at order time). */
export interface AddressSnapshot {
  label: string;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: 'India';
}

/** Cursor-paginated result envelope returned by list CFs (tech-arch §0.9). */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
