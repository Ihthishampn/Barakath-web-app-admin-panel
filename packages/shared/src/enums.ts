/**
 * Barkath — canonical enums & constants.
 * Single source of truth shared by admin, web, and Cloud Functions.
 * Enum string values are lowercase snake_case (tech-arch §0.5).
 */

// ── Currency / locale ──────────────────────────────────────────────
export const CURRENCY = 'INR' as const;
export const LOCALE = 'en-IN' as const;
export const BUSINESS_TIMEZONE = 'Asia/Kolkata' as const;
export const COUNTRY = 'India' as const;
export const ORDER_ID_PREFIX = 'BRK' as const; // #BRK-XXXXXX

// ── Order status (backend enum — 7 states, tech-arch §1.6a) ─────────
export const ORDER_STATUSES = [
  'accepted',
  'packing',
  'packed',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Admin list tabs collapse the 7 backend states into 6 buckets (§1.6a). */
export const ADMIN_ORDER_TABS = [
  'all',
  'accepted',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
] as const;
export type AdminOrderTab = (typeof ADMIN_ORDER_TABS)[number];

/** Backend status → admin tab bucket. */
export const ORDER_STATUS_TO_ADMIN_TAB: Record<OrderStatus, Exclude<AdminOrderTab, 'all'>> = {
  accepted: 'accepted',
  packing: 'accepted',
  packed: 'packed',
  shipped: 'shipped',
  out_for_delivery: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

/** Valid forward transitions (server-enforced; no skipping, cancel from early states). */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  accepted: ['packing', 'cancelled'],
  packing: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  // An ADMIN may cancel a parcel that is already with the courier — a shipment
  // lost or damaged in transit has to be refundable and restockable from the
  // panel. Without this the only outcomes were "mark it delivered" (a lie that
  // silently opens the return window) or leave it stuck for ever.
  //
  // This is the ADMIN graph. Customers are bounded separately by
  // CANCELLABLE_STATUSES below, which deliberately stops at 'packed' — once a
  // parcel is with the courier the customer must go through returns, not a
  // self-service cancel.
  shipped: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

/** What a CUSTOMER may cancel themselves — narrower than the admin graph above. */
export const CANCELLABLE_STATUSES: OrderStatus[] = ['accepted', 'packing', 'packed'];

// ── Payments ───────────────────────────────────────────────────────
/**
 * 'cod' is READ-ONLY history. Cash on delivery has been withdrawn — placeOrder
 * rejects it — but orders placed before that still carry it, and they are still
 * displayed, delivered (COD captures on delivery), cancelled and refunded. It
 * stays in the union so reading those documents type-checks; never offer it as a
 * choice at checkout.
 */
export const PAYMENT_METHODS = ['razorpay', 'cod', 'wallet'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = [
  'pending',
  'captured',
  'failed',
  'refunded',
  'partial_refund',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// ── Coupons ────────────────────────────────────────────────────────
export const DISCOUNT_TYPES = ['flat', 'percent', 'free_shipping'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const COUPON_STATUSES = ['active', 'scheduled', 'paused', 'expired'] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

export const COUPON_TARGETS = ['all', 'new', 'existing', 'affiliates', 'segment'] as const;
export type CouponTarget = (typeof COUPON_TARGETS)[number];

// ── User coupons (wallet) ──────────────────────────────────────────
export const USER_COUPON_STATUSES = ['active', 'used', 'expired'] as const;
export type UserCouponStatus = (typeof USER_COUPON_STATUSES)[number];

export const USER_COUPON_SOURCES = [
  'spin',
  'welcome',
  'referral_bonus',
  'admin_grant',
  'promo',
] as const;
export type UserCouponSource = (typeof USER_COUPON_SOURCES)[number];

// ── Wallet ledger ──────────────────────────────────────────────────
export const WALLET_TX_TYPES = ['credit', 'debit'] as const;
export type WalletTxType = (typeof WALLET_TX_TYPES)[number];

export const WALLET_TX_SOURCES = [
  'refund',
  'spin_reward',
  'cashback',
  'topup',
  'admin_adjust',
  'order_payment',
  'withdrawal',
] as const;
export type WalletTxSource = (typeof WALLET_TX_SOURCES)[number];

// ── Returns (Replacement removed — project correction) ─────────────
/** orderRequests.type — Return only. No 'replacement'. */
export const ORDER_REQUEST_TYPES = ['return'] as const;
export type OrderRequestType = (typeof ORDER_REQUEST_TYPES)[number];

export const ORDER_REQUEST_STATUSES = [
  'pending',
  'under_review',
  'approved',
  'rejected',
  'completed',
  'cancelled',
] as const;
export type OrderRequestStatus = (typeof ORDER_REQUEST_STATUSES)[number];

/** Customer-facing return reasons (§8.5 user app). */
export const RETURN_REASONS = [
  { key: 'damaged', label: 'Item damaged / defective' },
  { key: 'wrong_item', label: 'Wrong item delivered' },
  { key: 'missing_item', label: 'Missing item / parts' },
  { key: 'not_as_described', label: "Doesn't match description" },
  { key: 'other', label: 'Other' },
] as const;

/** Admin rejection reasons for a return (§6.8). */
export const RETURN_REJECTION_REASONS = [
  'Out of window',
  'Used product',
  'Not eligible',
  'Other',
] as const;

export const ITEM_RETURN_STATUSES = [
  'none',
  'requested',
  'approved',
  'rejected',
  'completed',
] as const;
export type ItemReturnStatus = (typeof ITEM_RETURN_STATUSES)[number];

// ── Affiliate ──────────────────────────────────────────────────────
export const COMMISSION_STATUSES = ['pending', 'confirmed', 'paid', 'cancelled'] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const WITHDRAWAL_STATUSES = [
  'pending',
  'approved',
  'processing',
  'paid',
  'rejected',
  'cancelled',
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const WITHDRAWAL_REJECTION_REASONS = [
  'Insufficient balance',
  'Bank details invalid',
  'Suspected fraud',
  'Other',
] as const;

// ── Spinner ────────────────────────────────────────────────────────
export const SPIN_CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'ended'] as const;
export type SpinCampaignStatus = (typeof SPIN_CAMPAIGN_STATUSES)[number];

export const SPIN_PRIZE_TYPES = [
  'flat_discount',
  'percent_discount',
  'cashback',
  'free_shipping',
  'better_luck',
] as const;
export type SpinPrizeType = (typeof SPIN_PRIZE_TYPES)[number];

// ── Flash sale ─────────────────────────────────────────────────────
export const FLASH_SALE_STATUSES = ['scheduled', 'active', 'ended', 'cancelled'] as const;
export type FlashSaleStatus = (typeof FLASH_SALE_STATUSES)[number];

// ── Products ───────────────────────────────────────────────────────
export const PRODUCT_STATUSES = ['draft', 'published', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const VISIBILITY = ['visible', 'hidden'] as const;
export type Visibility = (typeof VISIBILITY)[number];

// ── Categories (the four canonical top-level slugs) ────────────────
export const CATEGORY_KEYS = ['perfumes', 'books', 'clothing', 'islamic'] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

// ── Customers ──────────────────────────────────────────────────────
export const CUSTOMER_ROLES = ['customer', 'affiliate'] as const;
export type CustomerRole = (typeof CUSTOMER_ROLES)[number];

// ── Banners ────────────────────────────────────────────────────────
export const BANNER_PLACEMENTS = ['app', 'website'] as const;
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];

// ── Notifications (admin broadcast) ────────────────────────────────
export const NOTIFICATION_AUDIENCES = [
  'all',
  'new',
  'active_30d',
  'order_updates',
  'affiliates',
  'segment',
] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export const NOTIFICATION_SEND_MODES = ['now', 'scheduled', 'automated'] as const;
export type NotificationSendMode = (typeof NOTIFICATION_SEND_MODES)[number];

export const NOTIFICATION_STATUSES = [
  'sent',
  'scheduled',
  'automated',
  'draft',
  'failed',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Customer inbox notification categories (§2.7). */
export const NOTIFICATION_CATEGORIES = [
  'order_status',
  'spin_reward',
  'wallet',
  'affiliate',
  'promo',
  'system',
  'support',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

// ── Admins & permissions ───────────────────────────────────────────
export const ADMIN_ROLES = ['super_admin', 'sub_admin'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_STATUSES = ['active', 'suspended'] as const;
export type AdminStatus = (typeof ADMIN_STATUSES)[number];

/** The 19 sidebar modules that carry per-admin permissions (§1.20, §8.4). */
export const MODULE_KEYS = [
  'dashboard',
  'products',
  'categories',
  'inventory',
  'reviews',
  'orders',
  'customers',
  'payments',
  'refunds', // was 'replacement', then 'returns' — renamed to match the design
  'spinnerCampaigns',
  'coupons',
  'affiliateProgram',
  'banner',
  'flashSale',
  'newArrivals',
  'notifications',
  'reportsAnalytics',
  'settings',
  'subAdmin',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const PERMISSION_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type ModulePermission = Record<PermissionAction, boolean>;
export type ModulePermissions = Record<ModuleKey, ModulePermission>;

export const ALL_ACTIONS_TRUE: ModulePermission = {
  view: true,
  create: true,
  edit: true,
  delete: true,
  approve: true,
};
export const ALL_ACTIONS_FALSE: ModulePermission = {
  view: false,
  create: false,
  edit: false,
  delete: false,
  approve: false,
};

// ── Reviews ────────────────────────────────────────────────────────
export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

// ── Support ────────────────────────────────────────────────────────
export const SUPPORT_TICKET_STATUSES = [
  'open',
  'awaiting_customer',
  'awaiting_admin',
  'resolved',
  'closed',
] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

// ── Design tokens — token → hex contract (tech-arch §1.0) ──────────
/** Semantic UI tokens resolved to hex identically by every client. */
export const DESIGN_TOKENS = {
  green: '#059669',
  amber: '#F59E0B',
  blue: '#0EA5E9',
  red: '#F44559',
  gray: '#6B7280',
  white: '#FFFFFF',
  brownDark: '#2A1F10',
} as const;
export type DesignToken = keyof typeof DESIGN_TOKENS;
