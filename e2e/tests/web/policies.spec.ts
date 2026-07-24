import { test, expect } from '@playwright/test';
import { uniquePhone, webRegister } from '../../fixtures/auth';

/**
 * Legal / policy pages.
 *
 * The storefront resolves every policy page by *slug* off the published content
 * list (useContentPages → where('published','==',true)). The dedicated
 * /privacy and /terms routes carry a hard-coded fallback <h1>, so their titles
 * render regardless — those are asserted as the passing baseline below.
 */

test.describe('policy pages', () => {
  // Each page carries the title as its page <h1> AND (via LegalContent) as the
  // article <h2>, so headings are matched at level 1 to stay unambiguous.
  test('the public privacy and terms routes render their titles', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: 'Privacy policy', level: 1 })).toBeVisible({ timeout: 20_000 });

    await page.goto('/terms');
    await expect(page.getByRole('heading', { name: 'Terms & conditions', level: 1 })).toBeVisible({ timeout: 20_000 });
  });

  test('the /legal content pages render their published titles', async ({ page }) => {
    await page.goto('/legal/return-policy');
    await expect(page.getByRole('heading', { name: 'Return policy', level: 1 })).toBeVisible({ timeout: 20_000 });

    await page.goto('/legal/privacy-policy');
    await expect(page.getByRole('heading', { name: 'Privacy policy', level: 1 })).toBeVisible({ timeout: 20_000 });

    await page.goto('/legal/terms-conditions');
    await expect(page.getByRole('heading', { name: 'Terms & conditions', level: 1 })).toBeVisible({ timeout: 20_000 });
  });

  test('the return policy page shows its Returns and Refunds sections', async ({ page }) => {
    await page.goto('/legal/return-policy');
    await expect(page.getByRole('heading', { name: 'Returns' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Refunds' })).toBeVisible({ timeout: 20_000 });
  });

  test('the footer surfaces navigable legal links', async ({ page }) => {
    // KNOWN DEFECT: the footer "Company" column is built from useContentPages(),
    // which is empty because nothing is published — so no legal link renders.
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer.getByRole('link', { name: 'Privacy policy' })).toBeVisible({ timeout: 20_000 });
    await footer.getByRole('link', { name: 'Privacy policy' }).click();
    await expect(page).toHaveURL(/\/legal\/privacy-policy/);
  });

  test('the account settings area lists the legal policy chips', async ({ browser }) => {
    // Requires login — register a throwaway customer for this assertion. The
    // policy pages surface both as SettingsTabs chips and as a legal LinkRow, so
    // each name matches more than once; `.first()` scopes to the chip rail.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await webRegister(page, uniquePhone(), 'Policy Tester');
      await page.goto('/account/settings');
      await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible({ timeout: 20_000 });
      // The legal pages come through as chips/rows built from the published list.
      await expect(page.getByRole('link', { name: 'Privacy policy' }).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('link', { name: 'Return policy' }).first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await ctx.close();
    }
  });
});
