import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { uniquePhone, webRegister } from '../../fixtures/auth';
import { getDocument, patchDocument, listCollection, uidForPhone } from '../../fixtures/emulator';

/**
 * Affiliate withdrawal — full cross-surface flow on the emulator:
 *   User Web requests a withdrawal (real `requestWithdrawal` CF)
 *     → Admin Panel sees it live and approves/rejects (real approve/reject CFs)
 *       → Firestore reflects the money move, synced for both surfaces.
 *
 * Commission accrual (which fills confirmedBalancePaise via a delivered referred
 * order) is a long chain, so the affiliate block + a bank + a confirmed balance
 * are provisioned directly (an admin having "already allocated"); everything
 * under test — the request, the approval, the balance math — runs through the
 * real UI + Cloud Functions.
 */
test.describe.configure({ mode: 'serial' });

const PHONE = uniquePhone();
const NAME = 'Affiliate Tester';
const ADMIN = 'http://localhost:5175';
const BANK_ID = 'bank_e2e';

let ctx: BrowserContext;
let page: Page; // web (baseURL :3001)
let admin: Page; // admin (absolute :5175)
let uid: string;

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  admin = await ctx.newPage();

  await webRegister(page, PHONE, NAME);
  uid = await uidForPhone(PHONE);

  const now = new Date();
  await patchDocument(`customers/${uid}`, {
    role: 'affiliate',
    affiliate: {
      enabled: true,
      enabledAt: now,
      referralCode: 'E2E-AFFX',
      commissionRate: 0.05,
      pendingBalancePaise: 20000,
      confirmedBalancePaise: 100000, // ₹1,000 withdrawable
      withdrawnBalancePaise: 0,
      lifetimeEarningsPaise: 120000,
      referredCount: 3,
      activeReferredCount: 3,
      lastCommissionAt: now,
      hasPendingWithdrawal: false,
    },
    bankAccounts: [
      {
        id: BANK_ID,
        accountHolderName: NAME,
        accountNumberMasked: '•••• 4821',
        ifsc: 'HDFC0001234',
        bankName: 'HDFC Bank',
        branch: null,
        isDefault: true,
        verifiedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  // Keep the withdrawal minimum low + fee-free so the amounts are predictable.
  await patchDocument('settings/affiliate', {
    enabled: true,
    minWithdrawalPaise: 10000,
    processingFeeType: 'fixed',
    processingFeeValue: 0,
    processingFeeMinPaise: 0,
  });

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

/** Request a withdrawal of `rupees` through the real web UI. */
async function webRequestWithdrawal(rupees: number): Promise<void> {
  await page.goto('/account/affiliate/withdraw');
  await expect(page.getByRole('heading', { name: 'Complete withdrawal' })).toBeVisible({
    timeout: 20_000,
  });
  // Proves the provisioned affiliate block loaded into the session.
  await expect(page.getByText('₹1,000.00').first()).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder('0').fill(String(rupees));
  await page.getByRole('button', { name: /Confirm withdrawal/ }).click();
  await expect(page).toHaveURL(/\/account\/affiliate$/, { timeout: 30_000 });
}

async function latestRequestFor(): Promise<Record<string, any>> {
  const all = await listCollection('withdrawalRequests');
  const mine = all
    .filter((w) => w.customerId === uid)
    .sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0));
  expect(mine.length, 'a withdrawalRequests doc exists for this customer').toBeGreaterThan(0);
  return mine[0]!;
}

test('web request → admin approve deducts the confirmed balance', async () => {
  await webRequestWithdrawal(500);

  const req = await latestRequestFor();
  expect(req.status).toBe('pending');
  expect(req.requestedAmountPaise).toBe(50000);

  // Admin panel shows the request live and approves it.
  await admin.goto(`${ADMIN}/affiliate`);
  await expect(admin.getByRole('heading', { name: 'Affiliate program' })).toBeVisible({
    timeout: 20_000,
  });
  const row = admin.getByRole('row').filter({ hasText: NAME });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(admin.getByRole('heading', { name: 'Approve withdrawal?' })).toBeVisible({
    timeout: 20_000,
  });
  await admin.getByRole('button', { name: 'Approve & pay' }).click();
  await expect(admin.getByText(`Payout approved for ${NAME}`)).toBeVisible({ timeout: 20_000 });

  // Firestore reflects the money move for both surfaces.
  await expect
    .poll(async () => (await getDocument(`withdrawalRequests/${req.id}`))?.status, {
      timeout: 20_000,
    })
    .toBe('paid');
  const cust = await getDocument(`customers/${uid}`);
  expect(cust?.affiliate.confirmedBalancePaise).toBe(50000); // 100000 − 50000
  expect(cust?.affiliate.withdrawnBalancePaise).toBe(50000);
  expect(cust?.affiliate.hasPendingWithdrawal).toBe(false);
});

test('web request → admin reject leaves the balance untouched', async () => {
  // Balance is now ₹500 (50000) after the first approval.
  await page.goto('/account/affiliate/withdraw');
  await expect(page.getByText('₹500.00').first()).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder('0').fill('200');
  await page.getByRole('button', { name: /Confirm withdrawal/ }).click();
  await expect(page).toHaveURL(/\/account\/affiliate$/, { timeout: 30_000 });

  const req = await latestRequestFor();
  expect(req.status).toBe('pending');
  expect(req.requestedAmountPaise).toBe(20000);

  await admin.goto(`${ADMIN}/affiliate`);
  const row = admin.getByRole('row').filter({ hasText: NAME }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: 'Reject' }).click();
  await expect(admin.getByRole('heading', { name: 'Reject withdrawal?' })).toBeVisible({
    timeout: 20_000,
  });
  await admin.getByPlaceholder('Reason for rejection…').fill('E2E test rejection');
  await admin.getByRole('button', { name: 'Reject request' }).click();
  await expect(admin.getByText(`Withdrawal for ${NAME} rejected`)).toBeVisible({
    timeout: 20_000,
  });

  await expect
    .poll(async () => (await getDocument(`withdrawalRequests/${req.id}`))?.status, {
      timeout: 20_000,
    })
    .toBe('rejected');
  const cust = await getDocument(`customers/${uid}`);
  // Rejection never deducted funds; balance stays at ₹500, pending cleared.
  expect(cust?.affiliate.confirmedBalancePaise).toBe(50000);
  expect(cust?.affiliate.hasPendingWithdrawal).toBe(false);
});
