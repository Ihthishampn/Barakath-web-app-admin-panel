import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { Product, Ts } from '@barkath/shared';
import { db, functions } from '@/lib/firebase';
import { useLiveCollection } from '@/hooks/firestoreCache';

export interface StockAdjustment {
  productId: string;
  variantId: string | null;
  delta: number;
}

export interface AdjustmentMeta {
  reason: string;
  reference: string;
  adminUid: string;
  adminName: string;
  /**
   * Random id minted once per visit to the Adjust stock screen. Combined with
   * the payload below it forms the callable's idempotency nonce: pressing Save
   * again after a failed/timed-out save replays the same key (and is ignored by
   * the server if it already committed), while a genuinely new adjustment —
   * different deltas, or the same ones entered on a later visit — gets a new one.
   */
  sessionId: string;
}

export interface StockLogEntry {
  id: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantLabel: string;
  sku: string;
  before: number;
  delta: number;
  after: number;
  reason: string;
  reference: string;
  adminUid: string;
  adminName: string;
  createdAt: Ts | null;
}

interface AdjustStockInput {
  reason: string;
  reference: string | null;
  adjustments: StockAdjustment[];
  nonce: string;
}

/**
 * Thrown when the callable already committed the stock change but the client-side
 * `stockAdjustments` ledger write failed. The stock mutation itself is safe to
 * re-send (the nonce below dedupes it), but the ledger row is a plain client
 * write with no such guard — so the caller clears the steppers rather than
 * inviting a Save that would file the same history entry twice.
 */
export class LedgerWriteError extends Error {
  constructor() {
    super('Stock was adjusted but the history entry could not be written.');
    this.name = 'LedgerWriteError';
  }
}

interface AdjustResult {
  productId: string;
  variantId: string | null;
  before: number;
  after: number;
}

/**
 * Apply per-SKU stock deltas through `adminAdjustStock`. The mutation must be a
 * relative, transactional read-modify-write or a customer order committing at
 * the same moment gets silently clobbered — and only the Cloud Function can
 * enforce inventory.edit and write the audit entry (spec §5.10). The
 * stockAdjustments ledger stays a client write: it is history for this screen,
 * not the source of truth for stock.
 *
 * The before/after values come back from the callable rather than being sampled
 * with our own reads either side of it: that removes two full round trips from
 * a save (this screen was doing four in sequence) and reports the numbers the
 * transaction actually committed.
 *
 * The call carries an idempotency nonce derived from the batch itself, because
 * `+delta` is relative: a call that commits and then loses its response is
 * indistinguishable from one that never ran, and the operator's natural retry
 * would otherwise apply the whole batch twice.
 */
export async function adjustStock(
  products: Product[],
  adjustments: StockAdjustment[],
  meta: AdjustmentMeta,
): Promise<void> {
  const applied = adjustments.filter((a) => a.delta !== 0);
  if (applied.length === 0) return;

  const payload = applied.map((a) => ({ productId: a.productId, variantId: a.variantId, delta: a.delta }));
  // Same batch (session × reason × reference × deltas) ⇒ same nonce ⇒ the server
  // treats a second send as a replay. Change any of it and it's a new batch.
  const nonce = [
    meta.sessionId,
    meta.reason,
    meta.reference,
    ...payload.map((a) => `${a.productId}#${a.variantId ?? ''}:${a.delta}`).sort(),
  ].join('|');

  const call = httpsCallable<AdjustStockInput, { ok: boolean; count: number; results?: AdjustResult[] }>(
    functions,
    'adminAdjustStock',
  );
  const res = await call({
    reason: meta.reason,
    reference: meta.reference || null,
    adjustments: payload,
    nonce,
  });

  const moved = new Map<string, AdjustResult>();
  for (const r of res.data.results ?? []) moved.set(`${r.productId}|${r.variantId ?? ''}`, r);

  const batch = writeBatch(db);
  for (const a of applied) {
    const p = products.find((x) => x.id === a.productId);
    if (!p) continue;
    const key = `${a.productId}|${a.variantId ?? ''}`;
    const v = a.variantId ? p.variants.find((x) => x.id === a.variantId) : null;
    // Fall back to the locally-known stock if an older callable build is still
    // deployed and returns no `results`.
    const known = v ? (v.stock ?? 0) : (p.stock ?? 0);
    const r = moved.get(key);
    addLedger(
      batch,
      p,
      a.variantId,
      v ? v.label || '—' : '—',
      v ? v.sku || `${p.id}-${v.id}` : p.id,
      r ? r.before : known,
      r ? r.after : Math.max(0, known + a.delta),
      // The applied change, not the requested one, so before + delta always
      // equals after in the ledger even if the server ever moves less than asked.
      r ? r.after - r.before : a.delta,
      meta,
    );
  }
  try {
    await batch.commit();
  } catch {
    // Stock is already committed at this point — tell the caller precisely that,
    // so it doesn't report a blanket failure and invite a double-applying retry.
    throw new LedgerWriteError();
  }
}

function addLedger(
  batch: ReturnType<typeof writeBatch>,
  p: Product,
  variantId: string | null,
  variantLabel: string,
  sku: string,
  before: number,
  after: number,
  delta: number,
  meta: AdjustmentMeta,
): void {
  const ref = doc(collection(db, 'stockAdjustments'));
  batch.set(ref, {
    id: ref.id,
    productId: p.id,
    productName: p.name,
    variantId,
    variantLabel,
    sku,
    before,
    delta,
    after,
    reason: meta.reason,
    reference: meta.reference,
    adminUid: meta.adminUid,
    adminName: meta.adminName,
    createdAt: serverTimestamp(),
  });
}

/** Stock-change history for one product (all its SKUs), newest first. */
export async function getStockHistory(productId: string): Promise<StockLogEntry[]> {
  const snap = await getDocs(query(collection(db, 'stockAdjustments'), where('productId', '==', productId)));
  const rows = snap.docs.map((d) => d.data() as StockLogEntry);
  rows.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  return rows;
}

export type StockTone = 'success' | 'gold' | 'error';

export interface SkuRow {
  key: string;
  productId: string;
  productName: string;
  sku: string;
  variantId: string | null;
  variantLabel: string;
  stock: number;
  lowThreshold: number;
  updatedAt: Ts | null;
}

/** All products (every status) for inventory, newest first, real-time. */
export function useInventoryProducts() {
  return useLiveCollection<Product>('products:updatedAt-desc', () =>
    query(collection(db, 'products'), orderBy('updatedAt', 'desc')),
  );
}

/** Flatten products → one row per variant SKU (or one row for non-variant). */
export function buildSkuRows(products: Product[]): SkuRow[] {
  const rows: SkuRow[] = [];
  for (const p of products) {
    if (p.hasVariants && p.variants.length) {
      for (const v of p.variants) {
        rows.push({
          key: `${p.id}_${v.id}`,
          productId: p.id,
          productName: p.name,
          sku: v.sku || `${p.id}-${v.id}`,
          variantId: v.id,
          variantLabel: v.label || '—',
          stock: v.stock ?? 0,
          lowThreshold: p.lowStockThreshold || 5,
          updatedAt: p.updatedAt ?? null,
        });
      }
    } else {
      rows.push({
        key: p.id,
        productId: p.id,
        productName: p.name,
        sku: p.id,
        variantId: null,
        variantLabel: '—',
        stock: p.stock ?? 0,
        lowThreshold: p.lowStockThreshold || 5,
        updatedAt: p.updatedAt ?? null,
      });
    }
  }
  return rows;
}

export function stockStatus(row: SkuRow): { label: string; tone: StockTone } {
  if (row.stock === 0) return { label: 'Out', tone: 'error' };
  if (row.stock <= row.lowThreshold) return { label: 'Low', tone: 'gold' };
  return { label: 'In stock', tone: 'success' };
}

export function stockStats(rows: SkuRow[]) {
  let inStock = 0;
  let low = 0;
  let out = 0;
  for (const r of rows) {
    if (r.stock === 0) out++;
    else if (r.stock <= r.lowThreshold) low++;
    else inStock++;
  }
  return { inStock, low, out, total: rows.length };
}

