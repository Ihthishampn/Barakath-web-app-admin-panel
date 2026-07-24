/**
 * adminAdjustStock — atomic per-SKU stock adjustment (spec §5.10).
 * Runs in a transaction, enforces the inventory.edit permission, and writes an
 * audit-log entry. Replaces the admin's direct client write.
 */
import { createHmac } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, FieldValue, callableOpts } from '../_lib/admin.js';
import { requireModule, writeAudit } from '../_lib/guards.js';

const Schema = z.object({
  reason: z.string().min(1),
  reference: z.string().optional().nullable(),
  adjustments: z
    .array(
      z.object({
        productId: z.string().min(1),
        variantId: z.string().nullable(),
        delta: z.number().int(),
      }),
    )
    .min(1),
  /**
   * Idempotency nonce for this batch. Stock moves relatively (+delta), so a call
   * that committed but whose response was lost must not be re-applied when the
   * operator presses Save again — the client sends the same nonce and gets the
   * original result back instead of a second delta. Optional so an older admin
   * build keeps working (unguarded, as before).
   */
  nonce: z.string().min(1).max(20000).optional(),
});

/** Same construction as the checkout idempotency key — a short, safe doc id. */
function hashKey(s: string): string {
  return createHmac('sha256', 'barakath-idempotency').update(s).digest('hex').slice(0, 32);
}

interface AdjustResult {
  productId: string;
  variantId: string | null;
  before: number;
  after: number;
}

export const adminAdjustStock = onCall(callableOpts, async (req) => {
  const { uid } = await requireModule(req, 'inventory', 'edit');

  const parsed = Schema.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid adjustment payload.');
  }
  const { reason, reference, adjustments, nonce } = parsed.data;
  // Scoped per admin so nonces can never collide across accounts.
  const idemRef = nonce ? db.doc(`stockAdjustmentBatches/${uid}__${hashKey(nonce)}`) : null;

  // Group non-zero deltas by product.
  const byProduct = new Map<string, { variantId: string | null; delta: number }[]>();
  for (const a of adjustments) {
    if (a.delta === 0) continue;
    const list = byProduct.get(a.productId) ?? [];
    list.push({ variantId: a.variantId, delta: a.delta });
    byProduct.set(a.productId, list);
  }
  if (byProduct.size === 0) {
    throw new HttpsError('failed-precondition', 'No non-zero adjustments.');
  }

  /**
   * Per-SKU before/after, captured inside the transaction. The admin used to
   * sample stock with its own reads either side of this call — three extra
   * round trips, and values a concurrent order could skew. Returning what the
   * transaction actually saw is both faster and the only accurate answer.
   */
  let results: AdjustResult[] = [];
  /** True when this call is a replay of a batch that already committed. */
  let replayed = false;

  await db.runTransaction(async (tx) => {
    results = []; // a retried transaction must not append twice
    replayed = false;
    // SKUs the transaction could not resolve (product deleted, or variant removed
    // by a concurrent edit). These used to be skipped in silence while the call
    // still reported ok — the admin screen then wrote a stockAdjustments history
    // row from its stale local copy for a change that never happened. The whole
    // batch is rejected instead, matching the screen's "adjustments apply
    // together" promise.
    const skipped: string[] = [];
    // SKUs whose requested delta would take stock below zero. The old code
    // silently clamped to 0 and still reported success, so the ledger row the
    // admin wrote (before + the REQUESTED delta) no longer added up and part of
    // the adjustment vanished unannounced. Reject the batch instead — same
    // all-or-nothing contract as `skipped` above.
    const underflow: string[] = [];
    const entries = [...byProduct.entries()];
    // The replay check must be read before anything is written.
    const [idemSnap, snaps] = await Promise.all([
      idemRef ? tx.get(idemRef) : Promise.resolve(null),
      Promise.all(entries.map(([pid]) => tx.get(db.doc(`products/${pid}`)))),
    ]);
    if (idemSnap?.exists) {
      // This exact batch already committed — hand back what it did rather than
      // applying the relative deltas a second time.
      results = ((idemSnap.data()?.results ?? []) as AdjustResult[]);
      replayed = true;
      return;
    }
    entries.forEach(([pid, list], i) => {
      const snap = snaps[i]!;
      if (!snap.exists) {
        list.forEach((x) => skipped.push(x.variantId ? `${pid}/${x.variantId}` : pid));
        return;
      }
      const p = snap.data() as {
        stock?: number;
        hasVariants?: boolean;
        variants?: { id: string; stock?: number }[];
      };
      const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

      const baseDelta = list.find((x) => x.variantId === null)?.delta;
      if (baseDelta != null) {
        const before = p.stock ?? 0;
        const after = Math.max(0, before + baseDelta);
        if (before + baseDelta < 0) underflow.push(`${pid} (${before} in stock)`);
        update.stock = after;
        results.push({ productId: pid, variantId: null, before, after });
      }

      const variants = Array.isArray(p.variants) ? p.variants : [];
      if (p.hasVariants && variants.length > 0) {
        update.variants = variants.map((v) => {
          const d = list.find((x) => x.variantId === v.id);
          if (!d) return v;
          const before = v.stock ?? 0;
          const after = Math.max(0, before + d.delta);
          if (before + d.delta < 0) underflow.push(`${pid}/${v.id} (${before} in stock)`);
          results.push({ productId: pid, variantId: v.id, before, after });
          return { ...v, stock: after };
        });
      }

      // Every requested variant delta that matched nothing on the product.
      for (const x of list) {
        if (x.variantId === null) continue;
        if (p.hasVariants && variants.some((v) => v.id === x.variantId)) continue;
        skipped.push(`${pid}/${x.variantId}`);
      }

      tx.update(db.doc(`products/${pid}`), update);
    });

    if (skipped.length > 0) {
      throw new HttpsError(
        'not-found',
        `${skipped.length} SKU${skipped.length === 1 ? '' : 's'} no longer exist (${skipped.join(', ')}). Nothing was adjusted — reload the page and try again.`,
      );
    }
    if (underflow.length > 0) {
      throw new HttpsError(
        'failed-precondition',
        `${underflow.length} SKU${underflow.length === 1 ? '' : 's'} would drop below zero (${underflow.join(', ')}). Nothing was adjusted — reload the page and try again.`,
      );
    }

    // Written in the same transaction as the stock, so the record of "this batch
    // ran" can never exist without the stock change (or the other way round).
    if (idemRef) {
      tx.set(idemRef, { adminUid: uid, reason, results, createdAt: FieldValue.serverTimestamp() });
    }
  });

  // A replay committed nothing this time — auditing it again would invent a
  // second adjustment that never happened.
  if (replayed) return { ok: true, count: results.length, results, replayed };

  await writeAudit({
    actorUid: uid,
    action: 'inventory.adjusted',
    entity: 'products',
    entityId: 'batch',
    meta: { reason, reference: reference ?? null, skuCount: adjustments.length },
  });

  // `count` is what was APPLIED (every requested SKU, or the call threw above),
  // not what was requested.
  return { ok: true, count: results.length, results, replayed };
});
