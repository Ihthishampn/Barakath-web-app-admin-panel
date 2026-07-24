/**
 * Barkath — Firebase Emulator seed.
 *
 * Run against the emulator suite (never prod):
 *   firebase emulators:start           # in one terminal
 *   pnpm --filter @barkath/scripts seed # in another
 *
 * Creates a login-able super admin + sub admins, settings singletons, the four
 * categories, products, customers, orders, coupons, a spin campaign, a flash
 * sale, banners, withdrawal + return requests, and admin alerts.
 *
 * Login (admin panel):  admin@barkath.app / Barkath@123
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  ALL_ACTIONS_TRUE,
  ALL_ACTIONS_FALSE,
  MODULE_KEYS,
  buildSearchIndex,
  type ModuleKey,
  type ModulePermissions,
} from '@barkath/shared';

// ── Emulator wiring (guardrails against hitting prod) ──────────────
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'barkath-prod';

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();

// ── Helpers ────────────────────────────────────────────────────────
const now = new Date();
const ts = (d: Date = now) => Timestamp.fromDate(d);
const daysAgo = (n: number) => ts(new Date(now.getTime() - n * 864e5));
const daysAhead = (n: number) => ts(new Date(now.getTime() + n * 864e5));
const inr = (rupees: number) => Math.round(rupees * 100); // → paise
const pick = <T>(a: T[], i: number) => a[i % a.length]!;
const pad = (n: number, len = 5) => String(n).padStart(len, '0');

function fullPerms(): ModulePermissions {
  return Object.fromEntries(MODULE_KEYS.map((m) => [m, { ...ALL_ACTIONS_TRUE }])) as ModulePermissions;
}
// ModuleKey (not string) so a stale/renamed module name fails to compile
// instead of silently seeding an all-false permission block.
function scopedPerms(modules: ModuleKey[]): ModulePermissions {
  return Object.fromEntries(
    MODULE_KEYS.map((m) => [m, modules.includes(m) ? { ...ALL_ACTIONS_TRUE } : { ...ALL_ACTIONS_FALSE }]),
  ) as ModulePermissions;
}

async function upsertAdmin(opts: {
  email: string;
  password: string;
  name: string;
  role: 'super_admin' | 'sub_admin';
  perms: ModulePermissions;
  phone?: string;
}) {
  let user;
  try {
    user = await auth.createUser({ email: opts.email, password: opts.password, displayName: opts.name });
  } catch {
    user = await auth.getUserByEmail(opts.email);
    await auth.updateUser(user.uid, { password: opts.password, displayName: opts.name });
  }
  const uid = user.uid;
  await auth.setCustomUserClaims(uid, { role: opts.role, status: 'active' });
  await db.doc(`admins/${uid}`).set({
    id: uid,
    uid,
    name: opts.name,
    email: opts.email,
    emailVerified: true,
    phone: opts.phone ?? null,
    avatarUrl: null,
    role: opts.role,
    status: 'active',
    suspendedAt: null,
    suspendedByUid: null,
    suspendReason: null,
    modulePermissions: opts.perms,
    mfaEnrolled: false,
    mfaMethod: null,
    mfaEnrolledAt: null,
    tokenRevokedAt: null,
    createdByUid: 'seed',
    lastLoginAt: null,
    lastActiveAt: daysAgo(0),
    lastPasswordChangeAt: daysAgo(30),
    searchIndex: buildSearchIndex([opts.name, opts.email, opts.phone, opts.role]),
    createdAt: daysAgo(120),
    updatedAt: daysAgo(1),
  });
  return uid;
}

// ── 1. Admins ──────────────────────────────────────────────────────
async function seedAdmins() {
  const superUid = await upsertAdmin({
    email: 'admin@barkath.app',
    password: 'Barkath@123',
    name: 'Suresh Menon',
    role: 'super_admin',
    perms: fullPerms(),
    phone: '+919800000001',
  });
  await upsertAdmin({
    email: 'catalog@barkath.app',
    password: 'Barkath@123',
    name: 'Priya Nair',
    role: 'sub_admin',
    perms: scopedPerms(['dashboard', 'products', 'categories', 'inventory']),
    phone: '+919800000002',
  });
  await upsertAdmin({
    email: 'ops@barkath.app',
    password: 'Barkath@123',
    name: 'Arjun Rao',
    role: 'sub_admin',
    // module key is 'refunds' (MODULE_KEYS) — 'returns' would be silently dropped.
    perms: scopedPerms(['dashboard', 'orders', 'customers', 'payments', 'refunds']),
    phone: '+919800000003',
  });
  return superUid;
}

// ── 2. Settings singletons ─────────────────────────────────────────
async function seedSettings() {
  const set = (id: string, data: Record<string, unknown>) =>
    db.doc(`settings/${id}`).set({ id, ...data, updatedAt: daysAgo(2) });

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
          { id: 'sage', name: 'Sage', code: 'SG', hex: '#9bb08a', order: 4 },
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
  await set('delivery', {
    freeDeliveryOverPaise: inr(1499),
    standardFeePaise: inr(49),
    codSurchargePaise: inr(20),
    deliveryDaysMin: 2,
    deliveryDaysMax: 5,
  });
  await set('paymentGateway', {
    razorpayKeyId: 'rzp_test_XXXXXXXXXXXX',
    codEnabled: true,
    codMaxAmountPaise: inr(5000),
    walletEnabled: true,
    onlinePaymentEnabled: true,
  });
  await set('tax', {
    gstRate: 0.18,
    gstEnabled: true,
    gstin: '29AAAAA0000A1Z5',
    legalName: 'Barkath Retail Pvt Ltd',
    businessCity: 'Bengaluru',
    businessCountry: 'India',
    pricesIncludeTax: true,
    hsnCodes: { perfumes: '3303', books: '4901', clothing: '6109', islamic: '5701' },
  });
  await set('affiliate', {
    enabled: true,
    defaultCommissionRate: 0.05,
    commissionClearanceDays: 7,
    minWithdrawalPaise: inr(500),
    maxWithdrawalPerDayPaise: inr(50000),
    processingFeeType: 'fixed',
    processingFeeValue: 0,
    processingFeeMinPaise: 0,
    shareMessage: 'Try Barkath — use my code {CODE} for a special deal: barkath.com/r/{CODE}',
  });
  await set('returns', { windowDays: 7, autoRefundToWallet: true });
  await set('support', {
    supportEmail: 'help@barkath.app',
    supportPhone: '+91 80 4000 0000',
    supportHours: 'Mon–Sat 9 AM – 8 PM IST',
    supportEnabled: true,
  });
  await set('announcement', {
    active: true,
    items: [
      { id: 'a_seed_1', message: 'Free delivery on Eid orders over ₹1,499', linkUrl: '/listing', linkLabel: 'Shop the collection' },
      { id: 'a_seed_2', message: 'New arrivals just dropped — explore the latest', linkUrl: '/listing', linkLabel: 'View all' },
    ],
    message: 'Free delivery on Eid orders over ₹1,499 · Shop the collection',
    linkUrl: '/collection/eid',
    linkLabel: 'Shop the collection',
    startsAt: null,
    endsAt: null,
  });

  // Content/policy pages carry the full dynamic-page schema (slug, order,
  // published, system, sections) so a fresh seed mirrors production — the
  // storefront resolves these by slug and renders one chip per published page.
  const content = (
    id: string,
    title: string,
    slug: string,
    order: number,
    sections: { id: string; heading: string; body: string; order: number }[],
  ) => {
    const body = sections.map((s) => `## ${s.heading}\n${s.body}`).join('\n\n');
    return db.doc(`content/${id}`).set({
      id,
      title,
      slug,
      order,
      published: true,
      system: true,
      sections,
      body,
      bodyHtml: '',
      version: 1,
      lastEditorUid: 'seed',
      publishedAt: daysAgo(30),
      updatedAt: daysAgo(30),
    });
  };
  await content('privacyPolicy', 'Privacy policy', 'privacy-policy', 10, [
    { id: 'sec_1', heading: 'Information we collect', body: 'Barakath collects your name, mobile number, delivery addresses and order history to fulfil your orders.', order: 10 },
  ]);
  await content('termsConditions', 'Terms & conditions', 'terms-conditions', 20, [
    { id: 'sec_1', heading: 'Acceptance', body: 'By using Barakath you agree to these terms and conditions.', order: 10 },
  ]);
  await content('returnsPolicy', 'Return policy', 'return-policy', 30, [
    { id: 'sec_1', heading: 'Returns', body: 'Most items can be returned within the return window shown on your order, provided they are unused and in their original packaging.', order: 10 },
    { id: 'sec_2', heading: 'Refunds', body: 'Approved refunds are credited to your Barakath wallet, usually within 24 hours.', order: 20 },
  ]);
}

// ── 3. Categories ──────────────────────────────────────────────────
const CATEGORIES = [
  { id: 'perfumes', name: 'Perfumes', tint: '#e6cfb4', tag: 'amber', subs: ['Oud', 'Attar', 'Musk', 'EDP'] },
  { id: 'books', name: 'Books', tint: '#9bb08a', tag: 'green', subs: ['Islamic', 'Fiction', 'Kids'] },
  { id: 'clothing', name: 'Clothing', tint: '#e6d8c4', tag: 'amber', subs: ['Abaya', 'Kurta', 'Hijab'] },
  { id: 'islamic', name: 'Islamic', tint: '#c9d6de', tag: 'blue', subs: ['Mats', 'Tasbih', 'Gifts'] },
] as const;

async function seedCategories() {
  for (const [ci, c] of CATEGORIES.entries()) {
    await db.doc(`categories/${c.id}`).set({
      id: c.id,
      slug: c.id,
      name: c.name,
      displayName: c.name,
      description: `${c.name} — curated collection.`,
      categoryTint: c.tint,
      categoryTagColor: c.tag,
      iconUrl: null,
      heroImageUrl: null,
      order: ci,
      visibility: 'visible',
      productCount: 3,
      subCategories: c.subs.map((s, i) => ({
        id: s.toLowerCase(),
        slug: s.toLowerCase(),
        name: s,
        order: i,
        visibility: 'visible',
        productCount: 1,
      })),
      seoTitle: c.name,
      seoDescription: `${c.name} at Barkath`,
      createdAt: daysAgo(100),
      updatedAt: daysAgo(10),
    });
  }
}

// ── 4. Products ────────────────────────────────────────────────────
async function seedProducts() {
  const names = [
    ['Amber Oud EDP', 'Amber Oud — Eau de Parfum', 'perfumes', 'oud', 12000, 8900],
    ['Musk Al Tahara', 'Musk Al Tahara Attar', 'perfumes', 'musk', 6000, 4500],
    ['Royal Attar', 'Royal Attar — Concentrated', 'perfumes', 'attar', 9000, 6900],
    ['The Sealed Nectar', 'The Sealed Nectar (Ar-Raheeq)', 'books', 'islamic', 8000, 5900],
    ['Kids Quran Stories', 'Kids Quran Stories — Illustrated', 'books', 'kids', 4500, 3200],
    ['Fiction Anthology', 'Modern Fiction Anthology', 'books', 'fiction', 5500, 3900],
    ['Linen Kurta Set', 'Linen Kurta Set — Ivory', 'clothing', 'kurta', 15000, 11900],
    ['Premium Abaya', 'Premium Abaya — Black', 'clothing', 'abaya', 22000, 17900],
    ['Silk Hijab', 'Silk Hijab — Sage', 'clothing', 'hijab', 4000, 2900],
    ['Prayer Mat Premium', 'Prayer Mat — Premium Emerald', 'islamic', 'mats', 7000, 4900],
    ['Tasbih Amber', 'Tasbih — Amber Beads', 'islamic', 'tasbih', 3000, 1900],
    ['Gift Hamper', 'Islamic Gift Hamper', 'islamic', 'gifts', 18000, 13900],
  ] as const;

  for (const [i, [name, title, cat, sub, mrp, offer]] of names.entries()) {
    const catDef = CATEGORIES.find((c) => c.id === cat)!;
    const hasVar = cat === 'clothing';
    const variants = hasVar
      ? ['S', 'M', 'L'].map((sz, vi) => ({
          id: sz.toLowerCase(),
          label: sz,
          mrpPaise: mrp,
          offerPricePaise: offer,
          stock: 10 - vi * 3,
          sku: `BRK-${pad(i + 1, 3)}-${sz}`,
          referralPricePaise: Math.round(offer * 0.95),
          commissionPaise: Math.round(offer * 0.05),
          weight: 300,
          visibility: 'visible',
          attributes: { size: sz.toLowerCase() },
        }))
      : [];
    const kw = [name.split(' ')[0]!.toLowerCase(), cat, sub];
    await db.doc(`products/${i + 1}`).set({
      id: String(i + 1),
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      displayTitle: title,
      description: `${title}. A premium Barkath product.`,
      categoryId: cat,
      categorySlug: cat,
      categoryTint: catDef.tint,
      subCategoryId: sub,
      subCategorySlug: sub,
      images: [],
      videoUrl: null,
      mrpPaise: mrp,
      offerPricePaise: offer,
      discountPercent: Math.round(((mrp - offer) / mrp) * 100),
      hasVariants: hasVar,
      variants,
      stock: hasVar ? 0 : [2, 40, 0][i % 3], // seed a low-stock + out-of-stock case
      lowStockThreshold: 5,
      specifications: [{ id: 's1', key: 'Category', value: catDef.name }],
      fbt: [],
      combo: { enabled: false, deliveryChargePaise: 0, itemIds: [] },
      status: 'published',
      visibility: 'visible',
      isNewArrival: i < 4,
      isBestSeller: i % 4 === 0,
      isFeatured: i === 0,
      returnAvailable: true,
      codAvailable: true,
      isAffiliateEligible: true,
      affiliateCommissionRate: null,
      seoTitle: name,
      seoDescription: title,
      searchKeywords: kw,
      searchIndex: buildSearchIndex([name, title, ...kw]),
      rating: 4 + (i % 10) / 10,
      ratingCount: 10 + i * 3,
      soldCount: 100 - i * 5,
      newArrivalOrder: i < 4 ? i : null,
      bestSellerOrder: i % 4 === 0 ? i : null,
      hsnCode: null,
      taxIncluded: true,
      createdBy: 'seed',
      updatedBy: 'seed',
      publishedAt: daysAgo(60 - i),
      createdAt: daysAgo(60 - i),
      updatedAt: daysAgo(5),
      deletedAt: null,
    });
  }
}

// ── 5. Customers ───────────────────────────────────────────────────
const CUSTOMERS = [
  { name: 'Mira Osei', phone: '+919876543210', affiliate: true, code: 'MIRA-7Q2K' },
  { name: 'Aisha Khan', phone: '+919876543211', affiliate: true, code: 'AISHA-3XP2' },
  { name: 'Yusuf Ali', phone: '+919876543212', affiliate: false },
  { name: 'Fatima Noor', phone: '+919876543213', affiliate: false },
  { name: 'Imran Sheikh', phone: '+919876543214', affiliate: false },
  { name: 'Zara Begum', phone: '+919876543215', affiliate: false },
  { name: 'Bilal Ahmed', phone: '+919876543216', affiliate: false },
  { name: 'Hana Malik', phone: '+919876543217', affiliate: false },
];

async function seedCustomers() {
  for (const [i, c] of CUSTOMERS.entries()) {
    const uid = `cust_${pad(i + 1, 3)}`;
    const bal = inr([320, 850, 0, 120, 500, 0, 260, 90][i]!);
    await db.doc(`customers/${uid}`).set({
      id: uid,
      uid,
      phone: c.phone,
      phoneVerified: true,
      name: c.name,
      email: `${c.name.split(' ')[0]!.toLowerCase()}@example.com`,
      emailVerified: false,
      gstin: null,
      avatarUrl: null,
      profileComplete: true,
      profileSkipped: false,
      role: c.affiliate ? 'affiliate' : 'customer',
      isBlocked: false,
      blockReason: null,
      blockedAt: null,
      blockedByUid: null,
      wallet: {
        balancePaise: bal,
        breakdown: {
          refundsPaise: Math.round(bal * 0.4),
          rewardsPaise: Math.round(bal * 0.3),
          cashbackPaise: Math.round(bal * 0.3),
          topupPaise: 0,
        },
        lifetimeCreditsPaise: bal + inr(200),
        lifetimeDebitsPaise: inr(200),
        lastTransactionAt: daysAgo(i + 1),
      },
      affiliate: c.affiliate
        ? {
            enabled: true,
            enabledAt: daysAgo(80),
            referralCode: c.code,
            commissionRate: 0.05,
            pendingBalancePaise: inr(3200),
            confirmedBalancePaise: inr(9280),
            withdrawnBalancePaise: inr(4000),
            lifetimeEarningsPaise: inr(16480),
            referredCount: 12,
            activeReferredCount: 8,
            lastCommissionAt: daysAgo(3),
            hasPendingWithdrawal: i === 0,
          }
        : null,
      referredBy: null,
      preferences: {
        notificationsEnabled: true,
        notifyOrderUpdates: true,
        notifyPromotions: true,
        notifyAffiliateEarnings: true,
        notifyWalletActivity: true,
      },
      stats: {
        ordersCount: 3 + i,
        ordersDelivered: 2 + i,
        ordersCancelled: i % 3 === 0 ? 1 : 0,
        ordersReturned: 0,
        totalSpentPaise: inr(1200 + i * 300),
        firstOrderAt: daysAgo(90),
        lastOrderAt: daysAgo(i + 1),
        reviewsCount: i % 2,
        wishlistCount: i,
        unreadNotifications: i % 3,
      },
      cart: [],
      addresses: [
        {
          id: 'addr1',
          label: 'Home',
          name: c.name,
          phone: c.phone,
          line1: `${42 + i} Marine Drive`,
          line2: 'Ernakulam',
          city: 'Kochi',
          state: 'Kerala',
          pincode: '682001',
          country: 'India',
          latitude: null,
          longitude: null,
          isDefault: true,
          createdAt: daysAgo(90),
          updatedAt: daysAgo(90),
        },
      ],
      bankAccounts: c.affiliate
        ? [
            {
              id: 'bank1',
              accountHolderName: c.name,
              accountNumberMasked: '•••• 4821',
              ifsc: 'HDFC0001234',
              bankName: 'HDFC Bank',
              branch: 'Kochi',
              isDefault: true,
              verifiedAt: daysAgo(70),
              createdAt: daysAgo(75),
              updatedAt: daysAgo(70),
            },
          ]
        : [],
      lastLoginAt: daysAgo(i),
      lastActiveAt: daysAgo(i),
      searchIndex: buildSearchIndex([c.name, c.phone, `${c.name.split(' ')[0]}@example.com`, c.code]),
      createdAt: daysAgo(90),
      updatedAt: daysAgo(i),
    });

    // A couple of wallet transactions for the profile Wallet tab.
    for (let t = 0; t < 2; t++) {
      const txRef = db.collection(`customers/${uid}/walletTransactions`).doc();
      await txRef.set({
        id: txRef.id,
        type: t === 0 ? 'credit' : 'debit',
        source: t === 0 ? 'refund' : 'order_payment',
        amountPaise: inr(100 + t * 50),
        balanceAfterPaise: bal,
        orderId: null,
        orderShortId: `#BRK-${pad(47000 + i)}`,
        couponId: null,
        refundRequestId: null,
        razorpayOrderId: null,
        razorpayPaymentId: null,
        adjustedByUid: null,
        adjustmentReason: null,
        title: t === 0 ? `Refund · Order #BRK-${pad(47000 + i)}` : `Paid · Order #BRK-${pad(48000 + i)}`,
        description: null,
        createdAt: daysAgo(i + t + 1),
      });
    }
  }
}

// ── 6. Orders ──────────────────────────────────────────────────────
const STATUSES = ['accepted', 'packing', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'] as const;

async function seedOrders() {
  for (let i = 0; i < 15; i++) {
    const cust = pick(CUSTOMERS, i);
    const custUid = `cust_${pad((i % CUSTOMERS.length) + 1, 3)}`;
    const status = pick([...STATUSES], i);
    const shortId = `#BRK-${pad(48200 + i)}`;
    const method = pick(['razorpay', 'cod', 'wallet'] as const, i);
    const subtotal = inr(500 + i * 120);
    const discount = i % 3 === 0 ? inr(30) : 0;
    const delivery = subtotal >= inr(1499) ? 0 : inr(49);
    const tax = Math.round((subtotal - discount) * 0.18 / 1.18);
    const total = subtotal - discount + delivery;
    const orderId = `order_${pad(i + 1, 3)}`;
    // First few orders are dated today so "Today's revenue" is non-empty.
    const orderAge = i < 3 ? 0 : i;

    await db.doc(`orders/${orderId}`).set({
      id: orderId,
      shortId,
      customerId: custUid,
      customerName: cust.name,
      customerPhone: cust.phone,
      status,
      itemsCount: 1 + (i % 3),
      itemsSummary: [
        {
          productId: String((i % 12) + 1),
          productName: 'Amber Oud EDP',
          imageUrl: '',
          categoryTint: '#e6cfb4',
          quantity: 1 + (i % 3),
        },
      ],
      subtotalPaise: subtotal,
      discountPaise: discount,
      spinRewardPaise: 0,
      walletUsedPaise: method === 'wallet' ? total : 0,
      deliveryPaise: delivery,
      codSurchargePaise: method === 'cod' ? inr(20) : 0,
      taxPaise: tax,
      totalPaise: total,
      amountPaidPaise: method === 'wallet' ? 0 : total,
      paymentMethod: method,
      paymentStatus: status === 'cancelled' ? 'refunded' : method === 'cod' ? 'pending' : 'captured',
      razorpayOrderId: method === 'razorpay' ? `order_rzp_${i}` : null,
      razorpayPaymentId: method === 'razorpay' ? `pay_R8x2K${i}` : null,
      razorpaySignature: null,
      appliedCoupon:
        discount > 0
          ? { code: 'WELCOME30', couponId: 'coupon_1', userCouponId: null, discountPaise: discount, source: 'promotional' }
          : null,
      deliveryAddress: {
        label: 'Home',
        name: cust.name,
        phone: cust.phone,
        line1: `${42 + i} Marine Drive`,
        line2: 'Ernakulam',
        city: 'Kochi',
        state: 'Kerala',
        pincode: '682001',
        country: 'India',
      },
      courier: status === 'shipped' || status === 'out_for_delivery' ? 'BlueDart' : null,
      trackingId: status === 'shipped' || status === 'out_for_delivery' ? `AWB${pad(90000 + i)}` : null,
      rider:
        status === 'out_for_delivery'
          ? { name: 'Suresh', phone: '+919812345678', currentDistanceKm: 2.4 }
          : null,
      shippedAt: ['shipped', 'out_for_delivery', 'delivered'].includes(status) ? daysAgo(2) : null,
      outForDeliveryAt: ['out_for_delivery', 'delivered'].includes(status) ? daysAgo(1) : null,
      deliveredAt: status === 'delivered' ? daysAgo(1) : null,
      expectedDeliveryDate: daysAhead(2),
      cancelledAt: status === 'cancelled' ? daysAgo(1) : null,
      cancellationReason: status === 'cancelled' ? 'Changed my mind' : null,
      cancelledByUid: status === 'cancelled' ? custUid : null,
      referredByAffiliateUid: null,
      affiliateCommissionPaise: 0,
      affiliateCommissionStatus: null,
      placementNonce: `nonce_${i}`,
      customerNote: null,
      adminNote: null,
      invoiceUrl: null,
      invoiceGeneratedAt: null,
      searchIndex: buildSearchIndex([cust.name, cust.phone, shortId, 'Kochi']),
      placedAt: daysAgo(orderAge),
      createdAt: daysAgo(orderAge),
      updatedAt: daysAgo(orderAge),
    });

    // items embedded on the order document (single-document model) + timeline subcollection
    await db.doc(`orders/${orderId}`).set(
      {
        items: [
          {
            id: 'item1',
            productId: String((i % 12) + 1),
            productName: 'Amber Oud EDP',
            productDisplayTitle: 'Amber Oud — Eau de Parfum',
            imageUrl: '',
            categoryTint: '#e6cfb4',
            category: 'Perfumes',
            variantId: null,
            variantLabel: '50ml',
            quantity: 1 + (i % 3),
            mrpPaise: inr(120),
            offerPricePaise: inr(89),
            lineTotalPaise: inr(89) * (1 + (i % 3)),
            discountAppliedPaise: discount,
            taxPaise: tax,
            hsnCode: '3303',
            weight: 200,
            returnStatus: 'none',
            returnRequestId: null,
            reviewSubmitted: false,
            reviewId: null,
          },
        ],
      },
      { merge: true },
    );
    const reached = STATUSES.slice(0, STATUSES.indexOf(status) + 1);
    for (const [ti, st] of reached.entries()) {
      if (st === 'cancelled' && status !== 'cancelled') continue;
      const tRef = db.collection(`orders/${orderId}/timeline`).doc();
      await tRef.set({
        id: tRef.id,
        status: st,
        at: daysAgo(reached.length - ti),
        byUid: 'seed',
        byName: 'System',
        note: null,
        meta: {},
        createdAt: daysAgo(reached.length - ti),
      });
    }

    // payment record
    await db.doc(`payments/${orderId}`).set({
      id: orderId,
      orderId,
      customerId: custUid,
      method,
      gateway: method === 'razorpay' ? 'razorpay' : null,
      status: status === 'cancelled' ? 'refunded' : method === 'cod' ? 'pending' : 'captured',
      amountPaise: total,
      gatewayRef: method === 'razorpay' ? `pay_R8x2K${i}` : method === 'cod' ? `cod_${pad(841 + i)}` : null,
      createdAt: daysAgo(i + 1),
      updatedAt: daysAgo(i + 1),
    });
  }
}

// ── 7. Coupons ─────────────────────────────────────────────────────
async function seedCoupons() {
  const coupons = [
    { id: 'coupon_1', code: 'WELCOME30', title: 'Welcome offer', type: 'flat', val: inr(30), pct: 0 },
    // discountPercent is a whole percent (0..100), not a fraction — readers do `subtotal * pct / 100`.
    { id: 'coupon_2', code: 'EID15', title: 'Eid 15% off', type: 'percent', val: 0, pct: 15 },
    { id: 'coupon_3', code: 'FREESHIP', title: 'Free shipping', type: 'free_shipping', val: 0, pct: 0 },
  ];
  for (const c of coupons) {
    await db.doc(`coupons/${c.id}`).set({
      id: c.id,
      code: c.code,
      title: c.title,
      description: `${c.title} — auto-seeded.`,
      discountType: c.type,
      discountValuePaise: c.val,
      discountPercent: c.pct,
      discountMaxCapPaise: c.type === 'percent' ? inr(200) : null,
      minCartValuePaise: inr(150),
      maxUsesPerUser: 1,
      maxUsesTotal: 1000,
      usesCount: 42,
      applicableCategories: [],
      applicableProducts: [],
      excludedProducts: [],
      firstOrderOnly: c.code === 'WELCOME30',
      validFrom: daysAgo(30),
      validUntil: daysAhead(30),
      active: true,
      status: 'active',
      targetUsers: 'all',
      createdBy: 'seed',
      searchIndex: buildSearchIndex([c.code, c.title]),
      createdAt: daysAgo(30),
      updatedAt: daysAgo(5),
    });
  }
}

// ── 8. Spin campaign, flash sale, banners ──────────────────────────
async function seedGrowth() {
  await db.doc('spinCampaigns/camp_1').set({
    id: 'camp_1',
    name: 'August spin campaign',
    status: 'active',
    startsAt: daysAgo(10),
    endsAt: daysAhead(20),
    slices: [
      { id: 's1', order: 0, prizeType: 'flat_discount', discountValuePaise: inr(10), discountPercent: null, discountMaxCapPaise: null, minCartValuePaise: inr(99), couponTemplateCode: 'SPIN', validityDays: 3, weight: 30, displayLabel: '₹10 off', secondaryLabel: 'Min ₹99', usedCount: 120 },
      { id: 's2', order: 1, prizeType: 'percent_discount', discountValuePaise: null, discountPercent: 15, discountMaxCapPaise: inr(200), minCartValuePaise: inr(999), couponTemplateCode: 'SPIN', validityDays: 3, weight: 15, displayLabel: '15% off', secondaryLabel: 'Max ₹200', usedCount: 40 },
      { id: 's3', order: 2, prizeType: 'cashback', discountValuePaise: inr(50), discountPercent: null, discountMaxCapPaise: null, minCartValuePaise: 0, couponTemplateCode: null, validityDays: 0, weight: 10, displayLabel: '₹50 cashback', secondaryLabel: 'To wallet', usedCount: 22 },
      { id: 's4', order: 3, prizeType: 'flat_discount', discountValuePaise: inr(100), discountPercent: null, discountMaxCapPaise: null, minCartValuePaise: inr(999), couponTemplateCode: 'SPIN', validityDays: 3, weight: 5, displayLabel: '₹100 off', secondaryLabel: 'Min ₹999', usedCount: 8 },
      { id: 's5', order: 4, prizeType: 'better_luck', discountValuePaise: null, discountPercent: null, discountMaxCapPaise: null, minCartValuePaise: 0, couponTemplateCode: null, validityDays: 0, weight: 30, displayLabel: 'Better luck', secondaryLabel: 'Try tomorrow', usedCount: 200 },
      { id: 's6', order: 5, prizeType: 'free_shipping', discountValuePaise: null, discountPercent: null, discountMaxCapPaise: null, minCartValuePaise: 0, couponTemplateCode: 'SHIP', validityDays: 3, weight: 10, displayLabel: 'Free ship', secondaryLabel: 'Any order', usedCount: 30 },
    ],
    spinsPerUserPerDay: 1,
    cooldownHours: 24,
    spinsPerDay: 3,
    rewardCouponExpiryDays: 3,
    eligibility: 'all',
    totalSpins: 420,
    totalCouponsIssued: 220,
    totalCashbackPaidPaise: inr(1100),
    createdBy: 'seed',
    createdAt: daysAgo(12),
    updatedAt: daysAgo(1),
  });

  await db.doc('flashSales/flash_1').set({
    id: 'flash_1',
    name: 'Eid weekend sale',
    status: 'active',
    startsAt: daysAgo(1),
    endsAt: daysAhead(1),
    bannerImageUrl: null,
    productIds: ['1', '2', '7'],
    overrides: {
      '1': { salePricePaise: inr(62), discountPercent: 30, maxUnitsPerCustomer: 2, totalUnitsAllowed: 100, unitsSold: 12 },
    },
    visibility: 'visible',
    createdBy: 'seed',
    createdAt: daysAgo(3),
    updatedAt: daysAgo(1),
  });

  for (const [i, placement] of (['app', 'website'] as const).entries()) {
    await db.doc(`banners/banner_${i + 1}`).set({
      id: `banner_${i + 1}`,
      placement,
      imageUrl: '',
      title: `${placement === 'app' ? 'App' : 'Website'} hero banner`,
      attachedProductId: '1',
      publishLive: true,
      order: i,
      createdAt: daysAgo(20),
      updatedAt: daysAgo(2),
    });
  }

  await db.doc('newArrivals/na_1').set({
    id: 'na_1', productId: '1', order: 0, status: 'visible', createdAt: daysAgo(10), updatedAt: daysAgo(10),
  });
}

// ── 9. Withdrawals + returns + alerts ──────────────────────────────
async function seedRequests(superUid: string) {
  await db.doc('withdrawalRequests/wd_1').set({
    id: 'wd_1',
    shortId: '#WD-00042',
    customerId: 'cust_001',
    customerName: 'Mira Osei',
    customerPhone: '+919876543210',
    requestedAmountPaise: inr(5000),
    processingFeePaise: 0,
    netPayoutPaise: inr(5000),
    bankAccount: { id: 'bank1', holderName: 'Mira Osei', accountNumberLast4: '4821', ifsc: 'HDFC0001234', bankName: 'HDFC Bank' },
    status: 'pending',
    statusHistory: [{ status: 'pending', at: daysAgo(1), byUid: 'cust_001', note: null }],
    rejectionReason: null,
    paymentReference: null,
    processedAt: null,
    processedByUid: null,
    nonce: 'wd_nonce_1',
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  });

  await db.doc('orderRequests/rp_1').set({
    id: 'rp_1',
    shortId: '#RP-00123',
    type: 'return',
    customerId: 'cust_003',
    orderId: 'order_006',
    orderShortId: '#BRK-48205',
    itemId: 'item1',
    itemSnapshot: { productId: '1', productName: 'Amber Oud EDP', variantLabel: '50ml', quantity: 1, priceAtPurchasePaise: inr(89) },
    reasonKey: 'damaged',
    reasonLabel: 'Item damaged / defective',
    note: 'Bottle cracked on arrival.',
    photoUrls: [],
    status: 'pending',
    statusHistory: [{ status: 'pending', at: daysAgo(1), byUid: 'cust_003', note: null }],
    rejectionReason: null,
    refundMethod: null,
    refundAmountPaise: null,
    refundTransactionId: null,
    refundedAt: null,
    nonce: 'rp_nonce_1',
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  });

  const alerts = [
    { type: 'new_order', title: 'New order', body: 'Order #BRK-48214 placed', deepLink: '/orders' },
    { type: 'withdrawal_request', title: 'Withdrawal request', body: '₹5,000 from Mira Osei', deepLink: '/affiliate' },
    { type: 'return_request', title: 'New return request', body: '#RP-00123 pending review', deepLink: '/returns' },
    { type: 'low_stock', title: 'Low stock', body: 'Amber Oud EDP · 2 left', deepLink: '/inventory' },
  ];
  for (const [i, a] of alerts.entries()) {
    const ref = db.doc(`adminAlerts/${superUid}/alerts/alert_${i + 1}`);
    await ref.set({ id: `alert_${i + 1}`, ...a, read: false, createdAt: daysAgo(i) });
  }
}

// ── Run ────────────────────────────────────────────────────────────
async function main() {
  console.log(`Seeding Barkath emulator (project=${PROJECT_ID})…`);
  const superUid = await seedAdmins();
  await seedSettings();
  await seedCategories();
  await seedProducts();
  await seedCustomers();
  await seedOrders();
  await seedCoupons();
  await seedGrowth();
  await seedRequests(superUid);
  console.log('✔ Seed complete.');
  console.log('  Admin login → admin@barkath.app / Barkath@123 (super_admin)');
  console.log('  Sub-admins  → catalog@barkath.app, ops@barkath.app / Barkath@123');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  });
