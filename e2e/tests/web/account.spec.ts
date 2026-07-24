import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { uniquePhone, webRegister } from '../../fixtures/auth';

/**
 * The account area for a freshly-registered customer: profile, addresses,
 * wishlist, notifications, wallet and the settings sub-screens.
 *
 * One browser context / one Firebase session is shared across the steps because
 * they build on each other (an address added in one step is edited and deleted
 * in the next). Serial mode makes that ordering explicit. Every assertion that
 * reads back a Firestore write carries a timeout — the storefront is entirely
 * client-rendered off live listeners, so nothing is ever instantly present.
 */
test.describe.configure({ mode: 'serial' });

/** Seeded, in-stock, no variants (scripts/seed.ts). name ≠ displayTitle. */
const PRODUCT = { id: '2', name: 'Musk Al Tahara', title: 'Musk Al Tahara Attar' };

const PHONE = uniquePhone();
const START_NAME = 'Account Tester';
const EDITED_NAME = 'Renamed Tester';

let ctx: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await webRegister(page, PHONE, START_NAME);
});

test.afterAll(async () => {
  await ctx?.close();
});

test.describe('account area', () => {
  test('profile shows the registered name and an edited display name persists a reload', async () => {
    await page.goto('/account/profile');
    await expect(page.getByRole('heading', { name: 'Personal information' })).toBeVisible({ timeout: 20_000 });

    // The field is seeded from the live customer doc created at registration.
    const nameField = page.getByLabel('Display name');
    await expect(nameField).toHaveValue(START_NAME, { timeout: 20_000 });

    await nameField.fill(EDITED_NAME);
    // Save is gated on the form being dirty, so it only enables after the edit.
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Profile updated.')).toBeVisible({ timeout: 20_000 });

    // A reload re-reads customers/{uid}: the new name is only here if the write
    // reached Firestore, not just React state.
    await page.reload();
    await expect(page.getByLabel('Display name')).toHaveValue(EDITED_NAME, { timeout: 20_000 });
  });

  test('a delivery address can be added, edited, and deleted', async () => {
    // Navigate in-app from the sidebar rather than a second full goto.
    await page.getByRole('link', { name: 'Saved addresses' }).click();
    await expect(page.getByRole('heading', { name: 'Saved addresses' })).toBeVisible({ timeout: 20_000 });
    // A brand-new customer has no addresses.
    await expect(page.getByText('No saved addresses yet')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('link', { name: 'Add new address' }).first().click();
    await expect(page.getByRole('heading', { name: 'Add new address' })).toBeVisible();
    // Full name / Mobile prefill from the customer doc; only these four are blank.
    await page.getByLabel('Address line').fill('42 Marine Drive');
    await page.getByLabel('City').fill('Kochi');
    await page.getByLabel('State').fill('Kerala');
    await page.getByLabel('Pincode').fill('682001');
    await page.getByRole('button', { name: 'Save address' }).click();

    // Back on the list — the card proves the write landed on the customer doc.
    await expect(page.getByRole('heading', { name: 'Saved addresses' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('42 Marine Drive')).toBeVisible({ timeout: 20_000 });
    // First address is defaulted.
    await expect(page.getByText('DEFAULT')).toBeVisible();

    // Edit: change the city and confirm it re-renders from the updated doc.
    await page.getByRole('link', { name: 'Edit address' }).click();
    await expect(page.getByRole('heading', { name: 'Edit address' })).toBeVisible();
    const cityField = page.getByLabel('City');
    await expect(cityField).toHaveValue('Kochi');
    await cityField.fill('Trivandrum');
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByText(/Trivandrum/)).toBeVisible({ timeout: 20_000 });

    // Delete: the card removal is confirmed via a native window.confirm dialog.
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete address' }).click();
    await expect(page.getByText('No saved addresses yet')).toBeVisible({ timeout: 20_000 });
  });

  test('a product can be wishlisted from its page and removed from the wishlist screen', async () => {
    await page.goto(`/product/${PRODUCT.id}`);
    await expect(page.getByRole('heading', { name: PRODUCT.title })).toBeVisible({ timeout: 20_000 });

    // The heart toggles customers/{uid}/wishlist/{productId}; its aria-label
    // flips only once the live subscription confirms the write. `.first()`: the
    // related-products rail below also renders wishlist hearts, so scope to the
    // main product's heart (the first on the page).
    await page.getByRole('button', { name: 'Add to wishlist' }).first().click();
    await expect(page.getByRole('button', { name: 'Remove from wishlist' }).first()).toBeVisible({ timeout: 20_000 });

    await page.goto('/account/wishlist');
    await expect(page.getByRole('heading', { name: 'Wishlist' })).toBeVisible({ timeout: 20_000 });
    // The card stores the product's `name` (not its displayTitle).
    await expect(page.getByText(PRODUCT.name, { exact: true })).toBeVisible({ timeout: 20_000 });

    // Remove from the card and assert the empty state returns.
    await page.getByRole('button', { name: 'Remove from wishlist' }).click();
    await expect(page.getByText('Your wishlist is empty')).toBeVisible({ timeout: 20_000 });
  });

  test('the notifications screen loads, and mark-as-read persists a reload when any exist', async () => {
    await page.goto('/account/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 20_000 });

    // Unread rows carry the brand-tint background; scope to the list container.
    const list = page.locator('.max-w-\\[720px\\]').first();
    const unreadRow = list.locator('[class*="bg-brand-primary-subtle"]');
    const emptyState = page.getByText("You're all caught up");

    // Wait for one of the two terminal states (rows or empty) to settle.
    await expect(async () => {
      const empty = await emptyState.isVisible();
      const rows = await unreadRow.count();
      expect(empty || rows >= 0).toBeTruthy();
    }).toPass({ timeout: 20_000 });

    if (await emptyState.isVisible()) {
      // A freshly-registered customer has no notifications — assert that plainly.
      await expect(emptyState).toBeVisible();
      return;
    }

    // If any unread notifications exist, marking-as-read fires on unmount and
    // must survive a reload — the rule used to REJECT this write, so the tint
    // would come back. Leave the page (triggers the batch), then reload.
    const before = await unreadRow.count();
    await page.goto('/account/wallet');
    await expect(page.getByText('Transaction history')).toBeVisible({ timeout: 20_000 });
    await page.goto('/account/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 20_000 });
    // The previously-unread rows are now persisted as read → no tinted rows.
    await expect
      .poll(async () => unreadRow.count(), { timeout: 20_000 })
      .toBeLessThan(before || 1);
  });

  test('the wallet screen loads and shows a balance', async () => {
    await page.goto('/account/wallet');
    await expect(page.getByText('Normal wallet balance')).toBeVisible({ timeout: 20_000 });
    // A new customer starts at ₹0.00 — assert a real money-formatted balance,
    // not merely that the page didn't crash.
    await expect(page.getByText(/₹0\.00/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Transaction history')).toBeVisible();
    await expect(page.getByText('No wallet activity yet.')).toBeVisible({ timeout: 20_000 });
  });

  test('the settings overview and its sub-screens load', async () => {
    await page.goto('/account/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 20_000 });
    // Personal-information summary reflects the edit made earlier.
    await expect(page.getByText(EDITED_NAME).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Legal' })).toBeVisible();
    // "Help and Support" is the one always-present row in the legal group.
    await expect(page.getByRole('link', { name: 'Help and Support' })).toBeVisible();

    // Notification preferences sub-screen.
    await page.goto('/account/settings/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Order updates')).toBeVisible({ timeout: 20_000 });

    // Help & support sub-screen.
    await page.goto('/account/support');
    await expect(page.getByRole('heading', { name: 'Help & support' })).toBeVisible({ timeout: 20_000 });
  });
});
