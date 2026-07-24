/**
 * Barkath — Firestore collection & subcollection path constants.
 * ID invariant: every doc has an `id` field equal to its Firestore doc ID (tech-arch §0.6).
 */

// ── Top-level collections ──────────────────────────────────────────
export const COLLECTIONS = {
  admins: 'admins',
  customers: 'customers',
  products: 'products',
  categories: 'categories',
  orders: 'orders',
  payments: 'payments',
  coupons: 'coupons',
  flashSales: 'flashSales',
  newArrivals: 'newArrivals',
  banners: 'banners',
  notifications: 'notifications', // admin broadcast records
  spinCampaigns: 'spinCampaigns',
  spinHistory: 'spinHistory',
  orderRequests: 'orderRequests', // returns
  withdrawalRequests: 'withdrawalRequests',
  commissions: 'commissions',
  reviews: 'reviews',
  supportTickets: 'supportTickets',
  pincodes: 'pincodes',
  fcmTokens: 'fcmTokens',
  complianceLogs: 'complianceLogs',
  auditLogs: 'auditLogs',
  pendingPayments: 'pendingPayments',
  idempotencyKeys: 'idempotencyKeys',
  settings: 'settings',
  content: 'content',
  documentVersions: 'documentVersions',
  counters: 'counters', // shortId sequence docs
} as const;

// ── Fixed singleton IDs ────────────────────────────────────────────
export const SETTINGS_DOCS = {
  announcement: 'announcement',
  hero: 'hero',
  delivery: 'delivery',
  paymentGateway: 'paymentGateway',
  affiliate: 'affiliate',
  returns: 'returns',
  tax: 'tax',
  support: 'support',
  searchSuggestions: 'searchSuggestions',
  variables: 'variables',
} as const;

export const CONTENT_DOCS = {
  privacyPolicy: 'privacyPolicy',
  termsConditions: 'termsConditions',
  aboutUs: 'aboutUs',
  helpCenter: 'helpCenter',
  contactUs: 'contactUs',
  returnsPolicy: 'returnsPolicy',
  shippingPolicy: 'shippingPolicy',
  faq: 'faq',
} as const;

// ── Subcollection path builders ────────────────────────────────────
export const subPaths = {
  orderItems: (orderId: string) => `${COLLECTIONS.orders}/${orderId}/items`,
  orderTimeline: (orderId: string) => `${COLLECTIONS.orders}/${orderId}/timeline`,
  categorySub: (categoryId: string) => `${COLLECTIONS.categories}/${categoryId}/subCategories`,
  productVariants: (productId: string) => `${COLLECTIONS.products}/${productId}/variants`,
  customerWishlist: (uid: string) => `${COLLECTIONS.customers}/${uid}/wishlist`,
  customerWalletTx: (uid: string) => `${COLLECTIONS.customers}/${uid}/walletTransactions`,
  customerCoupons: (uid: string) => `${COLLECTIONS.customers}/${uid}/coupons`,
  customerNotifications: (uid: string) => `${COLLECTIONS.customers}/${uid}/notifications`,
  ticketReplies: (ticketId: string) => `${COLLECTIONS.supportTickets}/${ticketId}/replies`,
  documentVersions: (docType: 'privacy' | 'terms') =>
    `${COLLECTIONS.documentVersions}/${docType}/versions`,
} as const;

// ── Storage paths ──────────────────────────────────────────────────
export const storagePaths = {
  productImage: (productId: string, file: string) => `products/${productId}/${file}`,
  productThumbs: (productId: string) => `products/${productId}/thumbs`,
  categoryImage: (categoryId: string, file: string) => `categories/${categoryId}/${file}`,
  bannerImage: (bannerId: string, file: string) => `banners/${bannerId}/${file}`,
  flashSaleImage: (saleId: string, file: string) => `flashSales/${saleId}/${file}`,
  invoice: (orderId: string) => `invoices/${orderId}.pdf`,
  returnPhoto: (requestId: string, n: number) => `orderRequests/${requestId}/photo-${n}.webp`,
  avatar: (uid: string) => `avatars/${uid}/avatar.webp`,
  adminAvatar: (uid: string) => `adminAvatars/${uid}/avatar.webp`,
  export: (exportId: string) => `exports/${exportId}`,
} as const;

export const PAGE_SIZE = 25 as const;
