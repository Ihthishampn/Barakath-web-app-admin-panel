import { test, expect, type Page } from '@playwright/test';
import { adminLogin } from '../../fixtures/auth';
import { getDocument, setDocument } from '../../fixtures/emulator';

/**
 * Return requests (admin "Refunds") — the fix for pending requests being
 * invisible, plus the approve→refund workflow.
 *
 * The seed creates NO orderRequests, so we provision them through the emulator
 * exactly as the requestReturnOrReplacement Cloud Function would (that collection
 * is CF-only-write under the rules). Two are created:
 *   • CI_NORMAL  — a well-formed pending request.
 *   • CI_NOTS    — a pending request MISSING `createdAt`. Under the old
 *                  `orderBy('createdAt')` query this row was silently dropped;
 *                  the resilient client-sorted query must still show it.
 */

const CUST = 'e2e_ret_cust';
const ORDER = 'e2e_ret_order';
const R_NORMAL = 'e2e_ret_normal';
const R_NOTS = 'e2e_ret_nots';
const SHORT_NORMAL = '#RP-900001';
const SHORT_NOTS = '#RP-900002';

async function seedFixtures(): Promise<void> {
  await setDocument('customers', CUST, {
    uid: CUST,
    name: 'Return Tester',
    phone: '+919000000001',
    role: 'customer',
    isBlocked: false,
    wallet: { balancePaise: 0, lifetimeCreditsPaise: 0, lifetimeDebitsPaise: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // A delivered COD order — so the approve CF sees money "received" and the
  // refund isn't capped to zero.
  await setDocument('orders', ORDER, {
    id: ORDER,
    shortId: '#BRK-90001',
    customerId: CUST,
    status: 'delivered',
    deliveredAt: new Date(),
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    subtotalPaise: 50000,
    discountPaise: 0,
    walletUsedPaise: 0,
    totalPaise: 50000,
    refundedPaise: 0,
    // Embedded item the return targets — its returnStatus must flip to
    // 'approved' when the admin approves (so the customer app stops showing
    // the return as pending).
    items: [
      {
        id: `${ORDER}_0`,
        productId: 'p1',
        productName: 'Amber Oud — Eau de Parfum',
        variantLabel: '50ml',
        quantity: 1,
        offerPricePaise: 20000,
        lineTotalPaise: 20000,
        returnStatus: 'requested',
        returnRequestId: R_NORMAL,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const itemSnapshot = {
    productId: 'p1',
    productName: 'Amber Oud — Eau de Parfum',
    variantLabel: '50ml',
    quantity: 1,
    priceAtPurchasePaise: 20000,
  };

  const base = {
    type: 'return',
    customerId: CUST,
    orderId: ORDER,
    orderShortId: '#BRK-90001',
    itemId: `${ORDER}_0`,
    itemSnapshot,
    reasonKey: 'damaged',
    reasonLabel: 'Item damaged / defective',
    note: 'Bottle arrived cracked.',
    photoUrls: [],
    status: 'pending',
    rejectionReason: null,
    refundMethod: 'wallet',
    refundAmountPaise: 20000,
    refundTransactionId: null,
    refundedAt: null,
    nonce: 'n',
    updatedAt: new Date(),
  };

  await setDocument('orderRequests', R_NORMAL, {
    id: R_NORMAL,
    shortId: SHORT_NORMAL,
    ...base,
    statusHistory: [{ status: 'pending', at: new Date(), byUid: CUST, note: 'Requested by customer' }],
    createdAt: new Date(),
  });

  // Deliberately no `createdAt` — the regression case.
  await setDocument('orderRequests', R_NOTS, {
    id: R_NOTS,
    shortId: SHORT_NOTS,
    ...base,
    statusHistory: [{ status: 'pending', at: new Date(), byUid: CUST, note: 'Requested by customer' }],
  });
}

async function gotoRefunds(page: Page): Promise<void> {
  await adminLogin(page);
  await page.getByRole('link', { name: 'Refunds', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Return requests', level: 1 })).toBeVisible();
}

test.beforeAll(async () => {
  await seedFixtures();
});

test('pending requests are visible — including one missing createdAt', async ({ page }) => {
  await gotoRefunds(page);
  // Pending is the default tab. Both requests must appear.
  await expect(page.getByRole('cell', { name: SHORT_NORMAL })).toBeVisible();
  await expect(page.getByRole('cell', { name: SHORT_NOTS })).toBeVisible();
});

test('review drawer shows full context and approve refunds to wallet', async ({ page }) => {
  await gotoRefunds(page);

  // Open the review drawer and confirm it carries the full context.
  await page.getByRole('cell', { name: SHORT_NORMAL }).click();
  await expect(page.getByRole('heading', { name: `Return ${SHORT_NORMAL}` })).toBeVisible();
  await expect(page.getByText('Bottle arrived cracked.')).toBeVisible();
  await expect(page.getByText('Requested by customer')).toBeVisible(); // timeline entry

  // Approve & refund: drawer button opens the confirm dialog; confirm it.
  await page.getByRole('button', { name: 'Approve & refund' }).first().click();
  await page.getByRole('button', { name: 'Approve & refund' }).last().click();
  await expect(page.getByText(`Refund approved for ${SHORT_NORMAL}`)).toBeVisible({ timeout: 30_000 });

  // Wallet credited, request approved, AND the order item's returnStatus is
  // stamped 'approved' so the customer app no longer shows it as pending.
  await expect(async () => {
    const cust = await getDocument(`customers/${CUST}`);
    expect(cust?.wallet?.balancePaise).toBe(20000);
    const req = await getDocument(`orderRequests/${R_NORMAL}`);
    expect(req?.status).toBe('approved');
    const order = await getDocument(`orders/${ORDER}`);
    expect(order?.items?.[0]?.returnStatus).toBe('approved');
  }).toPass({ timeout: 20_000 });
});
