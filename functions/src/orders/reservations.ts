/**
 * Checkout stock reservations.
 *
 *   reserveStock  — takes the stock OUT of the catalogue the moment the customer
 *                   enters checkout and parks it on a `stockReservations` doc
 *                   that expires 15 minutes later.
 *   releaseStock  — gives it back (customer left checkout / cancelled payment).
 *
 * Why hold stock at all: between "review your bag" and "payment captured" the
 * customer spends a minute or two inside a gateway sheet. Without a hold, the
 * last unit can be sold from under them and placeOrder fails *after* they paid
 * attention (or worse, after a Razorpay sheet opened). Reserving up front turns
 * that into an honest "out of stock" before any money moves.
 *
 * The safety nets are what make this safe to hold real stock:
 *   · re-entering checkout releases the caller's previous reservation first, so
 *     stock can never leak by opening checkout twice (see reserveStock);
 *   · `stockReservationSweep` (scheduled/sweeps.ts) restores anything the client
 *     never released — app killed, network lost, phone died;
 *   · placeOrder consumes the reservation instead of decrementing again — and
 *     returns whatever the hold covered but the order did not buy, because
 *     consuming it puts the reservation beyond both nets above (they only ever
 *     touch an 'active' one).
 *
 * Stock is maintained exactly the way placeOrder does it, and — critically — the
 * way every other surface READS it: a line that names a variant resolves
 * `variants[].stock` and moves only that row, while a variant-less line resolves
 * the top-level `products.stock`. The top-level counter is NOT an aggregate over
 * the variants (the admin product form clears it to 0 the moment a product gains
 * variants, adminAdjustStock treats the base SKU as its own row, and
 * web/app/admin availability all branch on `hasVariants`), so applying variant
 * quantities to it only drives it negative. A cart can hold two variants of the
 * SAME product, so every path here groups lines by productId and writes each
 * product document once — two writes built from one pre-transaction snapshot
 * would silently discard the first.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { db, FieldValue, Timestamp, callableOpts } from '../_lib/admin.js';
import { requireActiveCustomer, requireCustomer } from '../_lib/guards.js';
import { assertCartLimits } from './limits.js';

/** How long a reservation holds stock before the sweep takes it back. */
export const RESERVATION_TTL_MS = 15 * 60 * 1000;

export const RESERVATIONS = 'stockReservations';

const LineSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  qty: z.number().int().positive(),
});

export interface ReservationLine {
  productId: string;
  variantId: string | null;
  qty: number;
}

/** Normalise the `lines` array off a reservation document. */
export function reservationLines(data: FirebaseFirestore.DocumentData | undefined): ReservationLine[] {
  const raw = Array.isArray(data?.lines) ? (data!.lines as Array<Record<string, unknown>>) : [];
  return raw
    .map((l) => ({
      productId: String(l.productId ?? ''),
      variantId: (l.variantId as string | null | undefined) ?? null,
      qty: Number(l.qty ?? 0),
    }))
    .filter((l) => l.productId && l.qty > 0);
}

/** Group [lines] by product id — every path here writes a product doc once. */
export function groupLinesByProduct(lines: ReservationLine[]): Map<string, ReservationLine[]> {
  const byProduct = new Map<string, ReservationLine[]>();
  for (const l of lines) {
    const list = byProduct.get(l.productId);
    if (list) list.push(l);
    else byProduct.set(l.productId, [l]);
  }
  return byProduct;
}

/**
 * Stage the field updates that give [lines] back to the ONE product document
 * [snap], merging them into [upd] instead of writing. Returns whether anything
 * was staged.
 *
 * Merging (rather than issuing its own `tx.update`) exists for placeOrder: when
 * an order consumes a reservation it is already writing that product document
 * (soldCount), and the surplus the hold covered but the order did not buy has to
 * ride along in the SAME update — two updates built from one snapshot would each
 * write a whole `variants` array and the second would discard the first.
 *
 * Callers must not have staged their own `stock` delta on [upd]: this overwrites
 * the field with its own `FieldValue.increment`. (placeOrder's reservation
 * branch deliberately writes no stock delta — reserveStock already took it.)
 */
export function mergeRestoreIntoUpdate(
  upd: Record<string, unknown>,
  snap: DocumentSnapshot | undefined,
  lines: ReservationLine[],
): boolean {
  if (!snap?.exists) return false;
  const p = snap.data() as Record<string, unknown>;
  // Continue from an array the caller already staged, so a document never ends
  // up with two whole-array writes derived from the same pre-transaction read.
  const base =
    (upd.variants as Array<Record<string, unknown>> | undefined) ??
    (p.variants as Array<Record<string, unknown>>) ??
    [];
  const variants = base.map((v) => ({ ...v }));
  let plainQty = 0;
  let touchedVariants = false;
  for (const l of lines) {
    if (l.qty <= 0) continue;
    if (l.variantId) {
      const v = variants.find((x) => x.id === l.variantId);
      if (v) {
        v.stock = Number(v.stock ?? 0) + l.qty;
        touchedVariants = true;
        continue;
      }
      // The variant row is gone (deleted while held, or the product was
      // converted back to variant-less). The top-level counter is where such a
      // product's stock lives, so credit it there rather than losing the units.
      plainQty += l.qty;
      continue;
    }
    plainQty += l.qty;
  }
  if (plainQty <= 0 && !touchedVariants) return false;
  // Variant units go back to their own row only — see the file header.
  if (plainQty > 0) upd.stock = FieldValue.increment(plainQty);
  upd.updatedAt = FieldValue.serverTimestamp();
  if (touchedVariants) upd.variants = variants;
  // NOTE: no soldCount change — reserving never bumped it. placeOrder is what
  // records a sale, and it bumps soldCount even when it skips the decrement.
  return true;
}

/**
 * Put [lines] back into stock, one write per product document.
 * [snaps] must already have been read inside [tx] (transactions forbid a read
 * after a write). Products that no longer exist are skipped.
 */
export function restoreReservedStock(
  tx: Transaction,
  snaps: Map<string, DocumentSnapshot>,
  lines: ReservationLine[],
): void {
  for (const [productId, productLines] of groupLinesByProduct(lines)) {
    const upd: Record<string, unknown> = {};
    if (!mergeRestoreIntoUpdate(upd, snaps.get(productId), productLines)) continue;
    tx.update(snaps.get(productId)!.ref, upd);
  }
}

// ── reserveStock ───────────────────────────────────────────────────
const ReserveSchema = z.object({ lines: z.array(LineSchema).min(1) });

export const reserveStock = onCall(callableOpts, async (req) => {
  const { uid } = await requireActiveCustomer(req);
  const parsed = ReserveSchema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid reservation request.');
  const lines: ReservationLine[] = parsed.data.lines.map((l) => ({
    productId: l.productId,
    variantId: l.variantId ?? null,
    qty: l.qty,
  }));
  // The same ceilings placeOrder enforces. A reservation takes REAL stock out of
  // the catalogue for 15 minutes before a rupee moves, so an uncapped hold is an
  // uncapped denial of stock to every other customer — and a cart that could
  // never be placed must not be allowed to hold anything at all.
  assertCartLimits(lines);

  // A query cannot run inside a transaction, so the caller's outstanding
  // reservations are located here and re-read (and re-checked) inside it.
  const priorQuery = await db
    .collection(RESERVATIONS)
    .where('customerId', '==', uid)
    .where('status', '==', 'active')
    .get();
  const priorRefs = priorQuery.docs.map((d) => d.ref);

  const newRef = db.collection(RESERVATIONS).doc();
  const expiresAt = Timestamp.fromMillis(Date.now() + RESERVATION_TTL_MS);

  await db.runTransaction(async (tx) => {
    // ── reads (all of them, before any write) ──
    const priorSnaps = priorRefs.length > 0 ? await tx.getAll(...priorRefs) : [];
    const priorActive = priorSnaps.filter(
      (s) => s.exists && s.get('status') === 'active' && s.get('customerId') === uid,
    );
    const restoreLines = priorActive.flatMap((s) => reservationLines(s.data()));

    const productIds = [...new Set([...lines, ...restoreLines].map((l) => l.productId))];
    const productSnaps = await Promise.all(
      productIds.map((id) => tx.get(db.doc(`products/${id}`))),
    );

    // ── validate + write: exactly one update per product document ──
    productIds.forEach((productId, i) => {
      const snap = productSnaps[i]!;
      const take = lines.filter((l) => l.productId === productId);
      const give = restoreLines.filter((l) => l.productId === productId);

      if (!snap.exists) {
        if (take.length > 0) {
          throw new HttpsError('failed-precondition', 'A product is no longer available.');
        }
        return; // held product since deleted — nothing to give back
      }
      const p = snap.data() as Record<string, unknown>;
      const name = (p.name as string) || 'This item';
      if (take.length > 0 && p.status !== 'published') {
        throw new HttpsError('failed-precondition', `${name} is unavailable.`);
      }

      const variants = ((p.variants as Array<Record<string, unknown>>) ?? []).map((v) => ({ ...v }));
      let delta = 0;
      let restored = 0;
      let touchedVariants = false;

      // 1) Give back whatever the caller's previous reservation was holding, so
      //    re-entering checkout with the same bag can never fail against its own
      //    hold (and can never leak it either). A variant line is credited to its
      //    own row; only a variant-less one touches the top-level counter.
      for (const l of give) {
        if (l.variantId) {
          const v = variants.find((x) => x.id === l.variantId);
          if (v) {
            v.stock = Number(v.stock ?? 0) + l.qty;
            touchedVariants = true;
            continue;
          }
        }
        delta += l.qty;
        restored += l.qty;
      }

      // 2) Then take the requested lines out of the restored figures.
      let plainQty = 0;
      for (const l of take) {
        if (l.variantId) {
          const v = variants.find((x) => x.id === l.variantId);
          if (!v) throw new HttpsError('failed-precondition', 'A selected option is unavailable.');
          if (Number(v.stock ?? 0) < l.qty) {
            throw new HttpsError('failed-precondition', `${name} is out of stock.`);
          }
          v.stock = Number(v.stock) - l.qty;
          touchedVariants = true;
        } else {
          plainQty += l.qty;
          delta -= l.qty;
        }
      }
      if (plainQty > 0 && Number(p.stock ?? 0) + restored < plainQty) {
        throw new HttpsError('failed-precondition', `${name} is out of stock.`);
      }

      if (delta === 0 && !touchedVariants) return;
      const upd: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (delta !== 0) upd.stock = FieldValue.increment(delta);
      if (touchedVariants) upd.variants = variants;
      tx.update(snap.ref, upd);
    });

    for (const s of priorActive) {
      tx.update(s.ref, { status: 'released', updatedAt: FieldValue.serverTimestamp() });
    }

    tx.set(newRef, {
      id: newRef.id,
      customerId: uid,
      status: 'active',
      lines,
      orderId: null,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return { reservationId: newRef.id, expiresAtMillis: expiresAt.toMillis() };
});

// ── releaseStock ───────────────────────────────────────────────────
const ReleaseSchema = z.object({ reservationId: z.string().min(1) });

export const releaseStock = onCall(callableOpts, async (req) => {
  const { uid } = requireCustomer(req);
  const parsed = ReleaseSchema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const ref = db.doc(`${RESERVATIONS}/${parsed.data.reservationId}`);

  await db.runTransaction(async (tx) => {
    // ── reads ──
    const snap = await tx.get(ref);
    // Idempotent: a reservation that was never created, already consumed by
    // placeOrder, already released, or already swept is simply a no-op — the
    // client calls this on every exit from checkout, including the happy path.
    if (!snap.exists) return;
    const data = snap.data() as Record<string, unknown>;
    if (data.customerId !== uid) throw new HttpsError('permission-denied', 'Not your reservation.');
    if (data.status !== 'active') return;

    const lines = reservationLines(data);
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const productSnaps = await Promise.all(
      productIds.map((id) => tx.get(db.doc(`products/${id}`))),
    );

    // ── writes ──
    restoreReservedStock(
      tx,
      new Map(productIds.map((id, i) => [id, productSnaps[i]!])),
      lines,
    );
    tx.update(ref, { status: 'released', updatedAt: FieldValue.serverTimestamp() });
  });

  return { ok: true };
});
