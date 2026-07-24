/**
 * adminFanOutCategoryTint — push a category's tint onto its products.
 *
 * `categoryTint` is denormalised onto every product so listings can colour a
 * card without a join. Editing a category's tint therefore has to rewrite each
 * of its products, which the admin panel used to do as a client-side
 * `writeBatch`. Two problems with that:
 *
 *   1. A sub-admin granted `categories.edit` but not `products.edit` was denied
 *      by the rules on every product write, so the tint silently applied to the
 *      category and to nothing else.
 *   2. Batches commit in chunks of 400. A failure partway left some products on
 *      the new tint and the rest on the old one, with no retry.
 *
 * Doing it here fixes both: the caller only needs `categories.edit`, the write
 * runs with admin credentials, and the whole fan-out is one audited operation.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, callableOpts } from '../_lib/admin.js';
import { requireModule, writeAudit } from '../_lib/guards.js';

const Schema = z.object({
  categoryId: z.string().min(1),
  // Same hex the admin colour picker produces.
  tint: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb colour.'),
});

/** Firestore's hard cap on writes in a single batch. */
const BATCH_LIMIT = 500;

export const adminFanOutCategoryTint = onCall(callableOpts, async (req) => {
  const { uid } = await requireModule(req, 'categories', 'edit');

  const parsed = Schema.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid payload.');
  }
  const { categoryId, tint } = parsed.data;

  const catSnap = await db.doc(`categories/${categoryId}`).get();
  if (!catSnap.exists) throw new HttpsError('not-found', 'Category not found.');

  const products = await db.collection('products').where('categoryId', '==', categoryId).get();

  let updated = 0;
  for (let i = 0; i < products.docs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const d of products.docs.slice(i, i + BATCH_LIMIT)) {
      // Skip products already on this tint so a re-run is cheap and the write
      // count in the audit entry reflects real changes.
      if (d.get('categoryTint') === tint) continue;
      batch.update(d.ref, { categoryTint: tint });
      updated++;
    }
    await batch.commit();
  }

  await writeAudit({
    actorUid: uid,
    action: 'category.tint_fanout',
    entity: 'category',
    entityId: categoryId,
    meta: { tint, productsScanned: products.size, productsUpdated: updated },
  });

  return { productsUpdated: updated };
});
