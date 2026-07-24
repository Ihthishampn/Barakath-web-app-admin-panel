import type { AddressSnapshot, BaseDoc, LedgerDoc, Ts } from './common.js';
import type {
  ItemReturnStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  CommissionStatus,
} from '../enums.js';

export interface OrderItemSummary {
  productId: string;
  productName: string;
  imageUrl: string;
  categoryTint: string;
  quantity: number;
}

export interface AppliedCoupon {
  code: string;
  couponId: string | null;
  userCouponId: string | null;
  discountPaise: number;
  source: 'promotional' | 'spin' | 'welcome' | 'admin';
}

export interface Rider {
  name: string | null;
  phone: string | null;
  currentDistanceKm: number | null;
}

export interface Order extends BaseDoc {
  shortId: string; // #BRK-48219
  customerId: string;
  customerName: string;
  customerPhone: string;

  status: OrderStatus;

  itemsCount: number;
  itemsSummary: OrderItemSummary[];
  /**
   * Embedded line items (canonical going forward). Older orders written before
   * this field existed carry their line items only in the `orders/{id}/items`
   * subcollection, so readers must fall back to it when this array is absent.
   */
  items?: OrderItem[];

  subtotalPaise: number;
  discountPaise: number;
  spinRewardPaise: number;
  walletUsedPaise: number;
  /**
   * How `walletUsedPaise` was funded, split at placement so no later path has to
   * guess. Cashback is spent first, so `walletCashbackPaise` is the
   * non-refundable slice and `walletRealPaise` the customer's own money (top-ups
   * and previous refunds) — the only wallet money a refund may return.
   *
   * `walletCashbackPaise + walletRealPaise === walletUsedPaise`.
   *
   * Both are absent on orders placed before the split existed. A reader that
   * finds no `walletRealPaise` must treat the WHOLE `walletUsedPaise` as real:
   * the composition is unknowable for those orders, and withholding money from a
   * historical customer is the worse error.
   */
  walletCashbackPaise?: number;
  walletRealPaise?: number;
  deliveryPaise: number;
  /** Always 0 on new orders (COD withdrawn); non-zero only on historical ones. */
  codSurchargePaise: number;
  taxPaise: number;
  totalPaise: number;
  amountPaidPaise: number;

  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  razorpaySignature: string | null;

  appliedCoupon: AppliedCoupon | null;
  /**
   * Flat mirror of `appliedCoupon` — the SAME values, written in the same
   * transaction, so a redemption can be found with a plain
   * `where('couponId', '==', …)` (a nested object cannot be queried) and read
   * off the document without parsing it. Absent on orders placed before these
   * fields existed; readers must fall back to `appliedCoupon`.
   */
  couponId?: string | null;
  userCouponId?: string | null;
  couponCode?: string | null;
  /**
   * When the cancellation handed this order's redemption back to the coupon.
   * Present so the release is single-shot — a counter is the one thing that
   * cannot be reconstructed if it is released twice.
   */
  couponReleasedAt?: Ts | null;
  deliveryAddress: AddressSnapshot;

  courier: string | null;
  trackingId: string | null;
  rider: Rider | null;
  shippedAt: Ts | null;
  outForDeliveryAt: Ts | null;
  deliveredAt: Ts | null;
  expectedDeliveryDate: Ts;

  cancelledAt: Ts | null;
  cancellationReason: string | null;
  cancelledByUid: string | null;

  referredByAffiliateUid: string | null;
  /** Code that produced the attribution — the standing link's code. */
  referralCode?: string | null;
  /**
   * Always 'standing' on new orders: customers/{uid}.referredBy (permanent,
   * created by linkReferral at sign-up) is the ONLY source of attribution.
   * 'order_code' is read-only history from the short period when checkout also
   * accepted a per-order referral code.
   */
  referralSource?: 'standing' | 'order_code' | null;
  affiliateCommissionPaise: number;
  affiliateCommissionStatus: CommissionStatus | null;

  placementNonce: string;
  customerNote: string | null;
  adminNote: string | null;

  invoiceUrl: string | null;
  invoiceGeneratedAt: Ts | null;

  searchIndex: string[];
  placedAt: Ts;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  productDisplayTitle: string;
  imageUrl: string;
  categoryTint: string;
  category: string;
  variantId: string | null;
  variantLabel: string | null;
  quantity: number;
  mrpPaise: number;
  offerPricePaise: number;
  lineTotalPaise: number;
  discountAppliedPaise: number;
  taxPaise: number;
  hsnCode: string | null;
  weight: number;
  returnStatus: ItemReturnStatus; // was replacementStatus
  returnRequestId: string | null;
  reviewSubmitted: boolean;
  reviewId: string | null;
  /**
   * Affiliate economics snapshotted at purchase time — commission accrues from
   * these, never from the live catalogue, so re-pricing a product later cannot
   * change what an affiliate already earned. Absent on orders placed before
   * checkout started recording them.
   */
  commissionPaise?: number | null;
  affiliateCommissionRate?: number | null;
  isAffiliateEligible?: boolean;
  createdAt: Ts;
}

/** Immutable status-transition log — single source of truth for order history. */
export interface OrderTimelineEntry extends LedgerDoc {
  status: OrderStatus;
  at: Ts;
  byUid: string;
  byName: string;
  note: string | null;
  meta: Record<string, unknown>;
}

export interface Payment extends BaseDoc {
  orderId: string;
  method: PaymentMethod;
  gateway: 'razorpay' | null;
  status: PaymentStatus;
  amountPaise: number;
  gatewayRef: string | null;
}
