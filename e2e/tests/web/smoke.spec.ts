import { test, expect } from '@playwright/test';

/**
 * Public storefront pages must render for a signed-out visitor. These are the
 * pages a crawler or a first-time customer hits, so none of them may depend on
 * an authenticated session.
 */
const PUBLIC_PAGES = [
  '/',
  '/listing',
  '/categories',
  '/search',
  '/support',
  '/privacy',
  '/terms',
];

/**
 * The auth screens are deliberately full-screen with no site header, so they
 * are asserted on their own content rather than the shop chrome.
 */
const AUTH_PAGES = ['/signin', '/register'];

test.describe('storefront smoke', () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} renders for a signed-out visitor`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));

      const res = await page.goto(path);
      expect(res?.status(), `${path} HTTP status`).toBeLessThan(400);

      // The header is on every shop page; its presence means the shell mounted
      // rather than an error boundary taking over.
      await expect(page.locator('header').first()).toBeVisible();
      expect(errors, `${path} threw: ${errors[0]}`).toEqual([]);
    });
  }

  for (const path of AUTH_PAGES) {
    test(`${path} renders for a signed-out visitor`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));

      const res = await page.goto(path);
      expect(res?.status(), `${path} HTTP status`).toBeLessThan(400);
      // A phone field is the one thing both auth screens must offer.
      await expect(page.getByRole('textbox').first()).toBeVisible();
      expect(errors, `${path} threw: ${errors[0]}`).toEqual([]);
    });
  }

  test('the bag is reachable and shows an empty state', async ({ page }) => {
    await page.goto('/bag');
    await expect(page.locator('header').first()).toBeVisible();
    await expect(page.getByText(/empty|nothing|add (some )?item/i).first()).toBeVisible();
  });

  test('account routes send a signed-out visitor to sign in', async ({ page }) => {
    await page.goto('/account');
    // Either redirected to /signin, or an in-page sign-in prompt is shown.
    const signInPrompt = page.getByRole('link', { name: /sign in/i }).or(
      page.getByRole('button', { name: /sign in/i }),
    );
    await expect(page.url().includes('/signin') ? page.locator('body') : signInPrompt.first()).toBeVisible();
  });
});
