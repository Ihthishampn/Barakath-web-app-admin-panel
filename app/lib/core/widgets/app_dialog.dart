import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import 'app_button.dart';
import 'app_medallion.dart';

/// Centered confirmation dialog — spec §1.8 / §12.
///
/// Vertical button layout (primary above, secondary text below). Backdrop tap =
/// cancel, except when [dismissible] is false (Reward Result modal).
class AppDialog extends StatelessWidget {
  const AppDialog({
    super.key,
    required this.medallion,
    required this.title,
    required this.body,
    required this.primaryLabel,
    this.onPrimary,
    this.primaryVariant = AppButtonVariant.reward,
    this.secondaryLabel,
    this.onSecondary,
    this.primaryLoading = false,
    this.medallionIcon,
    this.heroMedallion = false,
    this.child,
  });

  final AppMedallionVariant medallion;
  final IconData? medallionIcon;
  final bool heroMedallion;
  final String title;
  final String body;
  final String primaryLabel;
  final VoidCallback? onPrimary;
  final AppButtonVariant primaryVariant;
  final String? secondaryLabel;
  final VoidCallback? onSecondary;
  final bool primaryLoading;

  /// Optional extra content between body and primary (e.g. a coupon code chip).
  final Widget? child;

  /// Present as a modal route. Returns true if primary was tapped.
  static Future<T?> show<T>(
    BuildContext context, {
    required Widget dialog,
    bool dismissible = true,
  }) {
    return showDialog<T>(
      context: context,
      barrierDismissible: dismissible,
      barrierColor: Colors.black.withValues(alpha: 0.6),
      builder: (_) => dialog,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.white,
      insetPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.x24),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadii.dialog),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 360),
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.x24, vertical: AppSpacing.x28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AppMedallion(
                  variant: medallion, icon: medallionIcon, hero: heroMedallion),
              const SizedBox(height: AppSpacing.x16),
              Text(title,
                  textAlign: TextAlign.center,
                  style: AppType.headingMedium
                      .copyWith(color: AppColors.textPrimary)),
              const SizedBox(height: AppSpacing.x8),
              Text(body,
                  textAlign: TextAlign.center,
                  style: AppType.bodyMedium
                      .copyWith(color: AppColors.textSecondary)),
              if (child != null) ...[
                const SizedBox(height: AppSpacing.x16),
                child!,
              ],
              const SizedBox(height: AppSpacing.x24),
              AppButton(
                label: primaryLabel,
                variant: primaryVariant,
                loading: primaryLoading,
                onPressed: onPrimary,
              ),
              if (secondaryLabel != null) ...[
                const SizedBox(height: AppSpacing.x4),
                AppButton(
                  label: secondaryLabel!,
                  variant: AppButtonVariant.text,
                  onPressed: onSecondary ?? () => Navigator.of(context).pop(),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
