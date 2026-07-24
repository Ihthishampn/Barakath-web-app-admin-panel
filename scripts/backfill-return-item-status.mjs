/**
 * Backfill: reconcile each order ITEM's `returnStatus` with its return request's
 * terminal status. Historically adminApproveOrderRequest / adminRejectOrderRequest
 * updated the request but NOT the order item, so the customer app/web kept
 * showing an already-decided return as still "pending". This one-off fixes
 * existing data; the deployed CF fix prevents it going forward.
 *
 *   approved request  → item.returnStatus = 'approved'
 *   rejected request  → item.returnStatus = 'rejected'
 *
 * Idempotent. Handles both embedded-array items and the legacy
 * orders/{id}/items subcollection.
 *
 * Run:  cd functions && node ../scripts/backfill-return-item-status.mjs
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const sa = JSON.parse(readFileSync(new URL('../.secrets/service-account.json', import.meta.url), 'utf8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore();

const TARGET = { approved: 'approved', rejected: 'rejected' };
const reqs = await db.collection('orderRequests').get();
let changed = 0, skipped = 0;

for (const d of reqs.docs) {
  const r = d.data();
  const want = TARGET[r.status];
  if (!want || !r.orderId || !r.itemId) { skipped++; continue; }

  const oref = db.doc('orders/' + r.orderId);
  const osnap = await oref.get();
  if (!osnap.exists) { skipped++; continue; }
  const o = osnap.data();

  if (Array.isArray(o.items)) {
    const idx = o.items.findIndex((x) => x.id === r.itemId);
    if (idx < 0) { skipped++; continue; }
    if (o.items[idx].returnStatus === want) { skipped++; continue; }
    const items = o.items.map((x, i) => (i === idx ? { ...x, returnStatus: want } : x));
    await oref.update({ items });
    console.log(`fixed ${r.shortId} → order ${o.shortId} embedded item ${r.itemId}: ${o.items[idx].returnStatus} → ${want}`);
    changed++;
  } else {
    const iref = db.doc(`orders/${r.orderId}/items/${r.itemId}`);
    const isnap = await iref.get();
    if (!isnap.exists) { skipped++; continue; }
    if (isnap.get('returnStatus') === want) { skipped++; continue; }
    await iref.update({ returnStatus: want });
    console.log(`fixed ${r.shortId} → order ${o.shortId} legacy item ${r.itemId}: ${isnap.get('returnStatus')} → ${want}`);
    changed++;
  }
}

console.log(`\nDone. changed=${changed} skipped=${skipped} (of ${reqs.size} requests)`);
