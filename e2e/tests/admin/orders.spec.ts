import { test, expect, type Page } from '@playwright/test';
import { adminLogin } from '../../fixtures/auth';

/**
 * Orders — list + status tabs, the status graph (valid transitions only),
 * cancellation, and the shipment card round-trip.
 *
 * Status changes go through a single "Update status: <current>" dropdown — there
 * is no per-transition button and no confirm dialog. The menu only ever offers
 * the valid next states, which is exactly how invalid jumps are prevented.
 *
 * Seeded orders cycle statuses by index: order_001 accepted, order_002 packing,
 * order_003 packed, … order_007 cancelled (shortIds #BRK-48200…#BRK-48214).
 */

async function gotoOrders(page: Page): Promise<void> {
  await adminLogin(page);
  await page.getByRole('link', { name: 'Orders', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
}

/** Open an order detail by its shortId (searchable, so pagination-proof). */
async function openOrder(page: Page, shortId: string): Promise<void> {
  // Orders has no inline search; the top-bar field ("Search orders…") filters it.
  const search = page.getByPlaceholder('Search orders…');
  await search.fill('');
  await search.fill(shortId);
  const row = page.getByRole('row', { name: new RegExp(shortId.replace(/[#]/g, '\\$&')) });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole('heading', { name: `Order ${shortId}`, level: 1 })).toBeVisible();
}

/** Pick a next status from the Update-status dropdown and wait for the toast. */
async function advanceStatus(page: Page, next: string): Promise<void> {
  await page.getByRole('button', { name: /^Update status:/ }).click();
  await page.getByRole('button', { name: next, exact: true }).click();
  await expect(page.getByText(`Status updated to ${next}`)).toBeVisible();
  // The trigger label reflects the new current status once the write lands.
  await expect(page.getByRole('button', { name: new RegExp(`^Update status: ${next}`) })).toBeVisible();
}

test.describe('admin orders', () => {
  test('list shows orders and the status tabs filter', async ({ page }) => {
    await gotoOrders(page);
    await expect(page.getByText(/\d+ orders · \d+ pending/)).toBeVisible();

    // Tabs are buttons whose label carries a trailing count.
    await page.getByRole('button', { name: /^Cancelled/ }).click();
    // order_007 (#BRK-48206) is the seeded cancelled order.
    await expect(page.getByRole('row', { name: /#BRK-48206/ })).toBeVisible();
    // A non-cancelled order should not show under this tab.
    await expect(page.getByRole('row', { name: /#BRK-48200/ })).toHaveCount(0);
  });

  test('advances an order through the valid status graph', async ({ page }) => {
    await gotoOrders(page);
    // order_001 (#BRK-48200) is seeded 'accepted'.
    await openOrder(page, '#BRK-48200');
    await expect(page.getByRole('button', { name: /^Update status: Accepted/ })).toBeVisible();

    // accepted → packing → packed, each persisting into the trigger label.
    await advanceStatus(page, 'Packing');
    await advanceStatus(page, 'Packed');
  });

  test('does not offer an invalid status jump', async ({ page }) => {
    await gotoOrders(page);
    // order_002 (#BRK-48201) is seeded 'packing' → only Packed / Cancelled are valid.
    await openOrder(page, '#BRK-48201');
    await page.getByRole('button', { name: /^Update status:/ }).click();
    await expect(page.getByRole('button', { name: 'Packed', exact: true })).toBeVisible();
    // 'Shipped' / 'Delivered' are NOT reachable from packing.
    await expect(page.getByRole('button', { name: 'Shipped', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delivered', exact: true })).toHaveCount(0);
  });

  test('cancels a cancellable order', async ({ page }) => {
    await gotoOrders(page);
    // order_003 (#BRK-48202) is seeded 'packed' → Cancelled is a valid transition.
    await openOrder(page, '#BRK-48202');
    await advanceStatus(page, 'Cancelled');
    // The button disables once cancelled (no further transitions).
    await expect(page.getByRole('button', { name: /^Update status: Cancelled/ })).toBeDisabled();
  });

  test('saves and persists courier / AWB / rider on the shipment card', async ({ page }) => {
    await gotoOrders(page);
    // order_001 was advanced to packed above; the shipment card is editable while
    // the order is not cancelled. Use order_005 (#BRK-48204, 'out_for_delivery')
    // which is not touched by other tests.
    await openOrder(page, '#BRK-48204');

    const stamp = String(Date.now()).slice(-6);
    const courier = `E2E Courier ${stamp}`;
    const awb = `AWB${stamp}`;
    const rider = `Rider ${stamp}`;

    await page.getByLabel('Courier').fill(courier);
    await page.getByLabel('AWB number').fill(awb);
    await page.getByLabel('Rider', { exact: true }).fill(rider);
    await page.getByRole('button', { name: 'Save shipment' }).click();
    await expect(page.getByText('Shipment details saved')).toBeVisible();

    // Reload the detail from scratch and assert the values persisted.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Order #BRK-48204', level: 1 })).toBeVisible();
    await expect(page.getByLabel('Courier')).toHaveValue(courier);
    await expect(page.getByLabel('AWB number')).toHaveValue(awb);
    await expect(page.getByLabel('Rider', { exact: true })).toHaveValue(rider);
  });
});
