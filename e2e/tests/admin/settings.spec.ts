import { test, expect, type Page } from '@playwright/test';
import { adminLogin } from '../../fixtures/auth';

/**
 * Settings — chip navigation, GSTIN validation, storefront edits, the content-
 * page editor with multiple ordered sections, and the system-page delete guard.
 *
 * Chips are plain buttons (not ARIA tabs) that swap the panel via ?tab=; there
 * is no route load to await, so each step waits on a panel marker. The label
 * "Save changes" is shared across Delivery / Payment / Support, so it's only
 * ever clicked while the relevant panel is on screen.
 */

async function gotoSettings(page: Page): Promise<void> {
  await adminLogin(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
}

const chip = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.describe('admin settings', () => {
  test('each settings chip loads its panel', async ({ page }) => {
    await gotoSettings(page);

    // Variables is the default panel.
    await expect(page.getByRole('button', { name: 'Create variant' })).toBeVisible();

    await chip(page, 'Delivery & tax').click();
    await expect(page.getByPlaceholder('32ABCDE1234F1Z5')).toBeVisible();

    await chip(page, 'Payment gateway').click();
    await expect(page.getByPlaceholder('rzp_live_XXXXXXXXXXXX')).toBeVisible();

    await chip(page, 'Storefront').click();
    await expect(page.getByLabel('Message')).toBeVisible();

    await chip(page, 'Support').click();
    await expect(page.getByPlaceholder('help@barakath.com')).toBeVisible();

    await chip(page, 'Variables').click();
    await expect(page.getByRole('button', { name: 'Create variant' })).toBeVisible();
  });

  test('Delivery & tax rejects an invalid GSTIN and accepts a valid one', async ({ page }) => {
    await gotoSettings(page);
    await chip(page, 'Delivery & tax').click();

    const gstin = page.getByPlaceholder('32ABCDE1234F1Z5');
    await expect(gstin).toBeVisible();

    // Invalid GSTIN → inline error + toast, no save.
    await gstin.fill('INVALID123');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Enter a valid GSTIN.')).toBeVisible();
    await expect(page.getByText('Enter a valid 15-character GSTIN.')).toBeVisible();

    // Valid GSTIN → saves.
    await gstin.fill('29AAAAA0000A1Z5');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved')).toBeVisible();
  });

  test('Storefront saves the announcement message and the return window', async ({ page }) => {
    await gotoSettings(page);
    await chip(page, 'Storefront').click();

    const msg = `E2E announcement ${Date.now()}`;
    await page.getByLabel('Message').fill(msg);
    await page.getByRole('button', { name: 'Save announcement' }).click();
    await expect(page.getByText('Announcement saved')).toBeVisible();

    await page.getByLabel('Return window').fill('10');
    await page.getByRole('button', { name: 'Save returns' }).click();
    await expect(page.getByText('Return settings saved')).toBeVisible();
  });

  test('Content pages: a new page persists multiple sections in order', async ({ page }) => {
    await gotoSettings(page);

    // "New page" creates a draft doc and opens the inline editor.
    await page.getByRole('button', { name: 'New page' }).click();
    await expect(page.getByLabel('Page title')).toBeVisible();

    const stamp = String(Date.now()).slice(-8);
    const title = `E2E Page ${stamp}`;
    const slug = `e2e-page-${stamp}`;
    const headings = ['Alpha section', 'Bravo section', 'Charlie section'];

    await page.getByLabel('Page title').fill(title);
    await page.getByLabel('Slug', { exact: false }).fill(slug);

    // A new page starts with one section; add two more for three total.
    await page.getByRole('button', { name: 'Add section' }).click();
    await page.getByRole('button', { name: 'Add section' }).click();
    for (let i = 0; i < headings.length; i++) {
      await page.getByLabel(`Section ${i + 1} heading`).fill(headings[i]);
      await page.getByLabel(`Section ${i + 1} body`).fill(`Body for ${headings[i]}.`);
    }

    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Saved as draft')).toBeVisible();

    // Navigate away, then reopen the page via its chip, and assert the sections
    // survived in the original order.
    await chip(page, 'Variables').click();
    await expect(page.getByRole('button', { name: 'Create variant' })).toBeVisible();
    // A draft page's chip label carries a trailing "Draft"; the stamped title is
    // unique, so a prefix regex targets exactly this run's page.
    await page.getByRole('button', { name: new RegExp(`^${title}`) }).click();
    await expect(page.getByLabel('Page title')).toHaveValue(title);
    for (let i = 0; i < headings.length; i++) {
      await expect(page.getByLabel(`Section ${i + 1} heading`)).toHaveValue(headings[i]);
    }
  });

  test('a system page shows no delete control', async ({ page }) => {
    await gotoSettings(page);
    // Privacy Policy is a seeded built-in page (system=true).
    await chip(page, 'Privacy policy').click();
    await expect(page.getByLabel('Page title')).toHaveValue('Privacy policy');

    // Built-in pages are undeletable: no Delete button, only the explanation.
    await expect(page.getByRole('button', { name: 'Delete page' })).toHaveCount(0);
    await expect(page.getByText("Built-in pages can’t be deleted.")).toBeVisible();
  });
});
