import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { uniquePhone, webRegister } from '../../fixtures/auth';

/**
 * The customer order lifecycle: place a COD order, then read it back through My
 * orders → detail → track → invoice, and finally cancel it and prove the UI
 * reflects the cancellation.
 *
 * One shared context/session across the serial steps — every step operates on
 * the SAME order placed in step 1, whose short id is captured into `shortId`.
 *
 * On returns: the seed's delivered orders belong to customers whose mock-OTP
 * phones we can't log into, so we can't drive a real return here. Instead the
 * final step asserts the action-gating on a terminal (cancelled) order, which
 * is reachable for our own customer and doesn't hard-depend on a seeded id.
 */
test.describe.configure({ mode: 'serial' });

/** Seeded, in stock, no variants: offer ₹45.00 (scripts/seed.ts). */
const PRODUCT = { id: '2', title: 'Musk Al Tahara Attar', unitRupees: 45 };
const QTY = 4; // ₹180 subtotal.

const PHONE = uniquePhone();

let ctx: BrowserContext;
let page: Page;
/** Captured from the placement confirmation; e.g. "BRK-48247". */
let shortId = '';

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await webRegister(page, PHONE, 'Orders Tester');
});

test.afterAll(async () => {
  await ctx?.close();
});

/** The header bag icon, scoped to the header (cards also expose "…to bag"). */
const bagLink = () => page.locator('header a[href="/bag"]');

test.describe('orders', () => {
  test('places a COD order through the cart → checkout flow', async () => {
    await page.goto(`/product/${PRODUCT.id}`);
    await expect(page.getByRole('heading', { name: PRODUCT.title })).toBeVisible({ timeout: 20_000 });
    for (let i = 1; i < QTY; i++) await page.getByRole('button', { name: 'Increase quantity' }).click();
    await page.getByRole('button', { name: /Add to bag/ }).click();
    await expect(bagLink()).toContainText(String(QTY), { timeout: 20_000 });

    await bagLink().click();
    await page.getByRole('button', { name: 'Proceed to checkout' }).click();
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible({ timeout: 20_000 });

    // New customer → add the delivery address checkout requires.
    await page.getByRole('button', { name: 'Add a delivery address' }).click();
    await page.getByRole('link', { name: 'Add new address' }).click();
    await expect(page.getByRole('heading', { name: 'Add new address' })).toBeVisible();
    await page.getByLabel('Address line').fill('42 Marine Drive');
    await page.getByLabel('City').fill('Kochi');
    await page.getByLabel('State').fill('Kerala');
    await page.getByLabel('Pincode').fill('682001');
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByText('42 Marine Drive')).toBeVisible({ timeout: 20_000 });

    await page.goto('/checkout');
    await expect(page.getByRole('button', { name: /Place order · ₹/ })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Cash on delivery' }).click();
    await page.getByRole('button', { name: /Place order · ₹/ }).click();

    // placeOrder is transactional — the confirmation only renders once the
    // server really created the order + items + timeline.
    await expect(page.getByRole('heading', { name: /that's on its way/i })).toBeVisible({ timeout: 30_000 });
    const orderIdRow = page.locator('div').filter({ hasText: /^Order ID/ }).last();
    await expect(orderIdRow).toContainText(/BRK-\d+/, { timeout: 20_000 });
    shortId = /BRK-\d+/.exec(await orderIdRow.innerText())![0];
  });

  test('My orders lists the placed order and opens its detail', async () => {
    await page.goto('/account/orders');
    await expect(page.getByRole('heading', { name: 'My orders' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(shortId).first()).toBeVisible({ timeout: 20_000 });

    // The whole card is clickable → the order detail route.
    await page.getByText(shortId).first().click();
    await expect(page.getByRole('heading', { name: `Order #${shortId}` })).toBeVisible({ timeout: 20_000 });
    // A just-placed order is accepted, so the cancel action is offered.
    await expect(page.getByRole('button', { name: /Cancel order/ })).toBeVisible({ timeout: 20_000 });
  });

  test('the track screen renders the status timeline', async () => {
    // In-app navigation from the detail page's Track action.
    await page.getByRole('link', { name: 'Track order' }).click();
    await expect(page.getByRole('heading', { name: 'Track order' })).toBeVisible({ timeout: 20_000 });
    // The vertical stepper renders the full happy-path flow; the placed status
    // (Accepted) and a later pending step both appear.
    await expect(page.getByText('Accepted').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Out for delivery').first()).toBeVisible();
    await expect(page.getByText('Delivered').first()).toBeVisible();
  });

  test('the invoice screen renders', async () => {
    await page.goto(`/account/orders`);
    await page.getByText(shortId).first().click();
    await expect(page.getByRole('heading', { name: `Order #${shortId}` })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('link', { name: 'Download invoice' }).click();

    await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`#${shortId}`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Total paid')).toBeVisible();
    // The PDF is only generated on delivery, so a fresh COD order shows the note.
    await expect(page.getByText(/PDF invoice generates once the order is delivered/)).toBeVisible();
  });

  test('cancelling the order shows Cancelled and withdraws the Cancel action', async () => {
    await page.goto(`/account/orders`);
    await page.getByText(shortId).first().click();
    await expect(page.getByRole('heading', { name: `Order #${shortId}` })).toBeVisible({ timeout: 20_000 });

    // Open the confirm modal, then confirm on the modal's own Cancel button
    // (last in DOM). cancelOrder is a Cloud Function: restock + wallet refund +
    // status write, so the banner only flips once the server transaction lands.
    await page.getByRole('button', { name: /Cancel order/ }).click();
    await expect(page.getByRole('heading', { name: 'Cancel this order?' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel order' }).last().click();

    await expect(page.getByText('This order was cancelled.')).toBeVisible({ timeout: 30_000 });
    // The action is gone now the order is terminal.
    await expect(page.getByRole('button', { name: /Cancel order/ })).toHaveCount(0);
  });

  test('a terminal (cancelled) order exposes only the invoice, no cancel/track/return', async () => {
    // Reachable for our own customer without depending on a seeded order id.
    await expect(page.getByRole('heading', { name: `Order #${shortId}` })).toBeVisible({ timeout: 20_000 });
    // Invoice stays available for record-keeping…
    await expect(page.getByRole('link', { name: 'Download invoice' })).toBeVisible();
    // …but a cancelled order is not open (no tracking), not cancellable, and not
    // delivered (no return) — none of those actions should render.
    await expect(page.getByRole('link', { name: 'Track order' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Cancel order/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Return item/ })).toHaveCount(0);
  });
});
