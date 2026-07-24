import type { BaseDoc, LedgerDoc, Ts } from './common.js';
import type {
  BannerPlacement,
  CommissionStatus,
  CouponStatus,
  CouponTarget,
  DiscountType,
  FlashSaleStatus,
  OrderRequestStatus,
  OrderRequestType,
  ReviewStatus,
  SpinCampaignStatus,
  SpinPrizeType,
  WithdrawalStatus,
  Visibility,
} from '../enums.js';

// ── Global coupons (tech-arch §1.7) ────────────────────────────────
export interface Coupon extends BaseDoc {
  code: string;
  title: string;
  description: string;
  discountType: DiscountType;
  discountValuePaise: number;
  discountPercent: number;
  discountMaxCapPaise: number | null;
  minCartValuePaise: number;
  maxUsesPerUser: number;
  maxUsesTotal: number | null;
  usesCount: number;
  applicableCategories: string[];
  applicableProducts: string[];
  excludedProducts: string[];
  firstOrderOnly: boolean;
  validFrom: Ts;
  validUntil: Ts | null; // null = No expiry
  active: boolean;
  status: CouponStatus;
  targetUsers: CouponTarget;
  createdBy: string;
  searchIndex: string[];
}

// ── Flash sales (§1.5) ─────────────────────────────────────────────
export interface FlashSaleOverride {
  salePricePaise: number;
  discountPercent: number;
  maxUnitsPerCustomer: number | null;
  totalUnitsAllowed: number | null;
  unitsSold: number;
}

export interface FlashSale extends BaseDoc {
  name: string;
  status: FlashSaleStatus;
  startsAt: Ts;
  endsAt: Ts;
  bannerImageUrl: string | null;
  productIds: string[];
  overrides: Record<string, FlashSaleOverride>;
  visibility: Visibility;
  createdBy: string;
}

// ── New arrivals (curated entries) ─────────────────────────────────
export interface NewArrivalEntry extends BaseDoc {
  productId: string;
  order: number;
  status: Visibility;
}

// ── Banners ────────────────────────────────────────────────────────
export interface Banner extends BaseDoc {
  placement: BannerPlacement;
  imageUrl: string;
  title: string;
  attachedProductId: string | null;
  publishLive: boolean;
  order: number;
}

// ── Spin campaigns (§1.10) ─────────────────────────────────────────
export interface SpinSlice {
  id: string;
  order: number;
  prizeType: SpinPrizeType;
  discountValuePaise: number | null;
  discountPercent: number | null;
  discountMaxCapPaise: number | null;
  minCartValuePaise: number;
  couponTemplateCode: string | null;
  validityDays: number;
  weight: number; // relative RNG weight
  displayLabel: string;
  secondaryLabel: string;
  usedCount: number;
}

export interface SpinCampaign extends BaseDoc {
  name: string;
  status: SpinCampaignStatus;
  startsAt: Ts;
  endsAt: Ts;
  slices: SpinSlice[];
  cooldownHours: number;
  /** How many times each customer may spin per calendar day (IST). */
  spinsPerDay: number;
  rewardCouponExpiryDays: number;
  eligibility: CouponTarget;
  totalSpins: number;
  totalCouponsIssued: number;
  totalCashbackPaidPaise: number;
  createdBy: string;
}

// ── Commissions (§1.9) — immutable ledger ──────────────────────────
export interface Commission extends LedgerDoc {
  affiliateUid: string;
  referredCustomerUid: string;
  referredCustomerFirstName: string;
  orderId: string;
  orderShortId: string;
  orderTotalPaise: number;
  /** Merchandise value (post-discount) the commission was charged against. */
  eligiblePaise?: number;
  /** Fallback affiliate rate — only used by lines with no per-line commission. */
  commissionRate: number;
  commissionPaise: number;
  /** Per-line explanation of `commissionPaise` (how each line earned). */
  lineBreakdown?: {
    productId: string;
    variantId: string | null;
    qty: number;
    basis: 'per_unit' | 'product_rate' | 'affiliate_rate';
    commissionPaise: number;
  }[];
  status: CommissionStatus;
  accruedAt: Ts;
  confirmedAt: Ts | null;
  paidAt: Ts | null;
  withdrawalRequestId: string | null;
  cancellationReason: string | null;
  /** Written by the return flow when money goes back to the customer. */
  reversedPaise?: number;
  unrecoveredPaise?: number;
  cancelledAt?: Ts | null;
}

// ── Withdrawal requests (§1.8) ─────────────────────────────────────
export interface WithdrawalRequest extends BaseDoc {
  shortId: string; // #WD-000042
  customerId: string;
  customerName: string;
  customerPhone: string;
  requestedAmountPaise: number;
  processingFeePaise: number;
  netPayoutPaise: number;
  bankAccount: {
    id: string;
    holderName: string;
    accountNumberLast4: string;
    ifsc: string;
    bankName: string;
  };
  status: WithdrawalStatus;
  statusHistory: { status: string; at: Ts; byUid: string; note: string | null }[];
  rejectionReason: string | null;
  paymentReference: string | null;
  processedAt: Ts | null;
  processedByUid: string | null;
  /**
   * Terminal payout state (written by approveWithdrawal). `status === 'paid'`
   * with a `paidAt` stamp means the money has been sent to the affiliate's bank
   * — payouts are settled manually, so these fields ARE the record of it.
   * `paidAmountPaise` is what actually reached the bank (requested − fee).
   */
  paidAt?: Ts | null;
  paidAmountPaise?: number;
  payoutMode?: 'manual';
  /** Terminal decline stamp; `rejectionReason` carries the copy to show. */
  rejectedAt?: Ts | null;
  nonce: string;
}

// ── Order requests = Returns (§1.12; Replacement removed) ──────────
export interface OrderRequest extends BaseDoc {
  shortId: string; // #RP-000123
  type: OrderRequestType; // 'return'
  customerId: string;
  orderId: string;
  orderShortId: string;
  itemId: string;
  itemSnapshot: {
    productId: string;
    productName: string;
    variantLabel: string | null;
    quantity: number;
    priceAtPurchasePaise: number;
  };
  reasonKey: string;
  reasonLabel: string;
  note: string | null;
  photoUrls: string[];
  status: OrderRequestStatus;
  statusHistory: { status: string; at: Ts; byUid: string; note: string | null }[];
  rejectionReason: string | null;
  refundMethod: 'wallet' | 'gateway' | null;
  refundAmountPaise: number | null;
  refundTransactionId: string | null;
  refundedAt: Ts | null;
  nonce: string;
}

// ── Reviews (§1.19) ────────────────────────────────────────────────
export interface Review extends BaseDoc {
  productId: string;
  customerId: string;
  customerName: string;
  orderId: string;
  rating: number;
  title: string | null;
  body: string | null;
  photoUrls: string[];
  status: ReviewStatus;
  moderatedBy: string | null;
  moderatedAt: Ts | null;
  helpfulCount: number;
}
