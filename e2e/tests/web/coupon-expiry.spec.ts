import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { uniquePhone, webRegister } from '../../fixtures/auth';
import { setDocument, uidForPhone } from '../../fixtures/emulator';

/**
 * Coupon expiry consistency (Active → Expired).
 *
 * The backend never eagerly writes `status: 'expired'` — a daily
 * `couponExpirySweep` reconciles it, and every reader (App, Web, checkout
 * validator) additionally computes expiry on read. This spec provisions a
 * personal coupon that is PAST its expiresAt but still stored as
 * `status: 'active'` (exactly the between-sweeps state) and asserts the Web
 * rewards wallet buckets it under Expired — never Active — and never offers it.
 */
test.describe.configure({ mode: 'serial' });

const PHONE = uniquePhone();
const ACTIVE_CODE = 'E2EACTIVE';
const EXPIRED_CODE = 'E2EEXPIRED';

let ctx: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await webRegister(page, PHONE, 'Coupon Expiry Tester');
  const uid = await uidForPhone(PHONE);

  const now = Date.now();
  const base = {
    title: '',
    description: '',
    discountType: 'flat',
    discountValuePaise: 5000,
    discountPercent: null,
    discountMaxCapPaise: null,
    minCartValuePaise: 0,
    source: 'spin',
    campaignId: null,
    spinHistoryId: null,
    usedAt: null,
    usedOnOrderId: null,
    usedOnOrderShortId: null,
    maxUsesPerCoupon: 1,
    usesCount: 0,
    isNew: true,
    issuedAt: new Date(now - 86_400_000),
    createdAt: new Date(now - 86_400_000),
    updatedAt: new Date(now - 86_400_000),
  } as const;

  // Valid, active coupon (expires in 3 days).
  await setDocument(`customers/${uid}/coupons`, 'e2e_active', {
    ...base,
    code: ACTIVE_CODE,
    status: 'active',
    expiresAt: new Date(now + 3 * 86_400_000),
  });
  // Past its expiry, but status still 'active' — the between-sweeps state.
  await setDocument(`customers/${uid}/coupons`, 'e2e_expired', {
    ...base,
    code: EXPIRED_CODE,
    status: 'active',
    expiresAt: new Date(now - 3_600_000),
  });
});

test.afterAll(async () => {
  await ctx?.close();
});

test('an expired-by-time coupon shows under Expired, not Active', async () => {
  await page.goto('/account/rewards');
  await expect(page.getByRole('heading', { name: 'Rewards', level: 1 })).toBeVisible({
    timeout: 20_000,
  });

  // Active tab (default): valid coupon present, expired one absent.
  await expect(page.getByText(ACTIVE_CODE)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(EXPIRED_CODE)).toHaveCount(0);

  // Expired tab: the reverse.
  await page.getByRole('button', { name: 'Expired' }).click();
  await expect(page.getByText(EXPIRED_CODE)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(ACTIVE_CODE)).toHaveCount(0);
});
