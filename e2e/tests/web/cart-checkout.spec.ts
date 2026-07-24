import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { uniquePhone, webRegister } from '../../fixtures/auth';

/**
 * Bag → checkout → order placement, end to end against the real
 * `applyCoupon` / `placeOrder` Cloud Functions.
 *
 * The tests share ONE browser context (and therefore one Firebase session, one
 * localStorage cart and one registered customer) because they are steps of a
 * single purchase, not independent scenarios: quantities edited in one step are
 * what the next step checks out. Serial mode makes that ordering explicit.
 */
test.describe.configure({ mode: 'serial' });

/** Seeded, in stock, no variants: mrp ₹60.00 / offer ₹45.00 (scripts/seed.ts). */
const PRODUCT = { id: '2', title: 'Musk Al Tahara Attar', unitRupees: 45 };
const QTY = 4; // ₹180 subtotal — clears WELCOME30's ₹150 minimum.

/** Seeded promotional coupon: flat ₹30 off, min cart ₹150. */
const COUPON = 'WELCOME30';

const PHONE = uniquePhone();

let ctx: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await webRegister(page, PHONE, 'Checkout Tester');
});

test.afterAll(async () => {
  await ctx?.close();
});

test.describe('bag and checkout', () => {
  test('adding from a product page puts the line and subtotal in the bag', async () => {
    await page.goto(`/product/${PRODUCT.id}`);
    await expect(page.getByRole('heading', { name: PRODUCT.title })).toBeVisible({ timeout: 20_000 });

    // Step the quantity up on the detail page so the line lands with qty 4.
    for (let i = 1; i < QTY; i++) await page.getByRole('button', { name: 'Increase quantity' }).click();
    await page.getByRole('button', { name: new RegExp(`Add to bag · ₹${PRODUCT.unitRupees * QTY}`) }).click();

    // The header badge is the app's own count — proof the store updated.
    await expect(bagLink()).toContainText(String(QTY));

    await bagLink().click();
    await expect(page.getByRole('heading', { name: /Your bag/ })).toBeVisible();
    // exact: the "Added to bag" toast also names the product.
    await expect(page.getByText(PRODUCT.title, { exact: true })).toBeVisible();
    await expect(page.getByText(`· ${QTY} items`)).toBeVisible();
    await expectSummaryRow('Subtotal', money(PRODUCT.unitRupees * QTY));
  });

  test('quantity changes and removal recalculate the bag', async () => {
    // Already on /bag from the previous step — no reload needed.
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await expectSummaryRow('Subtotal', money(PRODUCT.unitRupees * (QTY + 1)));

    await page.getByRole('button', { name: 'Decrease quantity' }).click();
    await expectSummaryRow('Subtotal', money(PRODUCT.unitRupees * QTY));

    await page.getByRole('button', { name: 'Remove item' }).click();
    await expect(page.getByRole('heading', { name: 'Your bag is empty' })).toBeVisible();
    await expect(bagLink()).not.toContainText(/\d/);
  });

  test('checkout requires a delivery address, and adding one unblocks it', async () => {
    // Rebuild the bag through the UI so this test is honest about its own state.
    await page.goto(`/product/${PRODUCT.id}`);
    await expect(page.getByRole('heading', { name: PRODUCT.title })).toBeVisible({ timeout: 20_000 });
    for (let i = 1; i < QTY; i++) await page.getByRole('button', { name: 'Increase quantity' }).click();
    await page.getByRole('button', { name: /Add to bag/ }).click();

    await bagLink().click();
    await page.getByRole('button', { name: 'Proceed to checkout' }).click();

    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({ timeout: 20_000 });
    // A brand-new customer has no addresses, so placing the order is blocked.
    await expect(page.getByText("You don't have a saved address yet.")).toBeVisible();
    await expect(page.getByText('Add a delivery address to continue.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Place order/ })).toBeDisabled();

    await page.getByRole('button', { name: 'Add a delivery address' }).click();
    await page.getByRole('link', { name: 'Add new address' }).click();

    await expect(page.getByRole('heading', { name: 'Add new address' })).toBeVisible();
    await page.getByLabel('Address line').fill('42 Marine Drive');
    await page.getByLabel('City').fill('Kochi');
    await page.getByLabel('State').fill('Kerala');
    await page.getByLabel('Pincode').fill('682001');
    await page.getByRole('button', { name: 'Save address' }).click();

    // Saved addresses live on the customer doc, so the card proves the write.
    await expect(page.getByRole('heading', { name: 'Saved addresses' })).toBeVisible();
    await expect(page.getByText('42 Marine Drive')).toBeVisible();
    await expect(page.getByText('DEFAULT')).toBeVisible();

    await page.goto('/checkout');
    await expect(page.getByRole('button', { name: /Place order · ₹/ })).toBeEnabled({ timeout: 20_000 });
  });

  test('applying a coupon puts the discount in the order summary', async () => {
    // Checkout auto-applies the single best qualifying offer on arrival. Clear
    // it so the assertion is about the code this test types, not about that.
    await removeAppliedCoupon();

    const before = await summaryValue('To pay');

    await page.getByPlaceholder('Enter coupon code').fill(COUPON);
    await applyButton().click();

    // The applied-coupon chip is written from the Cloud Function's response.
    // `.first()`: the code appears both in the applied-coupon chip and in the
    // "Available coupons" list's applied state, so scope to the first match.
    await expect(page.getByText(`${COUPON} applied`).first()).toBeVisible({ timeout: 20_000 });
    await expectSummaryRow(COUPON, '−₹30.00');

    // ₹180 − ₹30 + ₹49 delivery + ₹20 COD fee = ₹219.
    await expectSummaryRow('Subtotal', '₹180.00');
    await expectSummaryRow('Delivery', '₹49.00');
    await expectSummaryRow('Cash-on-delivery fee', '₹20.00');
    await expectSummaryRow('To pay', '₹219.00');
    expect(await summaryValue('To pay')).not.toBe(before);
  });

  test('an invalid coupon is rejected and leaves the total alone', async () => {
    const before = await summaryValue('To pay');

    await page.getByPlaceholder('Enter coupon code').fill('NOTAREALCODE');
    await applyButton().click();

    // Surfaced straight from the callable's HttpsError message.
    await expect(page.getByText('That coupon code is not valid.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('NOTAREALCODE applied')).toHaveCount(0);
    expect(await summaryValue('To pay')).toBe(before);
  });

  test('placing a COD order confirms it and files it under My orders', async () => {
    await expect(page.getByText(`${COUPON} applied`).first()).toBeVisible();
    await page.getByRole('button', { name: 'Cash on delivery' }).click();
    await page.getByRole('button', { name: /Place order · ₹219\.00/ }).click();

    // placeOrder is transactional (stock ↓, order + items + timeline), so the
    // confirmation only renders once the server has really created the order.
    await expect(page.getByRole('heading', { name: /that's on its way/i })).toBeVisible({
      timeout: 30_000,
    });
    const orderIdRow = page.locator('div').filter({ hasText: /^Order ID/ }).last();
    await expect(orderIdRow).toContainText(/BRK-\d+/);
    await expect(page.getByText('₹219.00')).toBeVisible();

    const shortId = /BRK-\d+/.exec(await orderIdRow.innerText())![0];

    // The bag is cleared as part of a successful placement.
    await expect(bagLink()).not.toContainText(/\d/);

    await page.getByRole('link', { name: 'Track order' }).click();
    await expect(page.getByRole('heading', { name: 'My orders' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(shortId)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Accepted')).toBeVisible();
  });
});

// ── helpers ────────────────────────────────────────────────────────────────
const money = (rupees: number) => `₹${rupees}.00`;

/**
 * The header's bag icon, which carries the live item-count badge. Scoped to the
 * header because product cards also expose "… to bag" accessible names.
 */
const bagLink = () => page.locator('header a[href="/bag"]');

/**
 * The Apply button next to the coupon field. `.first()` is required: the
 * "Available coupons" list underneath renders one Apply per redeemable offer.
 */
const applyButton = () => page.getByRole('button', { name: 'Apply', exact: true }).first();

/**
 * Assert one label/value pair inside the order-summary card. The rows are
 * `<span>label</span><span>value</span>` siblings, so the row is located by its
 * label and then checked for the value.
 */
async function expectSummaryRow(label: string, value: string): Promise<void> {
  const row = page
    .locator('div')
    .filter({ has: page.getByText(label, { exact: true }) })
    .filter({ hasText: value })
    .last();
  await expect(row, `${label} = ${value}`).toBeVisible({ timeout: 20_000 });
}

/** The current value of a summary row, e.g. summaryValue('To pay'). */
async function summaryValue(label: string): Promise<string> {
  const row = page.locator('div').filter({ has: page.getByText(label, { exact: true }) }).last();
  const text = await row.innerText();
  return /₹[\d,]+\.\d{2}/.exec(text)?.[0] ?? '';
}

/** Drop whatever coupon checkout auto-applied, if any. */
async function removeAppliedCoupon(): Promise<void> {
  const remove = page.getByRole('button', { name: 'Remove', exact: true });
  // Give the auto-apply effect a moment to run before deciding there is none.
  await page.waitForTimeout(2_000);
  if (await remove.count()) await remove.first().click();
  await expect(remove).toHaveCount(0);
}
