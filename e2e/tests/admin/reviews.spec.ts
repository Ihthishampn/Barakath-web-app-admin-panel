import { test, expect, type Page } from '@playwright/test';
import { adminLogin } from '../../fixtures/auth';
import { setDocument } from '../../fixtures/emulator';

/**
 * Reviews — reachable from the sidebar (the nav entry was the fix that made
 * /reviews usable at all), and the approve / reject moderation flow.
 *
 * Nothing seeds the `reviews` collection (only the storefront review form
 * writes it), so each test provisions its own pending review straight into the
 * emulator — the equivalent of a customer having submitted one — then drives
 * moderation through the real admin UI. `createdAt: now` guarantees the fresh
 * review sorts to the top of the (createdAt-desc, paginated) Pending tab.
 */

/** Insert one pending review and return its unique customer name (the row key). */
async function seedPendingReview(rating: number): Promise<string> {
  const stamp = Date.now();
  const id = `e2e_review_${stamp}`;
  const customerName = `E2E Reviewer ${stamp}`;
  await setDocument('reviews', id, {
    id,
    productId: '1', // seeded "Amber Oud EDP" — so the product name resolves
    customerId: 'cust_001',
    customerName,
    orderId: 'order_001',
    rating,
    title: 'E2E review title',
    body: 'Auto-provisioned review body for moderation.',
    photoUrls: [],
    status: 'pending',
    moderatedBy: null,
    moderatedAt: null,
    helpfulCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return customerName;
}

async function gotoReviews(page: Page): Promise<void> {
  await adminLogin(page);
  // The sidebar entry is the thing that makes this screen reachable at all.
  await page.getByRole('link', { name: 'Reviews', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Reviews', level: 1 })).toBeVisible();
}

test.describe('admin reviews', () => {
  test('a pending review can be approved and leaves the pending queue', async ({ page }) => {
    const reviewer = await seedPendingReview(5);
    await gotoReviews(page);

    // Pending tab is the default; the seeded review is listed there.
    const row = page.getByRole('row', { name: new RegExp(reviewer) });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Approve' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Publish this review?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Publish review' }).click();

    await expect(page.getByText('Review published')).toBeVisible();
    // It has left the Pending queue…
    await expect(page.getByRole('row', { name: new RegExp(reviewer) })).toHaveCount(0);
    // …and now appears under Approved.
    await page.getByRole('button', { name: /^Approved/ }).click();
    await expect(page.getByRole('row', { name: new RegExp(reviewer) })).toBeVisible();
  });

  test('a pending review can be rejected and the action completes', async ({ page }) => {
    const reviewer = await seedPendingReview(2);
    await gotoReviews(page);

    const row = page.getByRole('row', { name: new RegExp(reviewer) });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Reject' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Reject this review?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Reject review' }).click();

    // Assert the moderation action completes and the row leaves the queue (the
    // exact product-rating math needs a product cross-check, out of scope here).
    await expect(page.getByText('Review rejected')).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(reviewer) })).toHaveCount(0);
    await page.getByRole('button', { name: /^Rejected/ }).click();
    await expect(page.getByRole('row', { name: new RegExp(reviewer) })).toBeVisible();
  });
});
