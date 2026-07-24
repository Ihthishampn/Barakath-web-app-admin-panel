import { collection, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  ALL_ACTIONS_FALSE,
  ALL_ACTIONS_TRUE,
  MODULE_KEYS,
  type Admin,
  type AdminRole,
  type ModuleKey,
  type ModulePermissions,
} from '@barkath/shared';
import { db, functions } from '@/lib/firebase';
import { useLiveCollection, useLiveDoc } from '@/hooks/firestoreCache';

export const ADMINS_KEY = 'admins:createdAt-desc';

/** All sub-admins, newest first, real-time. */
export function useAdminsList() {
  return useLiveCollection<Admin>(ADMINS_KEY, () =>
    query(collection(db, 'admins'), orderBy('createdAt', 'desc')),
  );
}

/** One admin doc, real-time (edit screen). */
export function useAdmin(uid: string | null) {
  return useLiveDoc<Admin>(uid ? `admins/${uid}` : null);
}

// ── Human-readable labels ───────────────────────────────────────────
export const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'Super admin',
  sub_admin: 'Sub admin',
};

/** Sidebar-module labels for the permission matrix (matches the prototype). */
export const MODULE_LABELS: Record<ModuleKey, string> = {
  dashboard: 'Dashboard',
  products: 'Products',
  categories: 'Categories',
  inventory: 'Inventory',
  reviews: 'Reviews',
  orders: 'Orders',
  customers: 'Customers',
  payments: 'Payments',
  refunds: 'Refunds',
  spinnerCampaigns: 'Spinner',
  coupons: 'Coupons',
  affiliateProgram: 'Affiliate',
  banner: 'Banner',
  flashSale: 'Flash Sale',
  newArrivals: 'New Arrivals',
  notifications: 'Notifications',
  reportsAnalytics: 'Reports',
  settings: 'Settings',
  subAdmin: 'Sub Admin',
};

/** A fresh, all-off permission map for a new sub-admin. */
export function emptyModulePermissions(): ModulePermissions {
  return MODULE_KEYS.reduce((acc, key) => {
    acc[key] = { ...ALL_ACTIONS_FALSE };
    return acc;
  }, {} as ModulePermissions);
}

/** An all-on permission map (super-admins have every module). */
export function fullModulePermissions(): ModulePermissions {
  return MODULE_KEYS.reduce((acc, key) => {
    acc[key] = { ...ALL_ACTIONS_TRUE };
    return acc;
  }, {} as ModulePermissions);
}

/** True when a module has any action enabled (its toggle is "on"). */
export function isModuleEnabled(perm: ModulePermissions | undefined, key: ModuleKey): boolean {
  const p = perm?.[key];
  return !!p && (p.view || p.create || p.edit || p.delete || p.approve);
}

// ── Privileged mutations (Cloud Functions — set custom auth claims) ──
// The `admins` collection is `write: if false` in rules; every write goes
// through a callable that mints/updates the admin's custom claims server-side.
// The functions are not deployed yet, so calls fail with `not-found` → cfError.

export interface SubAdminInput {
  name: string;
  email: string;
  phone: string | null;
  role: AdminRole;
  modulePermissions: ModulePermissions;
}

export async function createSubAdmin(input: SubAdminInput & { password: string }): Promise<void> {
  const call = httpsCallable(functions, 'createSubAdmin');
  await call(input);
}

export async function updateSubAdmin(uid: string, input: SubAdminInput): Promise<void> {
  const call = httpsCallable(functions, 'updateSubAdmin');
  await call({ uid, ...input });
}

export async function suspendSubAdmin(uid: string, suspend: boolean): Promise<void> {
  const call = httpsCallable(functions, 'suspendSubAdmin');
  await call({ uid, suspend });
}

export async function deleteSubAdmin(uid: string): Promise<void> {
  const call = httpsCallable(functions, 'deleteSubAdmin');
  await call({ uid });
}
