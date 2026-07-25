/**
 * One-off, prod (barkath-25607): backfill the wallet "cashback" ledger row for
 * the promo-coupon order placed BEFORE the placeOrder deploy that started
 * writing it automatically. Writes exactly the row shape the deployed function
 * now writes (source 'cashback'), plus the matching breakdown.cashbackPaise
 * increment — idempotent via a deterministic doc id, so re-running is a no-op.
 *
 * Run:  pnpm --filter @barkath/scripts exec tsx backfill-coupon-cashback.ts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const KEY = '/home/h/barkath/.secrets/service-account.json';
initializeApp({ credential: cert(JSON.parse(readFileSync(KEY, 'utf8'))), projectId: 'barkath-25607' });
const db = getFirestore();

// The order the customer just placed with an admin-panel (promotional) coupon.
const ORDER_ID = 'zFkuaTD72s4FvLmYUmdp';

async function main() {
  const orderSnap = await db.doc(`orders/${ORDER_ID}`).get();
  if (!orderSnap.exists) {
    console.log(`Order ${ORDER_ID} not found — aborting.`);
    return;
  }
  const o = orderSnap.data()!;
  const applied = (o.appliedCoupon ?? {}) as {
    code?: string;
    couponId?: string | null;
    source?: string;
    discountPaise?: number;
  };

  if (applied.source !== 'promotional') {
    console.log(`Order ${ORDER_ID} coupon source is '${applied.source}', not 'promotional' — aborting.`);
    return;
  }

  const uid = String(o.customerId);
  const amountPaise = Number(applied.discountPaise ?? o.discountPaise ?? 0);
  const shortId = String(o.shortId ?? '');
  const createdAt = o.createdAt ?? FieldValue.serverTimestamp();

  if (amountPaise <= 0) {
    console.log(`Order ${ORDER_ID} has no discount to record — aborting.`);
    return;
  }

  // Deterministic id → re-running never duplicates the row or the tally.
  const rowId = `backfill_cashback_${ORDER_ID}`;
  const rowRef = db.doc(`customers/${uid}/walletTransactions/${rowId}`);

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(rowRef);
    if (existing.exists) {
      console.log(`Cashback row already present for ${shortId} — nothing to do.`);
      return;
    }
    const custSnap = await tx.get(db.doc(`customers/${uid}`));
    const balanceAfterPaise = Number(custSnap.get('wallet.balancePaise') ?? 0);

    tx.set(rowRef, {
      id: rowId,
      type: 'credit',
      source: 'cashback',
      amountPaise,
      balanceAfterPaise,
      title: `Cashback · saved on ${shortId}`,
      description: applied.code ?? null,
      orderId: ORDER_ID,
      orderShortId: shortId,
      refType: 'coupon',
      refId: applied.couponId ?? null,
      createdAt,
    });
    tx.update(db.doc(`customers/${uid}`), {
      'wallet.breakdown.cashbackPaise': FieldValue.increment(amountPaise),
      'wallet.lastTransactionAt': FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`Wrote cashback row (${amountPaise} paise) + tally increment for ${shortId} (uid ${uid}).`);
  });
}

await main();
