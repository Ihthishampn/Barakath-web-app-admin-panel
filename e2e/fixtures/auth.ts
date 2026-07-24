import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Seeded accounts — see scripts/seed.ts. */
export const SUPER_ADMIN = { email: 'admin@barkath.app', password: 'Barkath@123' };
export const CATALOG_ADMIN = { email: 'catalog@barkath.app', password: 'Barkath@123' };
export const OPS_ADMIN = { email: 'ops@barkath.app', password: 'Barkath@123' };

/**
 * Sign into the admin panel. The form prefills dev credentials, so the fields
 * are cleared first — otherwise `fill` on a non-empty input can race the
 * react-hook-form state and submit the prefilled pair instead.
 */
export async function adminLogin(page: Page, who = SUPER_ADMIN): Promise<void> {
  await page.goto('/login');
  const email = page.getByLabel('Email');
  const password = page.getByLabel('Password', { exact: true });
  await email.waitFor({ state: 'visible' });
  await email.fill('');
  await email.fill(who.email);
  await password.fill('');
  await password.fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The shell renders the sidebar once the admin doc + claims resolve.
  await expect(page.getByRole('navigation').or(page.locator('aside')).first()).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * A phone number that is unique to this run.
 *
 * Sign-in is gated on `users/{phoneKey}` already existing, and registration is
 * gated on it NOT existing, so a hard-coded number would pass on a fresh
 * emulator and fail on every rerun. `Date.now()` gives 10 digits starting 6-9
 * once the leading `9` is prepended to the last 9 digits, which is exactly what
 * PHONE_RE (`/^[6-9]\d{9}$/`) demands.
 */
export function uniquePhone(): string {
  return `9${String(Date.now()).slice(-9)}`;
}

/**
 * Read the mock OTP the app just generated.
 *
 * mockOtpService stashes the code in `sessionStorage['mock-otp:{e164}']` before
 * it resolves (web/src/lib/otp/mockOtpService.ts), and clears it on a
 * successful verify — so it must be read between "send" and "verify". Reading
 * storage instead of scraping the sonner toast keeps the helper independent of
 * toast timing and of the 15s toast duration.
 */
async function readMockOtp(page: Page): Promise<string> {
  const handle = await page.waitForFunction(
    () => {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith('mock-otp:')) return sessionStorage.getItem(key);
      }
      return null;
    },
    undefined,
    { timeout: 20_000 },
  );
  return String(await handle.jsonValue());
}

/**
 * Type a 6-digit code into the OtpInput.
 *
 * The boxes must be addressed by their `Digit N` aria-labels: they share
 * `inputmode="numeric"` with the PHONE field above them, so a positional
 * `input[inputmode="numeric"]` selector puts the first digit into the phone
 * number and shifts the whole code by one.
 *
 * Filling the sixth box fires OtpInput's `onComplete`, which submits on its
 * own — clicking the button as well would double-submit, so we don't.
 */
async function fillOtp(page: Page, otp: string): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await page.getByLabel(`Digit ${i + 1}`, { exact: true }).fill(otp[i]!);
  }
}

/**
 * Register a brand-new storefront account through the real /register flow.
 *
 * Resolves once the app has left the auth screens for the shop, which is the
 * only reliable signal that verify → completeProfile → session all succeeded.
 */
export async function webRegister(
  page: Page,
  localPhone: string,
  name = 'E2E Tester',
  email?: string,
): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Display name').fill(name);
  await page.getByPlaceholder('98765 43210').fill(localPhone);
  if (email) await page.getByLabel(/Email address/).fill(email);
  await page.getByRole('button', { name: 'Create account' }).click();

  const otp = await readMockOtp(page);
  await fillOtp(page, otp);

  // register pushes to '/' once the customer doc + users-directory entry exist.
  await page.waitForURL((url) => !/\/(register|signin)$/.test(url.pathname), { timeout: 30_000 });
  await expect(page.locator('header').first()).toBeVisible();
}

/**
 * Sign into the storefront with the mock OTP flow.
 *
 * NOTE: the phone must ALREADY exist in the `users` collection — otherwise the
 * page toasts "No account found…" and never advances to the code step (see
 * requestOtp in web/src/components/auth/authActions.ts). Register first.
 */
export async function webSignIn(page: Page, localPhone: string): Promise<void> {
  await page.goto('/signin');
  await page.getByPlaceholder('98765 43210').fill(localPhone);
  await page.getByRole('button', { name: 'Send OTP' }).click();

  const otp = await readMockOtp(page);
  await fillOtp(page, otp);

  await page.waitForURL((url) => !/\/signin$/.test(url.pathname), { timeout: 30_000 });
}

/** Sign out via the account sidebar's Log out button. */
export async function webSignOut(page: Page): Promise<void> {
  await page.goto('/account/profile');
  await page.getByRole('button', { name: 'Log out' }).click();
  // signOutCustomer + router.push('/') — the header's Sign in link is the
  // signed-out marker (it only renders once `ready && !customer`).
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible({ timeout: 20_000 });
}

/** Dismiss any sonner toast so it can't intercept a later click. */
export async function clearToasts(page: Page): Promise<void> {
  await page.locator('[data-sonner-toast]').first().click({ trial: true }).catch(() => undefined);
  await page.evaluate(() => {
    document.querySelectorAll('[data-sonner-toast]').forEach((t) => t.remove());
  });
}
