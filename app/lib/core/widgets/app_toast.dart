import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

/// Bottom-anchored toast — spec §1.9.
enum AppToastVariant { neutral, success, error, info, reward }

abstract final class AppToast {
  static void show(
    BuildContext context,
    String message, {
    AppToastVariant variant = AppToastVariant.neutral,
    String? actionLabel,
    VoidCallback? onAction,
    Duration duration = const Duration(seconds: 3),
  }) {
    final messenger = ScaffoldMessenger.of(context);
    final (icon, iconColor) = switch (variant) {
      AppToastVariant.success => (Icons.check_circle_rounded, AppColors.brandGreen),
      AppToastVariant.error => (Icons.cancel_rounded, AppColors.destructiveRed),
      AppToastVariant.info => (Icons.info_rounded, AppColors.sky700),
      AppToastVariant.reward => (Icons.card_giftcard_rounded, AppColors.brandAmber),
      AppToastVariant.neutral => (null, null),
    };

    messenger
      ..clearSnackBars()
      ..showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          backgroundColor: AppColors.textPrimary,
          duration: onAction != null ? const Duration(seconds: 5) : duration,
          margin: const EdgeInsets.fromLTRB(
              AppSpacing.x16, 0, AppSpacing.x16, AppSpacing.x16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadii.field),
          ),
          content: Row(
            children: [
              if (icon != null) ...[
                Icon(icon, size: 18, color: iconColor),
                const SizedBox(width: AppSpacing.x10),
              ],
              Expanded(
                child: Text(
                  message,
                  style: AppType.bodyMedium.copyWith(color: Colors.white),
                ),
              ),
              if (actionLabel != null && onAction != null)
                TextButton(
                  onPressed: () {
                    messenger.hideCurrentSnackBar();
                    onAction();
                  },
                  child: Text(
                    actionLabel,
                    style: AppType.bodyMedium.copyWith(
                      color: AppColors.brandAmber,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
          ),
        ),
      );
  }
}
