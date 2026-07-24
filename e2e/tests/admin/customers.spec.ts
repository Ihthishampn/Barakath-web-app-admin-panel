import { test, expect, type Page } from '@playwright/test';
import { adminLogin } from '../../fixtures/auth';

/**
 * Customers — list, profile tabs, and block/unblock.
 *
 * NOTE: the brief also asks for a wallet-adjust flow (add/deduct → balance
 * changes → ledger row appears). That admin UI does not exist — the Wallet tab
 * is strictly read-only and no wallet-credit/debit callable is wired up (the
 * `adminAdjustWallet` function is only a planned-module comment at
 * functions/src/index.ts:61). That case is captured as an expected failure at
 * the bottom of this file rather than a passing assertion against absent UI.
 */

async function gotoCustomers(page: Page): Promise<void> {
  await adminLogin(page);
  await page.getByRole('link', { name: 'Customers', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
}

/** Find a customer by name via the inline search (the list paginates at 10 and
 * storefront E2E runs register many extra customers, so seeded names may be on a
 * later page). */
async function findCustomerRow(page: Page, name: string) {
  const search = page.getByPlaceholder('Search…');
  await search.fill('');
  await search.fill(name);
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  return row;
}

async function openCustomer(page: Page, name: string): Promise<void> {
  await (await findCustomerRow(page, name)).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

test.describe('admin customers', () => {
  test('list shows the seeded customers', async ({ page }) => {
    await gotoCustomers(page);
    // Count is not fixed (storefront E2E registers extra customers); assert shape.
    await expect(page.getByText(/\d+ registered · \d+ affiliates/)).toBeVisible();
    // Seeded customers are reachable via search regardless of pagination.
    for (const name of ['Mira Osei', 'Aisha Khan', 'Yusuf Ali']) {
      await findCustomerRow(page, name);
    }
  });

  test('opens a profile and switches its tabs', async ({ page }) => {
    await gotoCustomers(page);
    await openCustomer(page, 'Mira Osei');

    // Wallet tab (read-only ledger) — its header marks the panel.
    await page.getByRole('button', { name: 'Wallet', exact: true }).click();
    await expect(page.getByText('Normal wallet')).toBeVisible();

    // Affiliate wallet tab — assert a panel marker (empty ledger), not the tab
    // label which is always on screen.
    await page.getByRole('button', { name: 'Affiliate wallet', exact: true }).click();
    await expect(page.getByText('No affiliate earnings yet.')).toBeVisible();

    // Back to the default Orders tab; the Wallet panel marker should be gone.
    await page.getByRole('button', { name: 'Orders', exact: true }).click();
    await expect(page.getByText('Normal wallet')).toHaveCount(0);
  });

  test('blocks then unblocks a customer', async ({ page }) => {
    await gotoCustomers(page);
    await openCustomer(page, 'Fatima Noor');

    // Block → confirm dialog → header action flips to "Unblock user".
    await page.getByRole('button', { name: 'Block user' }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Block this user?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Block user' }).click();
    await expect(page.getByText('Fatima Noor blocked')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unblock user' })).toBeVisible();

    // The list badge reflects the blocked state too.
    await page.getByRole('link', { name: 'Customers', exact: true }).first().click();
    const blockedRow = await findCustomerRow(page, 'Fatima Noor');
    await expect(blockedRow.getByText('Blocked')).toBeVisible();

    // Unblock and confirm the flip back.
    await openCustomer(page, 'Fatima Noor');
    await page.getByRole('button', { name: 'Unblock user' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Unblock this user?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Unblock user' }).click();
    await expect(page.getByText('Fatima Noor unblocked')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Block user' })).toBeVisible();
  });

  // DEFECT: the admin has no wallet-adjust UI. The brief requires adding/deducting
  // wallet funds and seeing the balance + ledger update, but the Wallet tab is
  // read-only and no adjust control or credit/debit callable exists in the admin
  // app (only the planned-module comment at functions/src/index.ts:61). Kept as an
  // expected failure so the missing capability stays visible instead of silently
  // dropped. Remove test.fail() once the adjust flow ships.
  test('wallet balance can be adjusted from the profile (missing feature)', async ({ page }) => {
    test.fail(); // expected failure — no wallet-adjust UI exists (see note above)
    await gotoCustomers(page);
    await openCustomer(page, 'Aisha Khan');
    await page.getByRole('button', { name: 'Wallet', exact: true }).click();
    // No such control exists today — this assertion is expected to fail.
    await expect(
      page.getByRole('button', { name: /Adjust|Add funds|Add money|Credit|Deduct/i }),
    ).toBeVisible();
  });
});
