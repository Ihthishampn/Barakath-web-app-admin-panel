import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { uniquePhone, webRegister } from '../../fixtures/auth';
import { getDocument, setDocument, uidForPhone } from '../../fixtures/emulator';

/**
 * A personal (spin-won) coupon is consumed by placing an order.
 *
 * Provisions an active personal coupon, adds it at checkout, places a COD order
 * through the real `applyCoupon` / `placeOrder` Cloud Functions, then asserts
 * the coupon document moved `active → used` with the order stamped on it — the
 * server-side half of the "after a successful order, move the coupon to Used"
 * requirement.
 */
test.describe.configure({ mode: 'serial' });

/** Seeded, in stock, no variants: offer ₹45.00 (scripts/seed.ts). */
const PRODUCT = { id: '2', title: 'Musk Al Tahara Attar', unitRupees: 45 };
const QTY = 4; // ₹180 subtotal.
const CODE = 'SPINE2E';
const COUPON_ID = 'spin_e2e';

const PHONE = uniquePhone();
let ctx: BrowserContext;
let page: Page;
let uid: string;

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await webRegister(page, PHONE, 'Coupon Usage Tester');
  uid = await uidForPhone(PHONE);

  const now = Date.now();
  await setDocument(`customers/${uid}/coupons`, COUPON_ID, {
    code: CODE,
    title: '',
    description: '',
    discountType: 'flat',
    discountValuePaise: 2000, // ₹20 off
    discountPercent: null,
    discountMaxCapPaise: null,
    minCartValuePaise: 0,
    source: 'spin',
    campaignId: null,
    spinHistoryId: null,
    status: 'active',
    issuedAt: new Date(now - 86_400_000),
    expiresAt: new Date(now + 3 * 86_400_000),
    usedAt: null,
    usedOnOrderId: null,
    usedOnOrderShortId: null,
    maxUsesPerCoupon: 1,
    usesCount: 0,
    isNew: true,
    createdAt: new Date(now - 86_400_000),
    updatedAt: new Date(now - 86_400_000),
  });
});

test.afterAll(async () => {
  await ctx?.close();
});

test('applying a spin coupon and placing an order marks it Used', async () => {
  test.setTimeout(120_000);
  // Build the bag.
  await page.goto(`/product/${PRODUCT.id}`);
  await expect(page.getByRole('heading', { name: PRODUCT.title })).toBeVisible({ timeout: 20_000 });
  for (let i = 1; i < QTY; i++) await page.getByRole('button', { name: 'Increase quantity' }).click();
  await page.getByRole('button', { name: /Add to bag/ }).click();

  // Add a delivery address (new customer has none).
  await page.locator('header a[href="/bag"]').click();
  await page.getByRole('button', { name: 'Proceed to checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Add a delivery address' }).click();
  await page.getByRole('link', { name: 'Add new address' }).click();
  await page.getByLabel('Address line').fill('42 Marine Drive');
  await page.getByLabel('City').fill('Kochi');
  await page.getByLabel('State').fill('Kerala');
  await page.getByLabel('Pincode').fill('682001');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByText('42 Marine Drive')).toBeVisible({ timeout: 20_000 });

  await page.goto('/checkout');
  await expect(page.getByRole('button', { name: /Place order · ₹/ })).toBeEnabled({ timeout: 20_000 });

  // Checkout may auto-apply a best-offer promo on arrival; typing our code and
  // applying it explicitly overrides that so OUR coupon is the one on the order.
  // (applyCoupon may be cold on first invocation, hence the generous timeout.)
  await page.waitForTimeout(2_500);
  await page.getByPlaceholder('Enter coupon code').fill(CODE);
  await page.getByRole('button', { name: 'Apply', exact: true }).first().click();
  await expect(page.getByText(`${CODE} applied`).first()).toBeVisible({ timeout: 45_000 });

  // Place a COD order.
  await page.getByRole('button', { name: 'Cash on delivery' }).click();
  await page.getByRole('button', { name: /Place order · ₹/ }).click();
  await expect(page.getByRole('heading', { name: /that's on its way/i })).toBeVisible({
    timeout: 30_000,
  });

  // The coupon doc must now be Used, stamped with the order it was spent on.
  const coupon = await getDocument(`customers/${uid}/coupons/${COUPON_ID}`);
  expect(coupon?.status).toBe('used');
  expect(coupon?.usedOnOrderId).toBeTruthy();
  expect(coupon?.usedOnOrderShortId).toMatch(/BRK-\d+/);
});
