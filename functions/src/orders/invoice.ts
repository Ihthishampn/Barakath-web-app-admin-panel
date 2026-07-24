/**
 * GST invoice rendering.
 *
 *   generateInvoiceForOrder — reusable, non-callable renderer. Writes
 *     invoices/{shortId}.html to Storage with a download token and stamps
 *     invoiceUrl / invoiceGeneratedAt on the order. Called server-side the
 *     moment an order is genuinely paid (placeOrder for wallet-settled orders,
 *     verifyPayment right after capture) and by the admin callable.
 *   adminGenerateInvoice — the manual re-run from the Order detail screen.
 *
 * Kept dependency-free: emits a clean printable HTML invoice (browser → Print to
 * PDF) rather than pulling a heavy PDF lib into the deploy. Clients only ever
 * read `order.invoiceUrl` — storage.rules denies direct reads of invoices/**.
 */
import { randomUUID } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';
import { getStorage } from 'firebase-admin/storage';
import { db, FieldValue, callableOpts } from '../_lib/admin.js';
import { requireModule, writeAudit } from '../_lib/guards.js';

const Schema = z.object({ orderId: z.string().min(1) });
const inr = (p: number) => `₹${((p ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const esc = (s: unknown) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));

/**
 * Storage path of an order's published invoice. One definition, so publishing
 * and withdrawing can never disagree about which object they mean.
 */
const invoicePath = (shortId: string | null | undefined, orderId: string) =>
  `invoices/${shortId || orderId}.html`;

/**
 * Withdraw an order's published invoice — deletes the Storage object so the
 * tokened URL the customer already downloaded, bookmarked or shared stops
 * resolving. Clearing `invoiceUrl` on the order is the caller's job (it belongs
 * in the same transaction as the rest of the state change); this is the half
 * that cannot live inside a Firestore transaction.
 *
 * Best-effort by design: a missing object, or a bucket that is unhappy, must
 * never fail a cancellation whose money has already moved. The order's
 * `invoiceUrl` is null either way, so no client can reach a stale document
 * through the app — this only closes the already-shared-link hole.
 */
export async function revokeInvoiceForOrder(
  orderId: string,
  shortId?: string | null,
): Promise<void> {
  const path = invoicePath(shortId, orderId);
  try {
    await getStorage().bucket().file(path).delete({ ignoreNotFound: true });
  } catch (err) {
    logger.error(`revokeInvoiceForOrder: could not delete ${path}`, err);
  }
}

/**
 * Render + publish the invoice for [orderId] and stamp it on the order.
 * Returns the tokened download URL. Throws HttpsError('not-found') when the
 * order does not exist — callers that run this automatically swallow errors.
 */
export async function generateInvoiceForOrder(orderId: string): Promise<string> {
  const ref = db.doc(`orders/${orderId}`);
  const [snap, taxSnap] = await Promise.all([ref.get(), db.doc('settings/tax').get()]);
  if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
  const o = snap.data() as Record<string, any>;
  // Issuer identity comes from Settings ▸ Delivery & Tax. A document titled
  // "Tax Invoice" that omits the supplier's legal name and GSTIN is not a valid
  // tax invoice — and this HTML is the only invoice the customer can download
  // (web links it as "Download PDF" via order.invoiceUrl). Falls back to the
  // brand name so an unconfigured install still renders.
  const taxCfg = (taxSnap.data() ?? {}) as Record<string, any>;
  const issuerName = String(taxCfg.legalName ?? '').trim() || 'BARAKATH';
  const issuerGstin = String(taxCfg.gstin ?? '').trim();
  const issuerPlace = [taxCfg.businessCity, taxCfg.businessCountry]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join(', ');
  // New orders embed items on the order document; fall back to the legacy
  // subcollection for orders placed before the single-document migration.
  const items = Array.isArray(o.items) && o.items.length > 0
    ? (o.items as any[])
    : (await db.collection(`orders/${orderId}/items`).get()).docs.map((d) => d.data() as any);

  // HSN per line: the item's own code when the catalogue carries one, otherwise
  // the per-category map the admin configures on settings/tax. The column is
  // only rendered when at least one line resolves a code, so an unconfigured
  // store keeps the original three-column layout.
  const hsnByCategory = (taxCfg.hsnCodes ?? {}) as Record<string, string>;
  const hsnOf = (it: any): string =>
    String(it.hsnCode ?? hsnByCategory[String(it.category ?? '')] ?? '').trim();
  const showHsn = items.some((it) => hsnOf(it) !== '');

  const rows = items
    .map(
      (it) =>
        `<tr><td>${esc(it.productName)}${it.variantLabel ? ` <span class="v">(${esc(it.variantLabel)})</span>` : ''}</td>${showHsn ? `<td class="c">${esc(hsnOf(it) || '—')}</td>` : ''}<td class="c">${esc(it.quantity)}</td><td class="r">${inr(it.lineTotalPaise)}</td></tr>`,
    )
    .join('');
  const addr = o.deliveryAddress ?? {};
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(o.shortId ?? orderId)}</title>
<style>body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:760px;margin:32px auto;padding:0 24px}h1{font-size:22px;margin:0}.muted{color:#777}.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f7a5a;padding-bottom:16px;margin-bottom:20px}.brand{color:#0f7a5a;font-weight:800;font-size:20px}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{padding:9px 8px;border-bottom:1px solid #eee;text-align:left}th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#777}.c{text-align:center}.r{text-align:right}.v{color:#999;font-size:12px}.totals{margin-left:auto;width:280px}.totals td{border:0;padding:4px 8px}.grand{font-weight:800;font-size:16px;border-top:2px solid #1a1a1a}</style></head>
<body><div class="head"><div><div class="brand">${esc(issuerName)}</div><div class="muted">Tax Invoice</div>${issuerGstin ? `<div class="muted">GSTIN: ${esc(issuerGstin)}</div>` : ''}${issuerPlace ? `<div class="muted">${esc(issuerPlace)}</div>` : ''}</div>
<div style="text-align:right"><h1>${esc(o.shortId ?? '')}</h1><div class="muted">Placed ${o.placedAt?.toDate?.().toLocaleDateString?.('en-IN') ?? ''}</div></div></div>
<div><strong>Bill to</strong><br>${esc(o.customerName)}<br>${esc(addr.line1)}${addr.line2 ? ', ' + esc(addr.line2) : ''}<br>${esc(addr.city)} ${esc(addr.pincode)}<br>${esc(o.customerPhone)}</div>
<table><thead><tr><th>Item</th>${showHsn ? '<th class="c">HSN</th>' : ''}<th class="c">Qty</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals"><tr><td>Subtotal</td><td class="r">${inr(o.subtotalPaise)}</td></tr>
<tr><td>Discount</td><td class="r">-${inr(o.discountPaise)}</td></tr>
<tr><td>Delivery</td><td class="r">${inr(o.deliveryPaise)}</td></tr>
${Number(o.codSurchargePaise ?? 0) > 0 ? `<tr><td>COD charges</td><td class="r">${inr(o.codSurchargePaise)}</td></tr>` : ''}
<tr><td>GST</td><td class="r">${inr(o.taxPaise)}</td></tr>
<tr class="grand"><td>Total</td><td class="r">${inr(o.totalPaise)}</td></tr></table>
<p class="muted" style="margin-top:32px">Payment: ${esc(o.paymentMethod)} · ${esc(o.paymentStatus)}. This is a computer-generated invoice.</p></body></html>`;

  const bucket = getStorage().bucket();
  const path = invoicePath(o.shortId as string | null | undefined, orderId);
  const file = bucket.file(path);
  const token = randomUUID();
  await file.save(html, {
    contentType: 'text/html; charset=utf-8',
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  await ref.update({ invoiceUrl: url, invoiceGeneratedAt: FieldValue.serverTimestamp() });
  return url;
}

export const adminGenerateInvoice = onCall(callableOpts, async (req) => {
  // Gated on orders.edit, not payments.view: this is an action on the Order
  // detail screen (which the admin UI gates on the `orders` module alone) and it
  // *writes* — it stamps invoiceUrl on the order and publishes a tokened,
  // publicly readable Storage object carrying the customer's name and address.
  const { uid } = await requireModule(req, 'orders', 'edit');
  const parsed = Schema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');

  const url = await generateInvoiceForOrder(parsed.data.orderId);
  await writeAudit({
    actorUid: uid,
    action: 'order.invoice_generated',
    entity: 'orders',
    entityId: parsed.data.orderId,
    meta: { url },
  });
  return { url };
});
