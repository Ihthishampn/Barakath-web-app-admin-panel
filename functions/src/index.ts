/**
 * Barkath Cloud Functions — CALLABLES ONLY, wiring here.
 *
 * Architecture rule: Cloud Functions are reserved for critical / secure /
 * elevated-privilege / atomic-money operations that cannot be trusted on the
 * client. Everything else (searchIndex, product counts, categoryTint fan-out,
 * admin-claim search-index) is handled client-side under Firestore Security
 * Rules. Document-trigger functions (onAdminWrite, onProductWrite,
 * onCustomerWrite, onCouponWrite, onOrderCreate, onProductCounts,
 * onCategoryTintChanged) were intentionally removed:
 *   - admin custom claims          → set inside the sub-admin callables
 *   - searchIndex (products/coupons/customers/orders/admins) → built client-side
 *     (or inside the placeOrder / sub-admin callables) via buildSearchIndex
 *   - category product counts       → live count() aggregation on read
 */

// Customer authentication — MSG91 OTP. Server-side so the widget token never
// ships to a browser or an APK, and web + app share one set of abuse rules.
export { sendOtp, resendOtp, verifyOtp } from './auth/otp.js';

// Catalogue backend (critical: atomic multi-SKU stock).
export { adminAdjustStock } from './catalog/inventory.js';
// Cross-collection fan-out: editing a category rewrites its products, which a
// categories-only sub-admin is not allowed to do from the client.
export { adminFanOutCategoryTint } from './catalog/categoryTint.js';
export { adminSyncFlashSaleProducts } from './catalog/flashSaleProducts.js';

// Operations callables (critical: state machine / money / cross-user).
export { adminChangeOrderStatus } from './orders/status.js';
export { adminAssignRider } from './orders/shipment.js';
export { adminGenerateInvoice } from './orders/invoice.js';

// Customer checkout callables (critical: money / stock / atomic).
export { applyCoupon, placeOrder, cancelOrder, createRazorpayOrder, verifyPayment, markPaymentFailed } from './orders/checkout.js';
// Checkout stock holds (critical: inventory moves before any money does).
export { reserveStock, releaseStock } from './orders/reservations.js';

// Customer wallet / affiliate / spin / returns callables (critical: money).
export { topUpWallet, verifyTopUp, getTopUpStatus } from './wallet/topup.js';
export { adminAdjustWallet } from './wallet/adjust.js';
export { requestWithdrawal } from './affiliate/requests.js';
export { linkReferral } from './affiliate/referral.js';
// Default-on affiliate: provisions an enabled affiliate block for every new
// customer at doc-create (Firestore trigger).
export { provisionAffiliateOnSignup } from './affiliate/provision.js';
export { executeSpin } from './spin/execute.js';
export { adminGrantSpins } from './spin/grant.js';
export { requestReturnOrReplacement } from './returns/requests.js';
export { adminBlockUser, adminUnblockUser } from './customers/moderation.js';
export { adminApproveOrderRequest, adminRejectOrderRequest } from './returns/decisions.js';

// Reviews. `adminModerateReview` flips a review's status (publish / take down);
// `onReviewWritten` is the SOLE writer of the product rating aggregate — it
// recomputes rating/ratingCount from the approved review set on every review
// write, so a verified purchaser's review moves the number instantly.
export { adminModerateReview } from './reviews/moderation.js';
export { onReviewWritten } from './reviews/aggregate.js';

// Growth callables (critical: money / cross-user fan-out).
export {
  adminAllocateAffiliate,
  adminUpdateAffiliateCommission,
  adminRevokeAffiliate,
  approveWithdrawal,
  rejectWithdrawal,
} from './affiliate/withdrawals.js';
export { adminSendBroadcastNotification, markBroadcastOpened } from './notifications/broadcast.js';

// Insights callables (privileged: custom claims).
export {
  createSubAdmin,
  updateSubAdmin,
  suspendSubAdmin,
  deleteSubAdmin,
} from './admin/subAdmins.js';

// Scheduled maintenance (expired coupon status daily; abandoned checkout stock
// holds returned to the catalogue every 5 minutes; unpaid online orders — whose
// stock the reservation sweep can no longer reach — cancelled every 15).
export {
  couponExpirySweep,
  stockReservationSweep,
  abandonedOrderSweep,
  flashSaleStatusFlip,
} from './scheduled/sweeps.js';

// Admin-critical callables/triggers are exported here as they are built per module:
//   ./admin/subAdmins.ts       — createSubAdmin, updateSubAdmin, suspendSubAdmin, deleteSubAdmin
//   ./orders/status.ts         — adminChangeOrderStatus, adminAssignRider
//   ./orders/invoice.ts        — generateGSTInvoice
//   ./returns/decisions.ts     — adminApproveOrderRequest, adminRejectOrderRequest
//   ./reviews/moderation.ts    — adminModerateReview
//   ./wallet/adjust.ts         — adminAdjustWallet
//   ./affiliate/withdrawals.ts — approveWithdrawal, rejectWithdrawal, adminAllocateAffiliate
//   ./customers/moderation.ts  — adminBlockUser, adminUnblockUser
//   ./catalog/variables.ts     — updateSettingsVariables
//   ./catalog/inventory.ts     — adminAdjustStock
//   ./notifications/broadcast.ts — adminSendBroadcastNotification
//   ./scheduled/sweeps.ts      — couponExpirySweep, stockReservationSweep, abandonedOrderSweep, flashSaleStatusFlip
