import { test, expect } from '@playwright/test';
import { adminLogin } from '../../fixtures/auth';

/**
 * Sidebar link label → the heading that screen must show.
 *
 * Asserting the exact heading (rather than "some h1 exists") means the test
 * also catches a route rendering the WRONG screen.
 *
 * Navigation goes through the sidebar rather than `page.goto` per route: this
 * is what a real operator does, it exercises the nav wiring too, and it avoids
 * 17 consecutive full page reloads — which reliably stalls the Firestore
 * emulator's stream handling on the final load regardless of which route it is.
 */
const MODULES: [navLabel: string, heading: string][] = [
  ['Dashboard', 'Dashboard'],
  ['Products', 'Products'],
  ['Categories', 'Categories'],
  ['Inventory', 'Inventory'],
  ['Reviews', 'Reviews'],
  ['Orders', 'Orders'],
  ['Customers', 'Customers'],
  ['Payments', 'Payments'],
  ['Refunds', 'Refunds'],
  ['Spinner Campaigns', 'Spinner campaigns'],
  ['Coupons', 'Coupons'],
  ['Affiliate Program', 'Affiliate program'],
  ['Banner', 'Banner'],
  ['Notifications', 'Push notifications'],
  ['Reports & Analytics', 'Reports & Analytics'],
  ['Settings', 'Settings'],
  ['Sub Admin', 'Sub admin'],
];

test.describe('admin smoke', () => {
  test('super admin can sign in', async ({ page }) => {
    await adminLogin(page);
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  });

  test('every module route renders its own screen', async ({ page }) => {
    await adminLogin(page);

    const failures: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    for (const [navLabel, heading] of MODULES) {
      const before = errors.length;
      await page.getByRole('link', { name: navLabel, exact: true }).first().click();

      const ok = await page
        .getByRole('heading', { name: heading, level: 1 })
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => true)
        .catch(() => false);

      if (!ok) failures.push(`${navLabel}: expected heading "${heading}"`);
      if (errors.length > before) failures.push(`${navLabel}: ${errors[before]}`);
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });

  test('signing out returns to the login screen', async ({ page }) => {
    await adminLogin(page);

    // Profile menu → "Log out" → confirm. The menu button is identified by the
    // admin's own name, which the seed fixes.
    await page.getByRole('button', { name: /Suresh Menon/i }).click();
    await page.getByRole('button', { name: 'Log out', exact: true }).click();
    // The confirm dialog reuses the same label, so target the dialog's copy.
    await page.getByRole('dialog').getByRole('button', { name: 'Log out' }).click();

    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  });
});
