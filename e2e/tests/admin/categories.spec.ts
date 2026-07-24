import { test, expect, type Page } from '@playwright/test';
import { adminLogin } from '../../fixtures/auth';
import { getDocument } from '../../fixtures/emulator';

/**
 * Categories — list, create, the "edit must not wipe description / tag colour"
 * regression, sub-categories, and the "can't delete a category that still has
 * products" guard.
 *
 * The form has no inputs for `description` or `categoryTagColor`; a fixed bug
 * used to overwrite them with blanks on save. They are only observable in the
 * stored doc, so that regression is asserted against Firestore directly.
 */

async function gotoCategories(page: Page): Promise<void> {
  await adminLogin(page);
  await page.getByRole('link', { name: 'Categories', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Categories', level: 1 })).toBeVisible();
}

test.describe('admin categories', () => {
  test('list shows the seeded categories', async ({ page }) => {
    await gotoCategories(page);
    for (const name of ['Perfumes', 'Books', 'Clothing', 'Islamic']) {
      await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
    }
  });

  test('create a category', async ({ page }) => {
    const name = `E2E Cat ${Date.now()}`;
    await gotoCategories(page);

    await page.getByRole('button', { name: '+ Add category' }).click();
    await expect(page.getByRole('heading', { name: 'Add category', level: 1 })).toBeVisible();
    await page.getByPlaceholder('Perfumes').fill(name);
    await page.getByRole('button', { name: 'Save category' }).click();

    await expect(page.getByText('Category created')).toBeVisible();
    await expect(page).toHaveURL(/\/categories$/);
    await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
  });

  test('editing a category leaves description and tag colour intact', async ({ page }) => {
    // Perfumes seeds description "Perfumes — curated collection." and tag colour
    // "amber"; neither is editable in the form, so a save must round-trip them.
    const before = await getDocument('categories/perfumes');
    expect(before?.description).toBe('Perfumes — curated collection.');
    expect(before?.categoryTagColor).toBe('amber');

    await gotoCategories(page);
    // The row click opens sub-categories; use the row's Edit menu item instead.
    const row = page.getByRole('row', { name: /Perfumes/ });
    await row.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit category', level: 1 })).toBeVisible();

    // Edit the one field the form owns (the name), then save.
    const renamed = `Perfumes ${Date.now()}`;
    await page.getByPlaceholder('Perfumes').fill(renamed);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved')).toBeVisible();

    // The hidden fields survived the save.
    const after = await getDocument('categories/perfumes');
    expect(after?.description).toBe('Perfumes — curated collection.');
    expect(after?.categoryTagColor).toBe('amber');
    expect(after?.name).toBe(renamed);

    // Restore the seeded name so later specs/reruns still find "Perfumes".
    await page.getByRole('row', { name: new RegExp(renamed) }).getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByPlaceholder('Perfumes').fill('Perfumes');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved')).toBeVisible();
  });

  test('sub-categories screen lists the seeded subs', async ({ page }) => {
    await gotoCategories(page);
    // Clicking a category row opens its sub-categories screen.
    await page.getByRole('row', { name: /Perfumes/ }).click();
    await expect(page.getByRole('heading', { name: 'Perfumes · sub-categories' })).toBeVisible();
    for (const sub of ['Oud', 'Attar', 'Musk', 'EDP']) {
      await expect(page.getByRole('cell', { name: sub, exact: true })).toBeVisible();
    }
  });

  test('deleting a category WITH products is blocked; an empty one deletes', async ({ page }) => {
    await gotoCategories(page);

    // Perfumes has 3 seeded products → the delete is refused with an explanation
    // and the confirm dialog never opens.
    const perfumes = page.getByRole('row', { name: /Perfumes/ });
    await perfumes.getByRole('button', { name: 'Delete', exact: true }).click();
    // Count is a live aggregation (other specs may have added Perfumes products),
    // so match the guard message shape rather than a fixed number.
    await expect(page.getByText(/Perfumes has \d+ products? — reassign them first\./)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // A freshly created category has zero products, so it deletes cleanly.
    const name = `E2E DelCat ${Date.now()}`;
    await page.getByRole('button', { name: '+ Add category' }).click();
    await page.getByPlaceholder('Perfumes').fill(name);
    await page.getByRole('button', { name: 'Save category' }).click();
    await expect(page.getByText('Category created')).toBeVisible();

    const row = page.getByRole('row', { name: new RegExp(name) });
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Delete this category?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete category' }).click();

    await expect(page.getByText(`${name} deleted`)).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
  });
});
