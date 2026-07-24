import { defineConfig, devices } from '@playwright/test';

/**
 * Barkath end-to-end suite.
 *
 * Runs against the FIREBASE EMULATOR SUITE, never the live project — the specs
 * place orders, cancel them, delete categories and refund wallets, none of
 * which belong in production data. Bring the stack up with:
 *
 *   firebase emulators:start --project barkath-25607 --only auth,firestore,functions,storage
 *   GCLOUD_PROJECT=barkath-25607 pnpm --filter @barkath/scripts seed
 *   cd web   && NEXT_PUBLIC_USE_EMULATORS=true npx next dev -p 3001
 *   cd admin && VITE_USE_EMULATORS=true npx vite --port 5175 --strictPort
 *
 * The two apps are separate Playwright projects because they are separate
 * origins with separate auth (admin = email/password, storefront = mock OTP).
 */
export const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3001';
export const ADMIN_URL = process.env.E2E_ADMIN_URL ?? 'http://localhost:5175';

export default defineConfig({
  testDir: './tests',
  // Firestore listeners and CF round-trips are slower than a plain SPA.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // Shared emulator state means a retry of a half-finished mutation can differ
  // from a clean run; keep retries off locally so failures are honest.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'admin',
      testDir: './tests/admin',
      use: { ...devices['Desktop Chrome'], baseURL: ADMIN_URL, viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'web',
      testDir: './tests/web',
      use: { ...devices['Desktop Chrome'], baseURL: WEB_URL, viewport: { width: 1440, height: 900 } },
    },
  ],
});
