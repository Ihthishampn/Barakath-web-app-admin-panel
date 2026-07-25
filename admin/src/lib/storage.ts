import { ref, listAll, deleteObject } from 'firebase/storage';
import { storage } from '@/lib/firebase';

/**
 * Recursively delete everything under a Storage prefix.
 *
 * The Web SDK has no "delete folder", so we list the prefix and delete each
 * object, walking nested folders (e.g. thumbnails) too. Best-effort: swallows
 * errors so cleanup never blocks the caller's primary action, and a prefix with
 * nothing uploaded (e.g. an externally-hosted image) is a no-op.
 *
 * Used when deleting a product / category / banner so their uploaded images
 * don't orphan in Storage.
 */
export async function deleteStorageFolder(path: string): Promise<void> {
  try {
    const dir = ref(storage, path);
    const listing = await listAll(dir);
    await Promise.all(listing.items.map((item) => deleteObject(item).catch(() => undefined)));
    await Promise.all(listing.prefixes.map((sub) => deleteStorageFolder(sub.fullPath)));
  } catch {
    /* nothing under this prefix, or storage unavailable — ignore */
  }
}
