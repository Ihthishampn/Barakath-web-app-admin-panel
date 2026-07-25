import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import 'app_button.dart';

/// Error state — icon + message + retry (spec §14 AppErrorState).
class AppErrorState extends StatelessWidget {
  const AppErrorState({
    super.key,
    this.message = "Something went wrong.",
    this.onRetry,
    this.compact = false,
  });

  final String message;
  final VoidCallback? onRetry;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.x24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline_rounded,
                size: 40, color: AppColors.textSecondary),
            const SizedBox(height: AppSpacing.x12),
            Text(message,
                textAlign: TextAlign.center,
                style: AppType.bodyMedium
                    .copyWith(color: AppColors.textSecondary)),
            if (onRetry != null) ...[
              const SizedBox(height: AppSpacing.x16),
              AppButton.outlined(
                label: 'Try again',
                expand: false,
                onPressed: onRetry,
                height: 44,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Empty state — illustration slot + heading + sub + optional CTA (§14).
class AppEmptyState extends StatelessWidget {
  const AppEmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.ctaLabel,
    this.onCta,
    this.iconTint = AppColors.brandGreen,
    this.iconBg = AppColors.brandGreenLight,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final String? ctaLabel;
  final VoidCallback? onCta;
  final Color iconTint;
  final Color iconBg;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.x24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(color: iconBg, shape: BoxShape.circle),
              child: Icon(icon, size: 32, color: iconTint),
            ),
            const SizedBox(height: AppSpacing.x20),
            Text(title,
                textAlign: TextAlign.center,
                style: AppType.headingMedium
                    .copyWith(color: AppColors.textPrimary, fontSize: 18)),
            if (subtitle != null) ...[
              const SizedBox(height: AppSpacing.x8),
              Text(subtitle!,
                  textAlign: TextAlign.center,
                  style: AppType.bodyMedium
                      .copyWith(color: AppColors.textSecondary)),
            ],
            if (ctaLabel != null && onCta != null) ...[
              const SizedBox(height: AppSpacing.x24),
              AppButton.reward(label: ctaLabel!, expand: false, onPressed: onCta),
            ],
          ],
        ),
      ),
    );
  }
}
