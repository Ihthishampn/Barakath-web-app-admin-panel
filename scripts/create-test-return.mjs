/**
 * One-off: create a single PENDING return request in PROD so the admin
 * "Return requests" (Refunds) Pending tab has something to Accept.
 *
 * Tied to a real delivered order (#BRK-48009, app test customer AAbW…) that
 * still has ₹69 of refundable capacity, so Accept → refund succeeds cleanly and
 * credits the customer's wallet. Safe to delete the created doc afterwards.
 *
 * Run:  node scripts/create-test-return.mjs
 * (uses .secrets/service-account.json — same creds the functions use)
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const sa = JSON.parse(readFileSync(new URL('../.secrets/service-account.json', import.meta.url), 'utf8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore();

const ORDER_ID = '7XPdil67DKHF7luDu079'; // #BRK-48009, cust AAbW…, ~₹69 refundable
const oref = db.doc('orders/' + ORDER_ID);
const osnap = await oref.get();
if (!osnap.exists) throw new Error('order not found: ' + ORDER_ID);
const o = osnap.data();

// Resolve a representative item (embedded array or legacy subcollection).
let it = (Array.isArray(o.items) && o.items[0]) || null;
let itemId = it?.id;
if (!it) {
  const sub = await db.collection('orders/' + ORDER_ID + '/items').limit(1).get();
  if (!sub.empty) { it = sub.docs[0].data(); itemId = sub.docs[0].id; }
}
it = it || {};
itemId = itemId || (ORDER_ID + '_0');

const refund = 6900; // ≤ remaining refundable → Accept refunds ₹69 to the wallet
const reqRef = db.collection('orderRequests').doc();
const shortId = '#RP-000005';
const now = FieldValue.serverTimestamp();

await reqRef.set({
  id: reqRef.id,
  shortId,
  type: 'return',
  customerId: o.customerId,
  orderId: ORDER_ID,
  orderShortId: o.shortId || '#BRK-48009',
  itemId,
  itemSnapshot: {
    productId: it.productId || '',
    productName: it.productName || it.name || 'Item',
    variantLabel: it.variantLabel || null,
    quantity: Number(it.quantity || 1),
    priceAtPurchasePaise: Number(it.offerPricePaise || it.lineTotalPaise || refund),
  },
  reasonKey: 'damaged',
  reasonLabel: 'Item damaged / defective',
  note: 'Test return — created to verify the admin Accept/Refund flow.',
  photoUrls: [],
  status: 'pending',
  statusHistory: [{ status: 'pending', at: new Date(), byUid: o.customerId, note: 'Requested by customer' }],
  rejectionReason: null,
  refundMethod: 'wallet',
  refundAmountPaise: refund,
  refundTransactionId: null,
  refundedAt: null,
  nonce: reqRef.id,
  searchIndex: [shortId.toLowerCase(), (o.shortId || '').toLowerCase()].filter(Boolean),
  createdAt: now,
  updatedAt: now,
});
// Keep the shortId counter consistent so the next real app request is #RP-000006.
await db.doc('counters/orderRequests').set({ seq: 5 }, { merge: true });

console.log('CREATED pending', shortId, 'docId=', reqRef.id, 'order=', o.shortId,
  'cust=', o.customerId, 'refund=', refund, 'product=', it.productName || it.name);
