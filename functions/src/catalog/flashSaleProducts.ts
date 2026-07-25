/**
 * adminSyncFlashSaleProducts — stamp/clear each product's own `isFlashSale`
 * flag to match a flash-sale campaign's product list.
 *
 * Two independent things both mean "flash sale": the per-product toggle on
 * the product form (a standalone opt-in the storefront falls back to when no
 * campaign is running) and a campaign's `productIds` here. Without keeping
 * them in sync, a product added only to a campaign would show in web's
 * countdown rail (which reads `productIds` directly) but never in the app
 * (which has no notion of campaigns and reads `isFlashSale` alone), and could
 * still slip into New Arrivals, since that exclusion is also keyed on
 * `isFlashSale` — breaking the "never both" rule the storefront relies on.
 *
 * This mirrors `adminFanOutCategoryTint` exactly, for the same reason: the
 * admin panel used to do this as a client-side `writeBatch` against
 * `products/{id}`, but that collection's rule is `canWrite('products')` — a
 * sub-admin granted `flashSale.edit` but not `products.edit` would have every
 * one of those writes denied, so adding a product to a campaign would
 * silently fail to flag it. Running with admin credentials fixes that; each
 * product is written individually (not one atomic batch) so a single stale or
 * deleted id can't sink every other update in the same save.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';
import { db, callableOpts } from '../_lib/admin.js';
import { requireModule, writeAudit } from '../_lib/guards.js';

const Schema = z.object({
  saleId: z.string().min(1),
  added: z.array(z.string().min(1)).max(500),
  removed: z.array(z.string().min(1)).max(500),
});

export const adminSyncFlashSaleProducts = onCall(callableOpts, async (req) => {
  const { uid } = await requireModule(req, 'flashSale', 'edit');
  const parsed = Schema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');
  const { saleId, added, removed } = parsed.data;
  if (added.length === 0 && removed.length === 0) return { updated: 0 };

  const jobs = [
    ...added.map((id) => ({ id, isFlashSale: true })),
    ...removed.map((id) => ({ id, isFlashSale: false })),
  ];
  const results = await Promise.allSettled(
    jobs.map((j) => db.doc(`products/${j.id}`).update({ isFlashSale: j.isFlashSale })),
  );
  let updated = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') updated++;
    else logger.error(`adminSyncFlashSaleProducts: could not update product ${jobs[i]!.id}`, r.reason);
  });

  await writeAudit({
    actorUid: uid,
    action: 'flashSale.products_synced',
    entity: 'flashSales',
    entityId: saleId,
    meta: { added: added.length, removed: removed.length, updated },
  });

  return { updated };
});
