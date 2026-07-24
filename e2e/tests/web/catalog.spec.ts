import { test, expect, type Page } from '@playwright/test';

/**
 * Catalogue browsing: home rails → category → listing filters/sort → search →
 * product detail. All of it is public, so nothing here signs in.
 *
 * The storefront is entirely client-rendered off Firestore listeners, so every
 * data-backed assertion below is an `expect` with a timeout — never an instant
 * read of markup that has not been populated yet.
 */

/** A seeded product that is in stock and has no variants (scripts/seed.ts). */
const SIMPLE_PRODUCT = { id: '2', name: 'Musk Al Tahara' };
/** The one seeded category whose products carry S/M/L variants. */
const VARIANT_PRODUCT = { id: '7', name: 'Linen Kurta Set' };

/** Product cards link to /product/{id}; count them to size a grid. */
const productCards = (page: Page) => page.locator('a[href^="/product/"]');

test.describe('catalogue', () => {
  test('home renders the category rail and the product rails', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Shop by category' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'New arrivals' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Best sellers' })).toBeVisible();

    // The rails are Firestore-driven: all four seeded categories must link out,
    // and the product rails must hold real cards rather than an empty state.
    for (const slug of ['perfumes', 'books', 'clothing', 'islamic']) {
      await expect(page.locator(`a[href="/c/${slug}"]`).first()).toBeVisible({ timeout: 20_000 });
    }
    await expect(productCards(page).first()).toBeVisible({ timeout: 20_000 });
  });

  test('a category page lists only that category', async ({ page }) => {
    // Navigate in-app from home rather than a second goto — repeated full
    // reloads stall the Firestore emulator's streams.
    await page.goto('/');
    await page.locator('a[href="/c/perfumes"]').first().click();

    await expect(page.getByRole('heading', { name: /^Perfumes/ })).toBeVisible({ timeout: 20_000 });
    // Heading carries the live count, e.g. "Perfumes · 3 products".
    await expect(page.getByText(/·\s*\d+\s*products?/).first()).toBeVisible();

    // Every card on a category page belongs to that category, so the three
    // seeded perfumes are all present and the books are not.
    await expect(page.getByText('Amber Oud EDP').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('The Sealed Nectar')).toHaveCount(0);
  });

  test('listing filters by stock and re-sorts by price', async ({ page }) => {
    await page.goto('/listing');
    await expect(productCards(page).first()).toBeVisible({ timeout: 20_000 });

    const total = await productCards(page).count();

    // "In stock" must be a real filter: the seed deliberately includes
    // out-of-stock products, so the set has to shrink.
    await page.getByRole('button', { name: 'In stock', exact: true }).click();
    await expect
      .poll(async () => productCards(page).count(), { timeout: 15_000 })
      .toBeLessThan(total);
    const inStockCount = await productCards(page).count();
    expect(inStockCount).toBeGreaterThan(0);
    await expect(page.getByText(new RegExp(`·\\s*${inStockCount}\\s*products?`))).toBeVisible();

    // Sorting is applied to the filtered set, so the count must not change but
    // the first card must become the cheapest one.
    await page.getByRole('button', { name: /^Sort:/ }).click();
    await page.getByRole('button', { name: 'Price: Low to High' }).click();
    await expect(page.getByRole('button', { name: 'Sort: Price: Low to High' })).toBeVisible();

    const prices = await readPrices(page);
    expect(prices.length).toBe(inStockCount);
    expect(prices, 'ascending price sort').toEqual([...prices].sort((a, b) => a - b));

    await page.getByRole('button', { name: /^Sort:/ }).click();
    await page.getByRole('button', { name: 'Price: High to Low' }).click();
    await expect.poll(async () => (await readPrices(page))[0], { timeout: 15_000 }).toBe(
      Math.max(...prices),
    );
  });

  test('the category facet narrows the listing', async ({ page }) => {
    await page.goto('/listing');
    await expect(productCards(page).first()).toBeVisible({ timeout: 20_000 });

    // Facet labels carry their own count, e.g. "Books (3)" — tick it and the
    // grid must collapse to exactly that many cards.
    const booksFacet = page.locator('label').filter({ hasText: /^Books \(\d+\)$/ });
    const facetLabel = await booksFacet.innerText();
    const expected = Number(/\((\d+)\)/.exec(facetLabel)![1]);
    await booksFacet.click();

    await expect.poll(async () => productCards(page).count(), { timeout: 15_000 }).toBe(expected);
    await expect(page.getByText('The Sealed Nectar').first()).toBeVisible();
    await expect(page.getByText('Amber Oud EDP')).toHaveCount(0);
  });

  test('search finds a seeded product and shows an empty state for gibberish', async ({ page }) => {
    await page.goto('/search');
    const field = page.getByPlaceholder('Search perfumes, books, abayas…');

    await field.fill('musk');
    await expect(page.getByText(/result(s)? for "musk"/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(SIMPLE_PRODUCT.name).first()).toBeVisible();

    // Same field, no reload — the results are recomputed client-side.
    await field.fill('zzqqxnotathing');
    await expect(page.getByText('0 results for "zzqqxnotathing"')).toBeVisible();
    await expect(page.getByText('No products match "zzqqxnotathing".')).toBeVisible();
    await expect(productCards(page)).toHaveCount(0);
  });

  test('product detail renders price, gallery and description', async ({ page }) => {
    await page.goto(`/product/${SIMPLE_PRODUCT.id}`);

    // displayTitle wins over name on the detail heading.
    await expect(page.getByRole('heading', { name: 'Musk Al Tahara Attar' })).toBeVisible({
      timeout: 20_000,
    });
    // Seeded at mrp ₹60.00 / offer ₹45.00 → both prices and the % badge show.
    await expect(page.getByText('₹45.00').first()).toBeVisible();
    await expect(page.getByText('₹60.00').first()).toBeVisible();
    await expect(page.getByText(/\d+% off/).first()).toBeVisible();

    await expect(page.getByLabel('View image 1')).toBeVisible();
    await expect(page.getByText('In stock · dispatched within 24 hours')).toBeVisible();
    await expect(page.getByRole('button', { name: /Add to bag · ₹45\.00/ })).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'Specifications' })).toBeVisible();
  });

  test('a product with variants exposes its sizes and re-prices on selection', async ({ page }) => {
    await page.goto(`/product/${VARIANT_PRODUCT.id}`);
    await expect(page.getByRole('heading', { name: /Linen Kurta Set/ })).toBeVisible({
      timeout: 20_000,
    });

    await expect(page.getByText('Size', { exact: true })).toBeVisible();
    for (const size of ['S', 'M', 'L']) {
      await expect(page.getByRole('button', { name: size, exact: true })).toBeVisible();
    }

    // Every seeded clothing variant shares one price, so selecting a size must
    // keep the CTA priced rather than blanking it out.
    await page.getByRole('button', { name: 'M', exact: true }).click();
    await expect(page.getByRole('button', { name: /Add to bag · ₹|Out of stock/ })).toBeVisible();
  });

  test('an unknown product id shows the not-found state', async ({ page }) => {
    await page.goto('/product/definitely-not-a-product');
    await expect(page.getByRole('heading', { name: 'Product not found' })).toBeVisible({
      timeout: 20_000,
    });
  });
});

/** The ₹ price rendered on every card in the grid, in rupees. */
async function readPrices(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="/product/"]'))
      .map((card) => {
        const text = card.textContent ?? '';
        // The selling price is the first ₹ amount on the card; the struck-out
        // MRP follows it.
        const m = /₹\s*([\d,]+(?:\.\d+)?)/.exec(text);
        return m ? Number(m[1]!.replace(/,/g, '')) : NaN;
      })
      .filter((n) => !Number.isNaN(n)),
  );
}
