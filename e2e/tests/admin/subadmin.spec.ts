import { test, expect, type Page } from '@playwright/test';
import { adminLogin } from '../../fixtures/auth';

/**
 * Sub-admins — list, create with a restricted permission matrix, edit,
 * suspend/reactivate, and the self-action / last-super-admin guards.
 *
 * The logged-in user (Suresh Menon) is the ONLY super admin, so for his row the
 * self-action guard and the last-super-admin guard coincide: the UI enforces
 * both by *disabling* the suspend and delete controls (present but greyed, no
 * toast/tooltip).
 *
 * Each permission module is an unlabeled `role="switch"`; there is no aria link
 * to the module name, so a switch is reached by scoping to the row that carries
 * its label text.
 */

async function gotoSubAdmin(page: Page): Promise<void> {
  await adminLogin(page);
  await page.getByRole('link', { name: 'Sub Admin', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Sub admin', level: 1 })).toBeVisible();
}

/** The permission toggle for a module, scoped by its row label. */
const moduleSwitch = (page: Page, label: string) =>
  page.locator('div').filter({ hasText: new RegExp(`^${label}$`) }).getByRole('switch');

test.describe('admin sub-admins', () => {
  test('list shows the seeded admins', async ({ page }) => {
    await gotoSubAdmin(page);
    for (const name of ['Suresh Menon', 'Priya Nair', 'Arjun Rao']) {
      await expect(page.getByRole('cell', { name })).toBeVisible();
    }
  });

  test('creates a sub-admin with a restricted permission matrix', async ({ page }) => {
    const stamp = String(Date.now()).slice(-7);
    const name = `E2E Admin ${stamp}`;
    const email = `e2e_admin_${stamp}@barkath.app`;
    await gotoSubAdmin(page);

    await page.getByRole('button', { name: '+ Create admin' }).click();
    await expect(page.getByRole('heading', { name: 'Create sub admin', level: 1 })).toBeVisible();

    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('Barkath@123');

    // Grant only two modules; the matrix starts all-off for a sub_admin.
    await moduleSwitch(page, 'Products').click();
    await moduleSwitch(page, 'Coupons').click();
    await expect(moduleSwitch(page, 'Products')).toHaveAttribute('aria-checked', 'true');
    await expect(moduleSwitch(page, 'Orders')).toHaveAttribute('aria-checked', 'false');

    await page.getByRole('button', { name: 'Create admin' }).click();
    await expect(page.getByText('Admin created')).toBeVisible();
    await expect(page).toHaveURL(/\/sub-admin$/);
    await expect(page.getByRole('cell', { name })).toBeVisible();
  });

  test('edits, then suspends and reactivates a sub-admin', async ({ page }) => {
    // Provision a dedicated sub-admin so this test never touches the seeded ones.
    const stamp = String(Date.now()).slice(-7);
    const name = `E2E Susp ${stamp}`;
    const email = `e2e_susp_${stamp}@barkath.app`;
    await gotoSubAdmin(page);
    await page.getByRole('button', { name: '+ Create admin' }).click();
    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('Barkath@123');
    await moduleSwitch(page, 'Dashboard').click();
    await page.getByRole('button', { name: 'Create admin' }).click();
    await expect(page.getByText('Admin created')).toBeVisible();

    // Edit: change the phone and save.
    await page.getByRole('row', { name: new RegExp(name) }).click();
    await expect(page.getByRole('heading', { name: 'Edit sub admin', level: 1 })).toBeVisible();
    await page.getByLabel('Phone').fill('+91 98765 12345');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Admin updated')).toBeVisible();

    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row.getByText('Active', { exact: true })).toBeVisible();

    // Suspend via the row menu → confirm → badge flips to Suspended.
    await row.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('button', { name: 'Suspend', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Suspend this admin?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Suspend', exact: true }).click();
    await expect(page.getByText(`${name} suspended`)).toBeVisible();
    await expect(row.getByText('Suspended', { exact: true })).toBeVisible();

    // Reactivate → badge flips back to Active.
    await row.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('button', { name: 'Reactivate', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Reactivate this admin?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Reactivate', exact: true }).click();
    await expect(page.getByText(`${name} reactivated`)).toBeVisible();
    await expect(row.getByText('Active', { exact: true })).toBeVisible();
  });

  test('the self / last-super-admin guards disable suspend and delete on the own super-admin row', async ({ page }) => {
    await gotoSubAdmin(page);
    // Suresh Menon is the logged-in user AND the only active super admin.
    const own = page.getByRole('row', { name: /Suresh Menon/ });

    // The inline delete icon is present but disabled.
    await expect(own.getByRole('button', { name: 'Delete admin' })).toBeDisabled();

    // In the row menu, Suspend and Delete are disabled; Edit stays enabled.
    await own.getByRole('button', { name: 'Row actions' }).click();
    await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Edit admin', exact: true })).toBeEnabled();
  });
});
