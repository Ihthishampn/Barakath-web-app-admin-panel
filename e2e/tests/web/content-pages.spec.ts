import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { uniquePhone, webRegister } from '../../fixtures/auth';
import { patchDocument, setDocument } from '../../fixtures/emulator';

/**
 * Dynamic policy/content pages — real-time sync from the `content` collection
 * (the exact collection the Admin Panel writes to and the User App streams).
 *
 * Proves: a newly-published page appears live (no reload), its sections render,
 * an added section shows up live, and unpublishing removes it — the whole
 * "reflects the latest admin content without app changes" contract the App
 * relies on (App uses the identical `content where published==true` query).
 */
test.describe.configure({ mode: 'serial' });

const PHONE = uniquePhone();
const DOC = 'e2eContentPage';
const SLUG = 'e2e-content-page';
const TITLE = `E2E Policy ${PHONE}`;

let ctx: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await webRegister(page, PHONE, 'Content Tester');
});

test.afterAll(async () => {
  await ctx?.close();
});

test('a newly published page appears live with its sections', async () => {
  await page.goto('/account/settings');
  await expect(page.getByRole('heading', { name: 'Legal' })).toBeVisible({ timeout: 20_000 });
  // Seeded pages are already listed (proves the dynamic list, not hardcoding).
  await expect(page.getByRole('link', { name: 'Privacy policy' }).first()).toBeVisible({
    timeout: 20_000,
  });

  // Admin publishes a brand-new page (same collection the admin UI writes to).
  const now = new Date();
  await setDocument('content', DOC, {
    id: DOC,
    title: TITLE,
    slug: SLUG,
    order: 999,
    published: true,
    system: false,
    version: 1,
    body: '',
    bodyHtml: '',
    lastEditorUid: 'e2e',
    sections: [
      { id: 'sec_1', heading: 'Alpha heading', body: 'First section body.', order: 10 },
    ],
    publishedAt: now,
    updatedAt: now,
  });

  // It shows up in the Legal list WITHOUT a reload (onSnapshot).
  await expect(page.getByRole('link', { name: TITLE }).first()).toBeVisible({ timeout: 20_000 });

  // Opening it renders the section heading + body.
  await page.goto(`/account/legal/${SLUG}`);
  await expect(page.getByText('Alpha heading')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('First section body.')).toBeVisible({ timeout: 20_000 });
});

test('a section added by the admin appears live', async () => {
  const now = new Date();
  await patchDocument(`content/${DOC}`, {
    sections: [
      { id: 'sec_1', heading: 'Alpha heading', body: 'First section body.', order: 10 },
      { id: 'sec_2', heading: 'Beta heading', body: 'Second section body.', order: 20 },
    ],
    updatedAt: now,
  });
  // Still on the legal detail page — the new section streams in without reload.
  await expect(page.getByText('Beta heading')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Second section body.')).toBeVisible({ timeout: 20_000 });
});

test('unpublishing removes the page live', async () => {
  await page.goto('/account/settings');
  await expect(page.getByRole('link', { name: TITLE }).first()).toBeVisible({ timeout: 20_000 });
  await patchDocument(`content/${DOC}`, { published: false });
  await expect(page.getByRole('link', { name: TITLE })).toHaveCount(0, { timeout: 20_000 });
});
