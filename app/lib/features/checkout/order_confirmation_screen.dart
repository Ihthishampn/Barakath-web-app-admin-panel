import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/app_button.dart';
import 'data/checkout_repository.dart';

/// Screen — Order placed (Figma node 46:6972). Success state after `placeOrder`.
/// Shows the order id + arrival, an optional cashback banner (only when the
/// order actually credited cashback), and Track order / Continue shopping.
class OrderConfirmationScreen extends StatefulWidget {
  const OrderConfirmationScreen({super.key, this.order});

  final PlacedOrder? order;

  @override
  State<OrderConfirmationScreen> createState() =>
      _OrderConfirmationScreenState();
}

class _OrderConfirmationScreenState extends State<OrderConfirmationScreen> {
  final _repo = CheckoutRepository();
  String _arrival = '';
  int _cashbackPaise = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    // Arrival estimate from store settings.
    try {
      final s = await _repo.fetchSettings();
      final d = _repo.estimateArrival(s);
      final tomorrow = DateTime.now().add(const Duration(days: 1));
      final isTomorrow = d.year == tomorrow.year &&
          d.month == tomorrow.month &&
          d.day == tomorrow.day;
      if (mounted) {
        setState(() => _arrival = isTomorrow
            ? 'arrives tomorrow'
            : 'arrives ${DateFormat('EEE, d MMM').format(d)}');
      }
    } catch (_) {/* ignore — copy just omits the arrival */}

    // Cashback: only shown if the order genuinely recorded it.
    final id = widget.order?.orderId;
    if (id != null && id.isNotEmpty) {
      try {
        final snap =
            await FirebaseFirestore.instance.doc('orders/$id').get();
        final d = snap.data() ?? const {};
        final cb = (d['cashbackPaise'] as num?)?.toInt() ??
            (d['loyaltyEarnedPaise'] as num?)?.toInt() ??
            0;
        if (mounted && cb > 0) setState(() => _cashbackPaise = cb);
      } catch (_) {/* ignore */}
    }
  }

  void _continueShopping() => context.go(Routes.home);

  void _trackOrder() {
    final id = widget.order?.orderId;
    if (id == null || id.isEmpty) {
      context.go(Routes.home);
      return;
    }
    context.push('${Routes.orderTracking}/$id');
  }

  void _viewInvoice() {
    final id = widget.order?.orderId;
    if (id == null || id.isEmpty) return;
    context.push('${Routes.invoice}/$id');
  }

  @override
  Widget build(BuildContext context) {
    final shortId = widget.order?.shortId ?? '';
    // Authoritative amount the server settled the order at (payable after any
    // auto-applied offer / wallet), so the last figure the user sees matches
    // what placeOrder actually charged — not the pre-computed checkout estimate.
    final amountPaise = widget.order?.amountPaise ?? 0;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _continueShopping();
      },
      child: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.x28),
            child: Column(
              children: [
                const Spacer(flex: 3),
                _successCheck(),
                const SizedBox(height: AppSpacing.x24),
                Text('Order placed',
                    style: AppType.displayLarge.copyWith(
                        fontSize: 28,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.56,
                        color: AppColors.textPrimary)),
                const SizedBox(height: AppSpacing.x10),
                Text.rich(
                  textAlign: TextAlign.center,
                  TextSpan(
                    text: "Nice — that's on its way! Order ",
                    style: AppType.bodyMedium.copyWith(
                        fontSize: 15,
                        height: 1.5,
                        color: AppColors.textSecondary),
                    children: [
                      TextSpan(
                        text: shortId,
                        style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontWeight: FontWeight.w800),
                      ),
                      if (_arrival.isNotEmpty) TextSpan(text: ' $_arrival'),
                      const TextSpan(text: '.'),
                    ],
                  ),
                ),
                if (amountPaise > 0) ...[
                  const SizedBox(height: AppSpacing.x16),
                  _amountChip(amountPaise),
                ],
                if (_cashbackPaise > 0) ...[
                  const SizedBox(height: AppSpacing.x20),
                  _cashbackBanner(),
                ],
                const Spacer(flex: 4),
                if (widget.order?.orderId.isNotEmpty == true) ...[
                  AppButton.reward(
                      label: 'Track order', onPressed: _trackOrder),
                  const SizedBox(height: AppSpacing.x12),
                  Row(
                    children: [
                      Expanded(
                        child: AppButton.outlined(
                            label: 'Invoice', onPressed: _viewInvoice),
                      ),
                      const SizedBox(width: AppSpacing.x12),
                      Expanded(
                        child: AppButton.outlined(
                            label: 'Continue shopping',
                            onPressed: _continueShopping),
                      ),
                    ],
                  ),
                ] else
                  AppButton.reward(
                      label: 'Continue shopping',
                      onPressed: _continueShopping),
                const SizedBox(height: AppSpacing.x8),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _successCheck() {
    return Container(
      width: 96,
      height: 96,
      decoration: BoxDecoration(
        color: AppColors.brandGreen,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: AppColors.brandGreen.withValues(alpha: 0.25),
            blurRadius: 28,
            spreadRadius: 4,
          ),
        ],
      ),
      alignment: Alignment.center,
      child: const Icon(Icons.check_rounded, size: 48, color: Colors.white),
    );
  }

  /// This screen is only ever reached once an order is settled — the gateway
  /// leg has been verified, or there was nothing to collect — so the amount is
  /// always money already paid. (Nothing can be "due on delivery" any more.)
  Widget _amountChip(int amountPaise) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.brandGreenSubtle,
        borderRadius: BorderRadius.circular(AppRadii.pill),
      ),
      child: Text(
        '${Money.fromPaise(amountPaise)} paid',
        style: AppType.bodySmall.copyWith(
            fontWeight: FontWeight.w800, color: AppColors.brandGreen),
      ),
    );
  }

  Widget _cashbackBanner() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.brandAmberLight.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.brandAmber.withValues(alpha: 0.5)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.card_giftcard_rounded,
              size: 20, color: AppColors.brandGoldStrong),
          const SizedBox(width: AppSpacing.x12),
          Flexible(
            child: Text.rich(
              TextSpan(
                text: Money.fromPaise(_cashbackPaise),
                style: AppType.bodyMedium.copyWith(
                    fontWeight: FontWeight.w800, color: AppColors.textPrimary),
                children: [
                  TextSpan(
                    text: ' cashback added to your wallet',
                    style: AppType.bodyMedium.copyWith(
                        fontWeight: FontWeight.w400,
                        color: AppColors.textSecondary),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
