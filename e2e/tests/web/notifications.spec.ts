import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { uniquePhone, webRegister } from '../../fixtures/auth';
import { getDocument, listCollection, uidForPhone } from '../../fixtures/emulator';

/**
 * Notification fan-out + read-sync, across surfaces on the emulator:
 *   Admin Panel sends a broadcast (real `adminSendBroadcastNotification` CF)
 *     → it lands live in the User Web inbox (onSnapshot, no reload)
 *       → the per-user Firestore doc is `read:false` (drives the unread dot)
 *         → viewing + leaving the inbox flips it to `read:true`, synced.
 *
 * The User App reads the SAME `customers/{uid}/notifications` collection with
 * the same unread/mark-read logic, so this proves the shared contract the app
 * depends on.
 */
test.describe.configure({ mode: 'serial' });

const PHONE = uniquePhone();
const ADMIN = 'http://localhost:5175';
const TITLE = `E2E Broadcast ${PHONE}`;
const BODY = 'Your Playwright notification just arrived — tap to view.';

let ctx: BrowserContext;
let page: Page; // web (:3001)
let admin: Page; // admin (:5175 absolute)
let uid: string;

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  admin = await ctx.newPage();
  await webRegister(page, PHONE, 'Notif Tester');
  uid = await uidForPhone(PHONE);
  await adminLogin(admin);
});

test.afterAll(async () => {
  await ctx?.close();
});

async function adminLogin(p: Page): Promise<void> {
  await p.goto(`${ADMIN}/login`);
  const email = p.getByLabel('Email');
  const password = p.getByLabel('Password', { exact: true });
  await email.waitFor({ state: 'visible' });
  await email.fill('');
  await email.fill('admin@barkath.app');
  await password.fill('');
  await password.fill('Barkath@123');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await expect(p.getByRole('navigation').or(p.locator('aside')).first()).toBeVisible({
    timeout: 30_000,
  });
}

async function myNotification(): Promise<Record<string, any> | undefined> {
  const all = await listCollection(`customers/${uid}/notifications`);
  return all.find((n) => n.title === TITLE);
}

test('admin broadcast lands live in the web inbox as unread', async () => {
  // Web sits on an empty inbox first, to prove the arrival is real-time.
  await page.goto('/account/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("You're all caught up")).toBeVisible({ timeout: 20_000 });

  // Admin composes + sends the broadcast (audience defaults to All users).
  await admin.goto(`${ADMIN}/notifications/create`);
  await expect(admin.getByRole('heading', { name: 'Create notification' })).toBeVisible({
    timeout: 20_000,
  });
  await admin.getByPlaceholder('Eid sale is live').fill(TITLE);
  await admin.getByPlaceholder(/signature oud/).fill(BODY);
  await admin.getByRole('button', { name: 'Send notification' }).click();
  await expect(admin.getByText('Notification sent')).toBeVisible({ timeout: 20_000 });

  // It appears in the web inbox WITHOUT a reload (onSnapshot).
  await expect(page.getByText(TITLE)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(BODY)).toBeVisible({ timeout: 20_000 });

  // Firestore: the per-user doc exists and is unread (this is the dot's source).
  const doc = await myNotification();
  expect(doc, 'a notification doc was fanned out to this customer').toBeTruthy();
  expect(doc!.read).toBe(false);
  expect(doc!.type).toBe('broadcast');
});

test('viewing then leaving the inbox marks it read (synced to Firestore)', async () => {
  // Currently on /account/notifications from the previous step. Leave via a
  // CLIENT-SIDE link (not a reload) so the inbox React-unmounts and its
  // batch mark-read effect fires.
  await page.getByRole('link', { name: 'Personal information' }).click();
  await expect(page).toHaveURL(/\/account\/profile$/, { timeout: 20_000 });

  const doc = await myNotification();
  const id = doc!.id;
  await expect
    .poll(async () => (await getDocument(`customers/${uid}/notifications/${id}`))?.read, {
      timeout: 20_000,
    })
    .toBe(true);
});
