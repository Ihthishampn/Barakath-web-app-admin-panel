import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

import '../../core/router/app_router.dart';
import '../../core/services/auth_provider.dart';
import '../../core/services/cart_provider.dart';
import '../../core/services/checkout_draft.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_toast.dart';
import 'data/checkout_repository.dart';

/// Screen — Payment (Figma node 46:6900). Tapping "Pay" places the order via the
/// `placeOrder` Cloud Function (atomic stock ↓, shortId).
///
///  • Wallet-covered → the server settles it outright (status `accepted`) and we
///    route straight to confirmation.
///  • Online → the order is created with status `pending_payment` — NOT accepted,
///    and no "Order placed" notification is sent yet. `createRazorpayOrder` opens
///    a Razorpay order, the **native Razorpay checkout** collects the payment,
///    and `verifyPayment` validates the signature server-side; only then does the
///    server promote the order to `accepted` and notify the customer. Works in
///    Razorpay TEST mode with a `rzp_test_…` key (the key id is returned by the
///    Cloud Function; the secret lives only in Secret Manager). The order stays
///    `pending_payment` if the user cancels or a payment fails, so re-pressing
///    Pay resumes the same order (stable [_nonce]); an order never paid is
///    cancelled by the server's abandoned-order sweep.
class PaymentScreen extends StatefulWidget {
  const PaymentScreen({
    super.key,
    this.payablePaise = 0,
    this.resumeOrderId,
    this.resumeShortId,
  });

  final int payablePaise;

  /// RESUME mode: finish paying an order that already exists (placed online but
  /// left unpaid — a dismissed/declined sheet). When set, this screen skips
  /// `placeOrder` entirely and reopens the gateway for [resumeOrderId] via the
  /// same handlers the first attempt used, so no second order is created and no
  /// stock/wallet moves twice. Reached from "Pay now" on My orders.
  final String? resumeOrderId;
  final String? resumeShortId;

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen>
    with WidgetsBindingObserver {
  final _repo = CheckoutRepository();
  String _method = 'upi'; // display selection within Razorpay
  bool _processing = false;

  late final Razorpay _razorpay;
  // The placed (pending) order awaiting online payment — set once placeOrder
  // succeeds, then finalised by the Razorpay success handler.
  PlacedOrder? _pendingOrder;

  // Native-checkout bookkeeping for the resume reconciliation below: the
  // gateway activity can be killed while the app sits in the background, in
  // which case the plugin never delivers a success or error event.
  bool _checkoutOpen = false; // the native sheet has been opened
  bool _wentToBackground = false; // …and the app was actually paused
  bool _verifying = false; // verifyPayment is in flight, leave it alone
  bool _reconciling = false; // one reconciliation at a time

  static const _razorpayBlue = Color(0xFF0B5FBF);

  /// Finishing payment for an order that already exists (see PaymentScreen doc).
  bool get _resume => widget.resumeOrderId != null;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _razorpay = Razorpay()
      ..on(Razorpay.EVENT_PAYMENT_SUCCESS, _onPaymentSuccess)
      ..on(Razorpay.EVENT_PAYMENT_ERROR, _onPaymentError)
      ..on(Razorpay.EVENT_EXTERNAL_WALLET, _onExternalWallet);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _razorpay.clear();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      _wentToBackground = true;
      return;
    }
    if (state != AppLifecycleState.resumed) return;
    if (!_wentToBackground) return; // a brief 'inactive' blip, not a hand-off
    _wentToBackground = false;
    if (!_checkoutOpen || !_processing || _pendingOrder == null) return;
    unawaited(_reconcileAfterResume());
  }

  /// The customer came back to the app with the Pay button still spinning.
  /// Normally the Razorpay plugin fires success/error moments later, so give it
  /// a grace period; if it stays silent (its activity was killed by the OS
  /// while we were backgrounded) ask the server what actually happened rather
  /// than leaving the customer stuck on a spinner forever.
  Future<void> _reconcileAfterResume() async {
    if (_reconciling) return;
    _reconciling = true;
    try {
      await Future<void>.delayed(const Duration(seconds: 4));
      final placed = _pendingOrder;
      // The plugin reported in after all (or we already navigated away).
      if (!mounted || placed == null || !_processing || _verifying) return;
      // No bag/draft to clear when resuming an already-placed order.
      final cart = _resume ? null : context.read<CartProvider>();
      final draft = _resume ? null : context.read<CheckoutDraft>();
      final status = await _repo.fetchPaymentStatus(placed.orderId);
      if (!mounted || !_processing || _verifying) return;
      if (status == 'captured') {
        // A webhook (or an earlier verify) already settled it.
        if (_resume) {
          AppToast.show(context,
              'Payment received — your order is confirmed.',
              variant: AppToastVariant.success);
          context.pop();
          return;
        }
        CheckoutAttempt.clear();
        cart!.clear();
        draft!.reset();
        if (!mounted) return;
        context.go(Routes.orderConfirmation, extra: placed);
        return;
      }
      // Not captured — or we couldn't tell. Either way the order exists and is
      // payable later, so stop the spinner and say so instead of guessing.
      setState(() => _processing = false);
      AppToast.show(
          context,
          'Your order is saved — you can finish paying it from My orders.',
          variant: AppToastVariant.error);
    } finally {
      _reconciling = false;
    }
  }

  /// Open the gateway for an order that ALREADY exists — the "Pay now" resume
  /// from My orders, and the on-screen retry after a failed attempt. Reuses this
  /// order's Razorpay order server-side, so payment can never be collected twice
  /// and no second order is placed.
  Future<void> _resumeGateway(PlacedOrder placed) async {
    setState(() => _processing = true);
    try {
      _pendingOrder = placed;
      final rzp = await _repo.createRazorpayOrder(placed.orderId);
      if (!mounted) return;
      await _openCheckout(rzp, placed);
    } on FirebaseFunctionsException catch (e) {
      if (mounted) {
        setState(() => _processing = false);
        AppToast.show(context, e.message ?? 'Payment could not be started.',
            variant: AppToastVariant.error);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _processing = false);
        AppToast.show(context,
            'Payment could not be started. Please try again.',
            variant: AppToastVariant.error);
      }
    }
  }

  Future<void> _pay() async {
    if (_processing) return;

    // RESUME (from My orders) or on-screen RETRY after a failed attempt: the
    // order already exists — reopen the gateway for it, never place a new one.
    if (_resume) {
      await _resumeGateway(PlacedOrder(
        orderId: widget.resumeOrderId!,
        shortId: widget.resumeShortId ?? '',
        amountPaise: widget.payablePaise,
        paymentMethod: 'razorpay',
      ));
      return;
    }
    if (_pendingOrder != null) {
      await _resumeGateway(_pendingOrder!);
      return;
    }

    final cart = context.read<CartProvider>();
    final draft = context.read<CheckoutDraft>();
    if (draft.addressId == null || cart.lines.isEmpty) {
      AppToast.show(context, 'Your bag or address is missing.',
          variant: AppToastVariant.error);
      return;
    }
    setState(() => _processing = true);
    try {
      final placed = await _repo.placeOrder(
        lines: cart.lines,
        addressId: draft.addressId!,
        couponCode: draft.coupon?.code,
        // An empty draft coupon is the customer's choice, not "surprise me":
        // without this the server auto-applies its own best offer and the
        // Razorpay sheet opens at an amount the pay bar never showed. Mirrors
        // web's `noCoupon: !draft.coupon`.
        noCoupon: draft.coupon == null,
        useWallet: draft.useWallet,
        // This screen exists to collect a balance, so 'razorpay' is all but
        // certain — except on the ₹0 body below, which is reached when there is
        // nothing left to collect and the server only accepts 'wallet'.
        walletOnly: widget.payablePaise <= 0,
        // The key for the whole checkout attempt, NOT for this route: this
        // screen is pushed afresh every time the pay bar is tapped, so a nonce
        // owned by its State handed the server a new key after a cancelled or
        // declined payment and it placed a SECOND order (second stock
        // decrement, second wallet debit). Kept alive until an order actually
        // completes, exactly as the web keeps `nonceRef`.
        placementNonce: CheckoutAttempt.nonce,
        // The hold taken when Checkout opened. The server consumes it inside
        // the same transaction and skips the decrement — those units are
        // already out of stock. A retry after a failed payment sends null,
        // which is fine: placeOrder is idempotent on the nonce and returns the
        // existing order without touching stock again.
        reservationId: CheckoutHold.reservationId,
      );
      // Consumed server-side — Checkout must not release it when it is popped.
      CheckoutHold.clear();
      // The order now holds these items — empty the bag so they aren't in two
      // places. The order lives in My orders; a dismissed/declined payment is
      // retried from there (or by re-pressing Pay, which resumes THIS order via
      // _pendingOrder), never by re-placing an empty cart.
      cart.clear();
      draft.reset();

      // Something left to pay → hand off to Razorpay for the placed order. It
      // stays 'pending_payment' until verifyPayment; the server settles it as
      // 'wallet' when the balance covered everything, leaving no gateway leg.
      if (placed.paymentMethod == 'razorpay' && placed.amountPaise > 0) {
        await _resumeGateway(placed);
        return; // success/failure continues in the Razorpay event handlers
      }

      // Nothing was left to collect, so the server settled the order itself.
      // Nothing more can go wrong for this order, so retire the placement key.
      CheckoutAttempt.clear();
      if (!mounted) return;
      context.go(Routes.orderConfirmation, extra: placed);
    } on FirebaseFunctionsException catch (e) {
      // The server writes a human sentence for every rejection it makes here
      // (bag, address, coupon and payment method alike) and nothing has been
      // charged, so relay it as-is rather than blaming the payment.
      if (mounted) {
        setState(() => _processing = false);
        AppToast.show(context, e.message ?? 'Payment could not be completed.',
            variant: AppToastVariant.error);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _processing = false);
        AppToast.show(context,
            'Payment could not be completed. Please try again.',
            variant: AppToastVariant.error);
      }
    }
  }

  /// Opens the native Razorpay checkout for the pending order.
  Future<void> _openCheckout(RazorpayOrder rzp, PlacedOrder placed) async {
    final prefill = await _prefill();
    _checkoutOpen = true;
    _razorpay.open({
      'key': rzp.keyId,
      'order_id': rzp.razorpayOrderId,
      'amount': rzp.amountPaise, // paise; Razorpay uses the order's amount
      'currency': 'INR',
      'name': 'Barakath',
      'description': placed.shortId,
      // Carry the UPI/Card choice into the gateway — without `prefill.method`
      // Razorpay opens on its own default tab and the selection above is inert.
      'prefill': {...prefill, 'method': _method},
      'theme': {'color': '#0F7A5A'},
      'retry': {'enabled': false},
    });
  }

  /// Best-effort prefill (name / email / phone) from the customer profile.
  Future<Map<String, dynamic>> _prefill() async {
    try {
      final uid = context.read<AuthProvider>().uid;
      if (uid == null) return const {};
      final d =
          (await FirebaseFirestore.instance.doc('customers/$uid').get()).data();
      return {
        'name': (d?['name'] as String?) ?? '',
        'email': (d?['email'] as String?) ?? '',
        'contact': (d?['phone'] as String?) ?? '',
      };
    } catch (_) {
      return const {};
    }
  }

  Future<void> _onPaymentSuccess(PaymentSuccessResponse r) async {
    final placed = _pendingOrder;
    if (placed == null) return;
    _checkoutOpen = false;
    // Tell the resume reconciliation to stand down — a slow verify is not a
    // stranded spinner.
    _verifying = true;
    // Capture providers before any await (context read must precede async gap).
    // In resume mode there is no bag/draft to clear — leave them untouched.
    final cart = _resume ? null : context.read<CartProvider>();
    final draft = _resume ? null : context.read<CheckoutDraft>();
    try {
      final ok = await _repo.verifyPayment(
        orderId: placed.orderId,
        razorpayOrderId: r.orderId ?? '',
        razorpayPaymentId: r.paymentId ?? '',
        razorpaySignature: r.signature ?? '',
      );
      if (!ok) {
        // A definitive "not verified" from the server: record the failed leg so
        // the order shows as payable in My orders. The callable is a no-op if
        // the payment turns out to have been captured after all. Fire-and-
        // forget — the customer must not wait on it behind a spinner.
        unawaited(_repo.markPaymentFailed(
            orderId: placed.orderId, reason: 'signature_verification_failed'));
        if (mounted) {
          setState(() => _processing = false);
          AppToast.show(
              context,
              "We couldn't verify the payment. Your order is saved — you can "
              'pay it from My orders.',
              variant: AppToastVariant.error);
        }
        return;
      }
      // Resume mode: the order was already placed, so there is no bag/draft to
      // clear. Just confirm and return to My orders — the live order stream
      // flips it to "Accepted" on its own.
      if (_resume) {
        if (!mounted) return;
        AppToast.show(context,
            'Payment received — your order is confirmed.',
            variant: AppToastVariant.success);
        context.pop();
        return;
      }
      // Paid and verified — only now is the attempt over, so only now may the
      // placement key be retired. Every failure path above deliberately keeps
      // it, so pressing Pay again resumes THIS order instead of placing a new
      // one (mirrors the web, which retires `nonceRef` at the same point).
      CheckoutAttempt.clear();
      cart!.clear();
      draft!.reset();
      if (!mounted) return;
      context.go(Routes.orderConfirmation, extra: placed);
    } catch (_) {
      // The call itself failed (network / timeout), so we do NOT know whether
      // the payment was captured — marking it failed here could contradict a
      // capture that did happen. Just stop the spinner and point at My orders,
      // where the order is waiting either way.
      if (mounted) {
        setState(() => _processing = false);
        AppToast.show(
            context,
            "We couldn't confirm the payment. Your order is saved — check My "
            'orders before paying again.',
            variant: AppToastVariant.error);
      }
    } finally {
      _verifying = false;
    }
  }

  void _onPaymentError(PaymentFailureResponse r) {
    _checkoutOpen = false;
    final placed = _pendingOrder;
    final cancelled = r.code == Razorpay.PAYMENT_CANCELLED;
    // The order and its stock stay put; only the payment leg is marked failed,
    // so the customer can retry from My orders (or by pressing Pay again).
    // Fire-and-forget: the spinner comes down now, not after a cold start.
    if (placed != null) {
      unawaited(_repo.markPaymentFailed(
        orderId: placed.orderId,
        reason: cancelled
            ? 'cancelled_by_customer'
            : [
                if (r.code != null) 'code=${r.code}',
                if (r.message?.trim().isNotEmpty == true) r.message!.trim(),
              ].join(' ').trim(),
      ));
    }
    if (!mounted) return;
    setState(() => _processing = false);
    // Prefer the gateway's own wording when it is short enough to read in a
    // toast; a raw payload dump is worse than the generic line.
    final gateway = (r.message ?? '').trim();
    final lead = cancelled
        ? 'Payment cancelled.'
        : (gateway.isNotEmpty && gateway.length <= 80
            ? (gateway.endsWith('.') ? gateway : '$gateway.')
            : 'Payment failed.');
    AppToast.show(
        context, '$lead Your order is saved — pay it from My orders.',
        variant: AppToastVariant.error);
  }

  void _onExternalWallet(ExternalWalletResponse r) {
    // Payment continues in the external wallet app; keep the spinner until the
    // success/error event arrives. If that app never hands back (the gateway
    // activity is killed while we are backgrounded), the resume reconciliation
    // above settles it against the server instead of spinning forever.
  }

  @override
  Widget build(BuildContext context) {
    final amount = Money.fromPaise(widget.payablePaise);
    return PopScope(
      // Don't let the system back gesture abandon an order that's being placed.
      canPop: !_processing,
      child: Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        // Nothing left to pay (wallet covered it all) — skip the gateway and
        // show a simple confirmation instead of a "Pay ₹0" Razorpay screen.
        child: widget.payablePaise <= 0
            ? _zeroBody(context)
            : Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _header(context, amount),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                  AppSpacing.x20, AppSpacing.x20, AppSpacing.x8),
              child: Text('PAY USING',
                  style: AppType.labelUppercase.copyWith(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.5,
                      color: AppColors.textTertiary)),
            ),
            _methodCard(
              icon: Icons.account_balance_wallet_outlined,
              tint: AppColors.brandGreenSubtle,
              iconColor: AppColors.brandGreen,
              title: 'UPI',
              sub: 'Google Pay, PhonePe, BHIM',
              value: 'upi',
            ),
            const SizedBox(height: AppSpacing.x10),
            _methodCard(
              icon: Icons.credit_card_rounded,
              tint: AppColors.brandAmberLight.withValues(alpha: 0.4),
              iconColor: AppColors.brandGoldStrong,
              title: 'Card',
              sub: 'Visa · Mastercard · Amex',
              value: 'card',
            ),
            const SizedBox(height: AppSpacing.x24),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.x20),
              child: AppButton.reward(
                label: 'Pay $amount',
                loading: _processing,
                onPressed: _pay,
              ),
            ),
            const SizedBox(height: AppSpacing.x12),
            Center(
              child: Text('Secured with 256-bit encryption',
                  style: AppType.bodySmall
                      .copyWith(color: AppColors.textTertiary)),
            ),
          ],
        ),
      ),
      ),
    );
  }

  /// Confirmation body when the wallet fully covers the order (₹0 payable).
  Widget _zeroBody(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.x20, AppSpacing.x8, AppSpacing.x8, AppSpacing.x8),
          child: Align(
            alignment: Alignment.centerRight,
            child: GestureDetector(
              onTap: _processing ? null : () => context.pop(),
              behavior: HitTestBehavior.opaque,
              child: Icon(Icons.close_rounded,
                  size: 24,
                  color: AppColors.textPrimary
                      .withValues(alpha: _processing ? 0.4 : 1)),
            ),
          ),
        ),
        const Spacer(),
        Center(
          child: Column(
            children: [
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  color: AppColors.brandGreenSubtle,
                  borderRadius: BorderRadius.circular(AppRadii.hero),
                ),
                child: const Icon(Icons.account_balance_wallet_rounded,
                    size: 34, color: AppColors.brandGreen),
              ),
              const SizedBox(height: AppSpacing.x20),
              Text('Paid fully from wallet',
                  style: AppType.headingLarge.copyWith(
                      fontSize: 20, fontWeight: FontWeight.w800)),
              const SizedBox(height: AppSpacing.x8),
              Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: AppSpacing.x32),
                child: Text(
                    'Your wallet balance covers this order in full — there’s '
                    'nothing left to pay.',
                    textAlign: TextAlign.center,
                    style: AppType.bodyMedium.copyWith(
                        color: AppColors.textSecondary, height: 1.5)),
              ),
            ],
          ),
        ),
        const Spacer(),
        Padding(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.x20, 0, AppSpacing.x20, AppSpacing.x8),
          child: AppButton.reward(
            label: 'Place order',
            loading: _processing,
            onPressed: _pay,
          ),
        ),
        const SizedBox(height: AppSpacing.x12),
        Center(
          child: Text('No payment required',
              style: AppType.bodySmall.copyWith(color: AppColors.textTertiary)),
        ),
        const SizedBox(height: AppSpacing.x12),
      ],
    );
  }

  Widget _header(BuildContext context, String amount) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x16, AppSpacing.x20, AppSpacing.x20),
      decoration: const BoxDecoration(
        color: _razorpayBlue,
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(AppRadii.hero)),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(AppRadii.control),
            ),
            alignment: Alignment.center,
            child: Text('R',
                style: AppType.headingLarge.copyWith(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: _razorpayBlue)),
          ),
          const SizedBox(width: AppSpacing.x12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Razorpay Secure',
                    style: AppType.bodyLarge.copyWith(
                        fontWeight: FontWeight.w800, color: Colors.white)),
                const SizedBox(height: 2),
                Text('Barakath · $amount',
                    style: AppType.bodySmall
                        .copyWith(color: Colors.white.withValues(alpha: 0.85))),
              ],
            ),
          ),
          GestureDetector(
            onTap: _processing ? null : () => context.pop(),
            behavior: HitTestBehavior.opaque,
            child: Icon(Icons.close_rounded,
                size: 22,
                color: Colors.white.withValues(alpha: _processing ? 0.4 : 1)),
          ),
        ],
      ),
    );
  }

  Widget _methodCard({
    required IconData icon,
    required Color tint,
    required Color iconColor,
    required String title,
    required String sub,
    required String value,
  }) {
    final selected = _method == value;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.x20),
      child: GestureDetector(
        onTap: () => setState(() => _method = value),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppRadii.field),
            border: Border.all(
                color: selected ? AppColors.brandGreen : AppColors.borderSubtle,
                width: selected ? 1.5 : 1),
          ),
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: tint,
                  borderRadius: BorderRadius.circular(AppRadii.control),
                ),
                child: Icon(icon, size: 20, color: iconColor),
              ),
              const SizedBox(width: AppSpacing.x12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: AppType.bodyMedium.copyWith(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary)),
                    const SizedBox(height: 2),
                    Text(sub,
                        style: AppType.bodySmall
                            .copyWith(color: AppColors.textSecondary)),
                  ],
                ),
              ),
              const Icon(Icons.arrow_forward_rounded,
                  size: 18, color: AppColors.textTertiary),
            ],
          ),
        ),
      ),
    );
  }
}
