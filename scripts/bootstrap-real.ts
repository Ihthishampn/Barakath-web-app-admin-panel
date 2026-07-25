/**
 * Bootstrap the REAL project (barkath-25607) with the service-account key:
 *  - creates the first super-admin (Auth user + claims + admins/{uid} doc)
 *  - seeds the settings singletons + legal content pages
 * No demo catalogue data — this is a real database; categories/products are
 * added through the admin UI.
 *
 * Run:  ADMIN_EMAIL=you@x.com ADMIN_PASSWORD=Secret123 pnpm --filter @barkath/scripts bootstrap
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { ALL_ACTIONS_TRUE, MODULE_KEYS, buildSearchIndex, type ModulePermissions } from '@barkath/shared';

const KEY = '/home/h/barkath/.secrets/service-account.json';
const key = JSON.parse(readFileSync(KEY, 'utf8'));
initializeApp({ credential: cert(key), projectId: 'barkath-25607' });
const db = getFirestore();
const auth = getAuth();

// No fallbacks: this script bootstraps the REAL project, and a default password
// here is a default password on a live super-admin account.
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) {
  throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD before bootstrapping the real project.');
}
const NAME = process.env.ADMIN_NAME || 'Barkath Admin';

const now = Timestamp.now();
const inr = (r: number) => Math.round(r * 100);
const fullPerms = () =>
  Object.fromEntries(MODULE_KEYS.map((m) => [m, { ...ALL_ACTIONS_TRUE }])) as ModulePermissions;

async function bootstrapAdmin() {
  let user;
  try {
    user = await auth.createUser({ email: EMAIL, password: PASSWORD, displayName: NAME, emailVerified: true });
  } catch {
    user = await auth.getUserByEmail(EMAIL);
    await auth.updateUser(user.uid, { password: PASSWORD, displayName: NAME });
  }
  await auth.setCustomUserClaims(user.uid, { role: 'super_admin', status: 'active' });
  await db.doc(`admins/${user.uid}`).set({
    id: user.uid,
    uid: user.uid,
    name: NAME,
    email: EMAIL,
    emailVerified: true,
    phone: null,
    avatarUrl: null,
    role: 'super_admin',
    status: 'active',
    suspendedAt: null,
    suspendedByUid: null,
    suspendReason: null,
    modulePermissions: fullPerms(),
    mfaEnrolled: false,
    mfaMethod: null,
    mfaEnrolledAt: null,
    tokenRevokedAt: null,
    createdByUid: 'bootstrap',
    lastLoginAt: null,
    lastActiveAt: now,
    lastPasswordChangeAt: now,
    searchIndex: buildSearchIndex([NAME, EMAIL, 'super_admin']),
    createdAt: now,
    updatedAt: now,
  });
  return user.uid;
}

async function seedSettings() {
  const set = (id: string, data: Record<string, unknown>) =>
    db.doc(`settings/${id}`).set({ id, ...data, updatedAt: now }, { merge: true });

  await set('variables', {
    directUnits: [
      {
        id: 'color',
        name: 'Color',
        order: 0,
        units: [
          { id: 'green', name: 'Green', code: 'GR', hex: '#2f7a4f', order: 0 },
          { id: 'blue', name: 'Blue', code: 'BL', hex: '#2a6fdb', order: 1 },
          { id: 'ivory', name: 'Ivory', code: 'IV', hex: '#efe2cf', order: 2 },
          { id: 'black', name: 'Black', code: 'BK', hex: '#1a1a1a', order: 3 },
        ],
      },
    ],
    groups: [
      {
        id: 'size',
        name: 'Size',
        enabled: true,
        order: 0,
        units: [
          { id: 's', name: 'S', code: 'S', order: 0 },
          { id: 'm', name: 'M', code: 'M', order: 1 },
          { id: 'l', name: 'L', code: 'L', order: 2 },
          { id: 'xl', name: 'XL', code: 'XL', order: 3 },
        ],
      },
      {
        id: 'material',
        name: 'Material',
        enabled: true,
        order: 1,
        units: [
          { id: 'cotton', name: 'Cotton', code: 'COT', order: 0 },
          { id: 'silk', name: 'Silk', code: 'SLK', order: 1 },
          { id: 'linen', name: 'Linen', code: 'LIN', order: 2 },
        ],
      },
    ],
  });
  await set('delivery', { freeDeliveryOverPaise: inr(1499), standardFeePaise: inr(49), codSurchargePaise: inr(20), deliveryDaysMin: 2, deliveryDaysMax: 5 });
  await set('paymentGateway', { razorpayKeyId: '', codEnabled: true, codMaxAmountPaise: inr(5000), walletEnabled: true, onlinePaymentEnabled: true });
  await set('tax', { gstRate: 0.18, gstEnabled: true, gstin: '', legalName: 'Barkath Retail Pvt Ltd', businessCity: 'Bengaluru', businessCountry: 'India', pricesIncludeTax: true, hsnCodes: {} });
  await set('affiliate', { enabled: true, commissionClearanceDays: 7, minWithdrawalPaise: inr(500), maxWithdrawalPerDayPaise: inr(50000), processingFeeType: 'fixed', processingFeeValue: 0, processingFeeMinPaise: 0, shareMessage: 'Try Barkath — use my code {CODE}: barkath.com/r/{CODE}' });
  await set('returns', { windowDays: 7, autoRefundToWallet: true });
  await set('support', { supportEmail: 'help@barkath.app', supportPhone: '', supportHours: 'Mon–Sat 9 AM – 8 PM IST', supportEnabled: true });
  await set('announcement', { active: false, message: '', linkUrl: null, linkLabel: null, startsAt: null, endsAt: null });

  const content = (id: string, title: string) =>
    db.doc(`content/${id}`).set({ id, title, body: `# ${title}\n\nEdit this in the admin panel.`, bodyHtml: `<h1>${title}</h1>`, version: 1, lastEditorUid: 'bootstrap', publishedAt: now, updatedAt: now }, { merge: true });
  await content('privacyPolicy', 'Privacy Policy');
  await content('termsConditions', 'Terms & Conditions');
}

async function main() {
  console.log('Bootstrapping real project barkath-25607…');
  const uid = await bootstrapAdmin();
  await seedSettings();
  console.log('✔ Bootstrap complete.');
  console.log(`  Super-admin uid: ${uid}`);
  console.log(`  Login: ${EMAIL} / ${PASSWORD}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('Bootstrap failed:', e);
  process.exit(1);
});
