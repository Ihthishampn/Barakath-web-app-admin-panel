import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_toast.dart';
import 'data/order.dart';
import 'data/orders_repository.dart';
import 'order_common.dart';

/// Screen — Request Return (Figma node 46:7318). Pick a reason for one delivered
/// item and submit via `requestReturnOrReplacement`. Approved refunds credit the
/// wallet (admin-side).
class ReturnRequestScreen extends StatefulWidget {
  const ReturnRequestScreen(
      {super.key, required this.orderId, required this.item});
  final String orderId;
  final OrderItem item;

  @override
  State<ReturnRequestScreen> createState() => _ReturnRequestScreenState();
}

class _ReturnRequestScreenState extends State<ReturnRequestScreen> {
  final _repo = OrdersRepository();
  String? _reasonKey;
  bool _submitting = false;

  Future<void> _submit() async {
    final key = _reasonKey;
    if (key == null || _submitting) return;
    setState(() => _submitting = true);
    try {
      await _repo.requestReturn(
        orderId: widget.orderId,
        itemId: widget.item.id,
        reasonKey: key,
      );
      if (!mounted) return;
      AppToast.show(context, 'Return requested — we\'ll review it shortly.',
          variant: AppToastVariant.success);
      context.pop();
    } on FirebaseFunctionsException catch (e) {
      if (mounted) {
        setState(() => _submitting = false);
        AppToast.show(context, e.message ?? "Couldn't submit your return.",
            variant: AppToastVariant.error);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _submitting = false);
        AppToast.show(context, "Couldn't submit your return. Please try again.",
            variant: AppToastVariant.error);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final it = widget.item;
    final sub = [
      if ((it.variantLabel ?? '').isNotEmpty) it.variantLabel!,
      'Qty ${it.quantity}',
    ].join(' · ');
    return Scaffold(
      backgroundColor: AppColors.surfaceBackground,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const OrderTopBar(title: 'Request return'),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                    AppSpacing.x4, AppSpacing.x20, AppSpacing.x20),
                children: [
                  // Item card.
                  Container(
                    padding: const EdgeInsets.all(AppSpacing.x14),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(AppRadii.card),
                      border: Border.all(color: AppColors.borderSubtle),
                    ),
                    child: Row(
                      children: [
                        OrderThumb(
                            imageUrl: it.imageUrl,
                            tint: it.categoryTint,
                            size: 56),
                        const SizedBox(width: AppSpacing.x12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(it.title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: AppType.bodyMedium.copyWith(
                                      fontWeight: FontWeight.w700,
                                      color: AppColors.textPrimary)),
                              const SizedBox(height: 2),
                              Text(sub,
                                  style: AppType.bodySmall.copyWith(
                                      color: AppColors.textSecondary)),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.x20),
                  Text('Reason for return',
                      style: AppType.bodyMedium.copyWith(
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary)),
                  const SizedBox(height: AppSpacing.x12),
                  for (final r in returnReasons) ...[
                    _ReasonOption(
                      label: r.label,
                      selected: _reasonKey == r.key,
                      onTap: () => setState(() => _reasonKey = r.key),
                    ),
                    const SizedBox(height: AppSpacing.x10),
                  ],
                  const SizedBox(height: AppSpacing.x4),
                  _infoBox(),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.x20, AppSpacing.x8,
                  AppSpacing.x20, AppSpacing.x16),
              child: AppButton.reward(
                label: 'Submit request',
                loading: _submitting,
                onPressed: _reasonKey == null ? null : _submit,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _infoBox() {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.x14),
      decoration: BoxDecoration(
        color: AppColors.sky100,
        borderRadius: BorderRadius.circular(AppRadii.field),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline_rounded,
              size: 18, color: AppColors.sky700),
          const SizedBox(width: AppSpacing.x10),
          Expanded(
            child: Text(
                'Approved refunds are credited to your Normal Wallet within 24 hours.',
                style: AppType.bodySmall.copyWith(
                    height: 1.45, color: AppColors.sky700)),
          ),
        ],
      ),
    );
  }
}

class _ReasonOption extends StatelessWidget {
  const _ReasonOption(
      {required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.x16, vertical: AppSpacing.x16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(AppRadii.field),
          border: Border.all(
            color: selected ? AppColors.brandGreen : AppColors.borderSubtle,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            _radio(selected),
            const SizedBox(width: AppSpacing.x12),
            Expanded(
              child: Text(label,
                  style: AppType.bodyMedium.copyWith(
                      fontWeight: FontWeight.w600,
                      color: selected
                          ? AppColors.textPrimary
                          : AppColors.textSecondary)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _radio(bool selected) {
    if (selected) {
      return Container(
        width: 22,
        height: 22,
        decoration: const BoxDecoration(
            color: AppColors.brandGreen, shape: BoxShape.circle),
        child: const Icon(Icons.check_rounded, size: 14, color: Colors.white),
      );
    }
    return Container(
      width: 22,
      height: 22,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.borderSubtle, width: 2),
      ),
    );
  }
}
