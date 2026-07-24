import type { BaseDoc, LedgerDoc, Ts } from './common.js';
import type {
  CustomerRole,
  DiscountType,
  NotificationCategory,
  UserCouponSource,
  UserCouponStatus,
  WalletTxSource,
  WalletTxType,
} from '../enums.js';

/**
 * LIFETIME tallies — how much has ever arrived from each source. They are only
 * ever incremented (spending the wallet does not decrement them), so they say
 * nothing about what the balance is composed of RIGHT NOW. For that — and for
 * deciding what a refund may return — use `Wallet.cashbackBalancePaise`.
 */
export interface WalletBreakdown {
  refundsPaise: number;
  rewardsPaise: number;
  cashbackPaise: number;
  topupPaise: number;
}

export interface Wallet {
  balancePaise: number;
  /**
   * Live composition, NOT a tally: the slice of the CURRENT `balancePaise` that
   * arrived as cashback (spin prizes). Cashback is spendable but never
   * refundable — "Refund their amount only. Cashback or discounted amount never
   * returns to wallet" — so checkout spends this pool FIRST and records the
   * split on the order, and refunds hand back only the rest.
   *
   * Invariant: 0 ≤ cashbackBalancePaise ≤ balancePaise. Optional because it did
   * not exist when most wallets were created; a MISSING value means 0, i.e. the
   * whole historical balance stays fully refundable (retro-classifying it would
   * take money customers had already earned).
   */
  cashbackBalancePaise?: number;
  breakdown: WalletBreakdown;
  lifetimeCreditsPaise: number;
  lifetimeDebitsPaise: number;
  lastTransactionAt: Ts | null;
}

export interface AffiliateInfo {
  enabled: boolean;
  enabledAt: Ts | null;
  referralCode: string;
  commissionRate: number;
  pendingBalancePaise: number;
  confirmedBalancePaise: number;
  withdrawnBalancePaise: number;
  lifetimeEarningsPaise: number;
  referredCount: number;
  activeReferredCount: number;
  lastCommissionAt: Ts | null;
  hasPendingWithdrawal: boolean;
  /**
   * Admin's "Wallet access" toggle. Only an explicit `false` blocks withdrawals
   * — absent means allowed, so accounts created before the field existed keep
   * working. Enforced in requestWithdrawal, mirrored as a client pre-check.
   */
  walletEnabled?: boolean;
  /** Stamped by approveWithdrawal so a client can date the last real payout. */
  lastWithdrawalPaidAt?: Ts | null;
}

export interface CustomerAddress {
  id: string;
  label: string;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: 'India';
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  createdAt: Ts;
  updatedAt: Ts;
}

export interface BankAccount {
  id: string;
  accountHolderName: string;
  accountNumberMasked: string; // •••• 4321 (client-safe)
  ifsc: string;
  bankName: string;
  branch: string | null;
  isDefault: boolean;
  verifiedAt: Ts | null;
  createdAt: Ts;
  updatedAt: Ts;
}

export interface CartItem {
  id: string; // `${productId}_${variantId}`
  productId: string;
  variantId: string | null;
  quantity: number;
  addedAt: Ts;
  updatedAt: Ts;
  productName: string;
  productImageUrl: string;
  categoryTint: string;
  category: string;
  variantLabel: string | null;
  offerPricePaise: number;
  mrpPaise: number;
  inStock: boolean;
  availableQuantity: number;
  priceChanged: boolean;
}

export interface CustomerStats {
  ordersCount: number;
  ordersDelivered: number;
  ordersCancelled: number;
  ordersReturned: number;
  totalSpentPaise: number;
  firstOrderAt: Ts | null;
  lastOrderAt: Ts | null;
  reviewsCount: number;
  wishlistCount: number;
  unreadNotifications: number;
}

export interface Customer extends BaseDoc {
  uid: string;
  phone: string;
  phoneVerified: boolean;
  name: string;
  email: string | null;
  emailVerified: boolean;
  gstin: string | null;
  avatarUrl: string | null;

  profileComplete: boolean;
  profileSkipped: boolean;

  role: CustomerRole;
  isBlocked: boolean;
  blockReason: string | null;
  blockedAt: Ts | null;
  blockedByUid: string | null;

  wallet: Wallet;
  /** Spin & Win balance — allocated by an admin, decremented per spin. No daily reset. */
  spinsRemaining: number;
  affiliate: AffiliateInfo | null;
  referredBy: { affiliateUid: string; affiliateCode: string; linkedAt: Ts } | null;

  preferences: {
    notificationsEnabled: boolean;
    notifyOrderUpdates: boolean;
    notifyPromotions: boolean;
    notifyAffiliateEarnings: boolean;
    notifyWalletActivity: boolean;
  };

  stats: CustomerStats;
  cart: CartItem[];
  addresses: CustomerAddress[];
  bankAccounts: BankAccount[];

  lastLoginAt: Ts;
  lastActiveAt: Ts;
  searchIndex: string[];
}

// ── Immutable wallet ledger (§2.5) ─────────────────────────────────
export interface WalletTransaction extends LedgerDoc {
  type: WalletTxType;
  source: WalletTxSource;
  amountPaise: number;
  balanceAfterPaise: number;
  orderId: string | null;
  orderShortId: string | null;
  couponId: string | null;
  refundRequestId: string | null;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  adjustedByUid: string | null;
  adjustmentReason: string | null;
  title: string;
  description: string | null;
}

// ── User coupon wallet (§2.6) ──────────────────────────────────────
export interface UserCoupon extends BaseDoc {
  code: string;
  title: string;
  description: string;
  discountType: DiscountType;
  discountValuePaise: number | null;
  discountPercent: number | null;
  discountMaxCapPaise: number | null;
  minCartValuePaise: number;
  source: UserCouponSource;
  campaignId: string | null;
  spinHistoryId: string | null;
  status: UserCouponStatus;
  issuedAt: Ts;
  expiresAt: Ts;
  usedAt: Ts | null;
  usedOnOrderId: string | null;
  usedOnOrderShortId: string | null;
  maxUsesPerCoupon: number;
  usesCount: number;
  isNew: boolean;
}

// ── Customer inbox notification (§2.7) ─────────────────────────────
export interface InboxNotification extends LedgerDoc {
  title: string;
  body: string;
  category: NotificationCategory;
  iconType: string | null;
  iconColor: 'green' | 'amber' | 'blue' | 'red' | 'gray' | null;
  /**
   * Where tapping the notification goes. An OBJECT, not a string — this was
   * declared `string` while every writer (adminSendBroadcastNotification and the
   * event notifications) has always written the shape below, so both clients had
   * to read it off the raw document and narrow by hand.
   *
   * `type` is intentionally widened to `string`: the server validates it, and a
   * client that meets a type it does not know must render the row inert rather
   * than fail to parse the whole document. Null means "not navigable".
   */
  deepLink: {
    type: 'home' | 'product' | 'category' | 'url' | (string & {});
    target?: string | null;
    label?: string;
  } | null;
  relatedOrderId: string | null;
  relatedOrderShortId: string | null;
  relatedCouponId: string | null;
  relatedWithdrawalId: string | null;
  relatedTicketId: string | null;
  read: boolean;
  readAt: Ts | null;
  archived: boolean;
  archivedAt: Ts | null;
  pushSent: boolean;
  pushSentAt: Ts | null;
  pushError: string | null;
}
