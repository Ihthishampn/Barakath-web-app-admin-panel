import { test, expect, type Page } from '@playwright/test';
import { adminLogin } from '../../fixtures/auth';

/**
 * Coupons — list, create, the duplicate-code guard, edit, activate/pause and
 * delete. Only three coupons are seeded (WELCOME30 / EID15 / FREESHIP) so the
 * list never paginates and rows are found directly without search.
 */

async function gotoCoupons(page: Page): Promise<void> {
  await adminLogin(page);
  await page.getByRole('link', { name: 'Coupons', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Coupons', level: 1 })).toBeVisible();
}

/** Filter the list to one coupon by code (the list paginates at 10 and earlier
 * specs/reruns leave extra coupons behind). */
async function findCouponRow(page: Page, code: string) {
  const search = page.getByPlaceholder('Search coupons…');
  await search.fill('');
  await search.fill(code);
  const row = page.getByRole('row', { name: new RegExp(code) });
  await expect(row).toBeVisible();
  return row;
}

/** Fill the minimum required fields for a flat-amount coupon. */
async function fillFlatCoupon(page: Page, code: string): Promise<void> {
  await page.getByLabel('Coupon code').fill(code);
  // Discount type defaults to flat; set the amount (prefix ₹ input).
  await page.getByLabel('Discount value').fill('50');
  // No expiry keeps the date field optional.
  const noExpiry = page.getByRole('switch');
  if ((await noExpiry.getAttribute('aria-checked')) !== 'true') await noExpiry.click();
}

test.describe('admin coupons', () => {
  test('list shows the seeded coupons', async ({ page }) => {
    await gotoCoupons(page);
    for (const code of ['WELCOME30', 'EID15', 'FREESHIP']) {
      await findCouponRow(page, code);
    }
  });

  test('creates a coupon with a unique code', async ({ page }) => {
    const code = `E2E${String(Date.now()).slice(-6)}`;
    await gotoCoupons(page);

    await page.getByRole('button', { name: '+ Create coupon' }).click();
    await expect(page.getByRole('heading', { name: 'Create coupon', level: 1 })).toBeVisible();
    await fillFlatCoupon(page, code);
    await page.getByRole('button', { name: 'Create coupon' }).click();

    await expect(page.getByText('Coupon created')).toBeVisible();
    await expect(page).toHaveURL(/\/coupons$/);
    await findCouponRow(page, code);
  });

  test('rejects a second coupon that reuses an existing code', async ({ page }) => {
    await gotoCoupons(page);
    await page.getByRole('button', { name: '+ Create coupon' }).click();
    await expect(page.getByRole('heading', { name: 'Create coupon', level: 1 })).toBeVisible();

    // WELCOME30 already exists → the duplicate-code guard must reject it.
    await fillFlatCoupon(page, 'WELCOME30');
    await page.getByRole('button', { name: 'Create coupon' }).click();

    await expect(page.getByText('Coupon code WELCOME30 already exists.')).toBeVisible();
    // The form does not navigate away on rejection.
    await expect(page.getByRole('heading', { name: 'Create coupon', level: 1 })).toBeVisible();
  });

  test('edits a coupon and it persists', async ({ page }) => {
    // Create a throwaway coupon, then edit its min-cart value.
    const code = `E2EED${String(Date.now()).slice(-5)}`;
    await gotoCoupons(page);
    await page.getByRole('button', { name: '+ Create coupon' }).click();
    await fillFlatCoupon(page, code);
    await page.getByRole('button', { name: 'Create coupon' }).click();
    await expect(page.getByText('Coupon created')).toBeVisible();

    await (await findCouponRow(page, code)).getByRole('cell', { name: code, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit coupon', level: 1 })).toBeVisible();
    await page.getByLabel('Min cart value').fill('999');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved')).toBeVisible();

    // Reopen and confirm the edit stuck.
    await (await findCouponRow(page, code)).getByRole('cell', { name: code, exact: true }).click();
    await expect(page.getByLabel('Min cart value')).toHaveValue('999');
  });

  test('toggles a coupon active/paused and deletes it', async ({ page }) => {
    const code = `E2ETG${String(Date.now()).slice(-5)}`;
    await gotoCoupons(page);
    await page.getByRole('button', { name: '+ Create coupon' }).click();
    await fillFlatCoupon(page, code);
    await page.getByRole('button', { name: 'Create coupon' }).click();
    await expect(page.getByText('Coupon created')).toBeVisible();

    const row = await findCouponRow(page, code);
    await expect(row.getByText('Active', { exact: true })).toBeVisible();

    // Pause via the row-actions menu → status badge flips to Paused.
    await row.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByText(`${code} paused`)).toBeVisible();
    await expect(row.getByText('Paused', { exact: true })).toBeVisible();

    // Delete via the X icon → confirm dialog → row disappears.
    await row.getByRole('button', { name: 'Delete coupon' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Delete this coupon?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete coupon' }).click();
    await expect(page.getByText(`${code} deleted`)).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(code) })).toHaveCount(0);
  });
});
