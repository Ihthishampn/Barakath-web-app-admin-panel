import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import type { Category, SubCategory, Visibility } from '@barkath/shared';
import { db, functions, storage } from '@/lib/firebase';
import { deleteStorageFolder } from '@/lib/storage';
import { useLiveCollection } from '@/hooks/firestoreCache';

export const CATEGORIES_KEY = 'categories:order-asc';

/** All categories, ordered for nav/pickers, real-time. */
export function useCategories() {
  return useLiveCollection<Category>(CATEGORIES_KEY, () =>
    query(collection(db, 'categories'), orderBy('order', 'asc')),
  );
}

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function getCategory(id: string): Promise<Category | null> {
  const snap = await getDoc(doc(db, 'categories', id));
  return snap.exists() ? (snap.data() as Category) : null;
}

/** Count published products in a category (for delete-safety + display). */
export async function countCategoryProducts(categoryId: string): Promise<number> {
  const snap = await getCountFromServer(
    query(collection(db, 'products'), where('categoryId', '==', categoryId)),
  );
  return snap.data().count;
}

/** Count products attached to one sub-category (delete-safety, mirrors the category guard). */
export async function countSubCategoryProducts(categoryId: string, subCategoryId: string): Promise<number> {
  const snap = await getCountFromServer(
    query(
      collection(db, 'products'),
      where('categoryId', '==', categoryId),
      where('subCategoryId', '==', subCategoryId),
    ),
  );
  return snap.data().count;
}

export interface CategoryFormValues {
  id: string;
  name: string;
  description: string;
  categoryTint: string;
  categoryTagColor: Category['categoryTagColor'];
  iconUrl: string | null;
  visibility: Visibility;
  subCategories: SubCategory[];
  order: number;
}

export async function saveCategory(values: CategoryFormValues, isNew: boolean): Promise<string> {
  const slug = isNew ? slugify(values.name) : values.id;
  const base = {
    slug,
    name: values.name,
    displayName: values.name,
    description: values.description,
    categoryTint: values.categoryTint,
    categoryTagColor: values.categoryTagColor,
    iconUrl: values.iconUrl,
    visibility: values.visibility,
    subCategories: values.subCategories,
    seoTitle: values.name,
    seoDescription: values.name,
    // Written on EVERY save, not only on create. The nav query is
    // orderBy('order','asc') and nothing else ever touched the field, so the
    // category menu was permanently frozen in creation order on both
    // storefronts. Normalised here so a blank or half-typed input can't store a
    // NaN, which sorts unpredictably.
    order: Number.isFinite(values.order) ? Math.max(0, Math.round(values.order)) : 0,
    updatedAt: serverTimestamp(),
  };
  if (isNew) {
    await setDoc(doc(db, 'categories', slug), {
      id: slug,
      ...base,
      heroImageUrl: null,
      productCount: 0,
      createdAt: serverTimestamp(),
    });
    return slug;
  }
  await updateDoc(doc(db, 'categories', values.id), base);
  return values.id;
}

export async function deleteCategory(id: string): Promise<void> {
  await deleteDoc(doc(db, 'categories', id));
  await deleteStorageFolder(`categories/${id}`);
}

/**
 * Fan the new tint out to this category's products (categoryTint is denormalized
 * on each product).
 *
 * Server-side: this was a client `writeBatch`, which a sub-admin holding
 * `categories.edit` but not `products.edit` was denied on every product — the
 * category changed colour and its products did not. It also committed in
 * chunks, so a mid-way failure left the two tints mixed. The callable needs
 * only `categories.edit`, writes with admin credentials, and audits the result.
 */
export async function fanOutCategoryTint(categoryId: string, tint: string): Promise<void> {
  const call = httpsCallable<{ categoryId: string; tint: string }, { productsUpdated: number }>(
    functions,
    'adminFanOutCategoryTint',
  );
  await call({ categoryId, tint });
}

export async function setCategoryVisibility(id: string, visibility: Visibility): Promise<void> {
  await updateDoc(doc(db, 'categories', id), { visibility, updatedAt: serverTimestamp() });
}

/** Replace the embedded subCategories array (add/remove/toggle from the sub screen). */
export async function updateSubCategories(id: string, subCategories: SubCategory[]): Promise<void> {
  await updateDoc(doc(db, 'categories', id), { subCategories, updatedAt: serverTimestamp() });
}

export async function uploadCategoryImage(id: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'png';
  const r = ref(storage, `categories/${id}/image-${Date.now()}.${ext}`);
  await uploadBytes(r, file);
  return getDownloadURL(r);
}
