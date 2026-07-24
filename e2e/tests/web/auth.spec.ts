import { test, expect } from '@playwright/test';
import { uniquePhone, webRegister, webSignIn, webSignOut } from '../../fixtures/auth';
import { getDocument, phoneKey } from '../../fixtures/emulator';

/**
 * Storefront authentication — the mock OTP flow plus the users-directory gate
 * that decides whether a number may sign in or register.
 *
 * Every other spec depends on these helpers, so they are exercised here first.
 * The suite is serial and shares one phone: the register test creates the
 * account the sign-in test then uses, which is exactly the real user journey.
 */
test.describe.configure({ mode: 'serial' });

// One number per run — a rerun against the same emulator must not collide with
// the directory entry the previous run left behind.
const PHONE = uniquePhone();
const NAME = 'Aiman E2E';

test.describe('storefront auth', () => {
  test('registering a new phone creates a session and a customer profile', async ({ page }) => {
    await webRegister(page, PHONE, NAME, 'aiman.e2e@example.com');

    // The account shell only renders the sidebar for a resolved customer doc,
    // so the name showing there proves completeProfile landed, not just auth.
    await page.getByRole('link', { name: 'Account' }).click();
    await expect(page.getByText(NAME).first()).toBeVisible();
    await expect(page.getByText(`+91${PHONE}`).first()).toBeVisible();

    // And the phone is now in the pre-auth directory that gates sign-in.
    const dir = await getDocument(`users/${phoneKey(`+91${PHONE}`)}`);
    expect(dir, 'users directory entry').not.toBeNull();
    expect(dir!.phone).toBe(`+91${PHONE}`);
  });

  test('signing in with an unregistered phone is refused', async ({ page }) => {
    await page.goto('/signin');
    // A number that has never been registered — same shape, different digits.
    await page.getByPlaceholder('98765 43210').fill(`8${String(Date.now()).slice(-9)}`);
    await page.getByRole('button', { name: 'Send OTP' }).click();

    await expect(page.getByText(/No account found for this number/i)).toBeVisible();
    // The gate must stop before the code step — no OTP boxes appear.
    await expect(page.getByLabel('Digit 1', { exact: true })).toHaveCount(0);
  });

  test('registering an already-registered phone is refused', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Display name').fill('Duplicate');
    await page.getByPlaceholder('98765 43210').fill(PHONE);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText(/already registered/i)).toBeVisible();
    await expect(page.getByLabel('Digit 1', { exact: true })).toHaveCount(0);
  });

  test('signing in with the registered phone lands on an authenticated screen', async ({ page }) => {
    await webSignIn(page, PHONE);

    await page.goto('/account/profile');
    // Personal information renders the live customer doc — a signed-out visitor
    // gets the "Sign in to your account" gate instead.
    await expect(page.getByRole('heading', { name: 'Personal information' })).toBeVisible();
    await expect(page.getByLabel('Display name')).toHaveValue(NAME, { timeout: 20_000 });
    await expect(page.getByText(`+91${PHONE}`).first()).toBeVisible();
  });

  test('signing out drops the session and re-gates the account area', async ({ page }) => {
    await webSignIn(page, PHONE);
    await webSignOut(page);

    await page.goto('/account/orders');
    await expect(page.getByText('Sign in to your account')).toBeVisible();
  });
});
