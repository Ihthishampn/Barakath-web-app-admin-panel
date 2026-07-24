import { test, expect, type Page } from '@playwright/test';
import { adminLogin } from '../../fixtures/auth';
import { getDocument } from '../../fixtures/emulator';

/**
 * Products — list, detail, create, edit-persist, the variant-preservation
 * regression, and delete-via-confirm-dialog.
 *
 * Navigation is via the sidebar after a single login (never a goto-loop, which
 * stalls the Firestore stream — see smoke.spec.ts). Row lookups go through the
 * list's Search box so they never depend on which pagination page (size 8) a
 * product happens to land on.
 */

const NAME_INPUT = 'Amber Oud — Eau de Parfum'; // the product-name field's placeholder

async function gotoProducts(page: Page): Promise<void> {
  await adminLogin(page);
  await page.getByRole('link', { name: 'Products', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Products', level: 1 })).toBeVisible();
}

/** Filter the list to one product by name and click its row into the form. */
async function openProduct(page: Page, name: string): Promise<void> {
  const search = page.getByPlaceholder('Search…');
  await search.fill('');
  await search.fill(name);
  const row = page.getByRole('row', { name: new RegExp(escapeRe(name)) });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole('heading', { name: 'Edit product', level: 1 })).toBeVisible();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Locate a custom `<Select>` by one of its option labels. getByLabel can't be
 * used: the `<select>` is nested inside its `<label>`, so the accessible name
 * absorbs every option's text.
 */
const selectByOption = (page: Page, optionLabel: string) =>
  page.locator('select', { has: page.locator('option', { hasText: optionLabel }) });

/** Create a minimal single-price product; returns to the list on success. */
async function createProduct(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '+ Add product' }).click();
  await expect(page.getByRole('heading', { name: 'Add product', level: 1 })).toBeVisible();

  await page.getByPlaceholder(NAME_INPUT).fill(name);
  await selectByOption(page, 'Perfumes').selectOption({ label: 'Perfumes' });
  // Sub-category select only enables once a category is chosen (then it lists Oud).
  await selectByOption(page, 'Oud').selectOption({ label: 'Oud' });

  // Pricing lives in the "Variants & pricing" table. A row with only a Price
  // (no colour/size) is a single-price product, not a variant.
  await page.getByRole('button', { name: 'Add variant' }).click();
  await page.getByRole('spinbutton').first().fill('100'); // first money cell = Price

  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByText('Product created')).toBeVisible();
  await expect(page).toHaveURL(/\/products$/);
}

test.describe('admin products', () => {
  test('list shows seeded products and a product opens in the editor', async ({ page }) => {
    await gotoProducts(page);

    // Catalogue summary (count is not fixed — earlier specs/reruns add products).
    await expect(page.getByText(/\d+ products · \d+ categories/)).toBeVisible();

    await openProduct(page, 'Amber Oud EDP');
    // The editor is populated from the stored product, not a blank form.
    await expect(page.getByPlaceholder(NAME_INPUT)).toHaveValue('Amber Oud EDP');
  });

  test('create a product, then edit its title and see it persist', async ({ page }) => {
    const name = `E2E Product ${Date.now()}`;
    const renamed = `${name} EDITED`;
    await gotoProducts(page);

    await createProduct(page, name);
    // Lands in the list.
    await page.getByPlaceholder('Search…').fill(name);
    await expect(page.getByRole('row', { name: new RegExp(escapeRe(name)) })).toBeVisible();

    // Edit the title.
    await openProduct(page, name);
    await page.getByPlaceholder(NAME_INPUT).fill(renamed);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved')).toBeVisible();
    await expect(page).toHaveURL(/\/products$/);

    // Navigate away and back to prove the change is server-persisted, not just
    // held in the form's local state.
    await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'Products', exact: true }).first().click();
    await openProduct(page, renamed);
    await expect(page.getByPlaceholder(NAME_INPUT)).toHaveValue(renamed);
  });

  test('editing a product WITH variants preserves every variant and its stock', async ({ page }) => {
    // Seeded product 7 = "Linen Kurta Set" with S/M/L variants (stock 10/7/4).
    // A real fixed bug silently wiped the variant set on save; the form itself
    // never renders stock (it lives in Inventory), so the load-bearing check is
    // the stored doc's variants array before vs. after an unrelated-field edit.
    const before = await getDocument('products/7');
    expect(before).not.toBeNull();
    const stockBefore = variantStock(before!.variants);
    expect(Object.keys(stockBefore)).toHaveLength(3);

    await gotoProducts(page);
    await openProduct(page, 'Linen Kurta Set');

    // The pricing table shows one row per variant; 4 money cells each → 12.
    const pricing = page.locator('table', {
      has: page.getByRole('columnheader', { name: 'Comm.' }),
    });
    await expect(pricing.getByRole('spinbutton')).toHaveCount(12);

    // Change one field the form DOES own, unrelated to variants.
    await page.getByLabel('Description').fill(`E2E touched ${Date.now()}`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Changes saved')).toBeVisible();
    await expect(page).toHaveURL(/\/products$/);

    // The stored variants — and their stock — must be untouched.
    const after = await getDocument('products/7');
    const stockAfter = variantStock(after!.variants);
    expect(stockAfter).toEqual(stockBefore);

    // And the reopened form still renders all three variant rows.
    await openProduct(page, 'Linen Kurta Set');
    await expect(pricing.getByRole('spinbutton')).toHaveCount(12);
  });

  test('archive flips status, and delete removes the row via the confirm dialog', async ({ page }) => {
    const name = `E2E Delete ${Date.now()}`;
    await gotoProducts(page);
    await createProduct(page, name);

    await page.getByPlaceholder('Search…').fill(name);
    const row = page.getByRole('row', { name: new RegExp(escapeRe(name)) });
    await expect(row).toBeVisible();

    // Archive is immediate (no dialog) and only flips the Status badge — the row
    // stays put.
    await row.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByText(`${name} archived`)).toBeVisible();
    await expect(row.getByText('Archived')).toBeVisible();

    // Delete opens the confirm dialog and permanently removes the row.
    await row.getByRole('button', { name: 'Row actions' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Delete this product?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete product' }).click();

    await expect(page.getByText(`${name} deleted`)).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(escapeRe(name)) })).toHaveCount(0);
  });
});

/** Map a stored variants array → { variantId: stock }. */
function variantStock(variants: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of (variants as Array<Record<string, unknown>>) ?? []) {
    out[String(v.id)] = Number(v.stock);
  }
  return out;
}
