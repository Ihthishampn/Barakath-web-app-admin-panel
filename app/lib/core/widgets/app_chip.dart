import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

/// Chip variants — spec §1.7. The foundation ships the reusable interaction
/// variants; screen-specific chrome (category tags on cards, status pills) is
/// composed from these tokens in their own parts.
enum AppChipVariant {
  /// Multi/single-select filter pill — green filled when selected.
  filter,

  /// Rating pill — amber-light filled + star when selected.
  rating,

  /// PDP variant chip — rectangular, green 2px border when selected.
  variant,

  /// Withdrawal / add-money quick amount — green tint → green solid.
  quickAmount,
}

class AppChip extends StatelessWidget {
  const AppChip({
    super.key,
    required this.label,
    this.selected = false,
    this.onTap,
    this.variant = AppChipVariant.filter,
    this.enabled = true,
    this.leadingStar = false,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;
  final AppChipVariant variant;
  final bool enabled;
  final bool leadingStar;

  @override
  Widget build(BuildContext context) {
    final isRect = variant == AppChipVariant.variant;
    final radius =
        isRect ? BorderRadius.circular(AppRadii.field) : BorderRadius.circular(AppRadii.pill);

    final style = _resolve();
    final content = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (leadingStar || variant == AppChipVariant.rating) ...[
          Icon(Icons.star_rounded,
              size: 15,
              color: selected ? AppColors.brandAmber : AppColors.textSecondary),
          const SizedBox(width: AppSpacing.x4),
        ],
        Text(
          label,
          style: AppType.bodySmall.copyWith(
            color: style.fg,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            fontSize: 13,
          ),
        ),
      ],
    );

    return Opacity(
      opacity: enabled ? 1 : 0.45,
      child: Material(
        color: style.bg,
        borderRadius: radius,
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: radius,
          child: Container(
            padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.x14, vertical: AppSpacing.x8),
            decoration: BoxDecoration(
              borderRadius: radius,
              border: Border.all(color: style.border, width: style.borderWidth),
            ),
            child: content,
          ),
        ),
      ),
    );
  }

  _ChipStyle _resolve() {
    switch (variant) {
      case AppChipVariant.filter:
        return selected
            ? const _ChipStyle(
                bg: AppColors.brandGreen, fg: Colors.white, border: AppColors.brandGreen)
            : const _ChipStyle(
                bg: Colors.white,
                fg: AppColors.textPrimary,
                border: AppColors.borderSubtle);
      case AppChipVariant.rating:
        return selected
            ? const _ChipStyle(
                bg: AppColors.brandAmberLight,
                fg: AppColors.textPrimary,
                border: AppColors.brandAmberLight)
            : const _ChipStyle(
                bg: Colors.white,
                fg: AppColors.textPrimary,
                border: AppColors.borderSubtle);
      case AppChipVariant.variant:
        return selected
            ? const _ChipStyle(
                bg: Colors.white,
                fg: AppColors.brandGreen,
                border: AppColors.brandGreen,
                borderWidth: 2)
            : const _ChipStyle(
                bg: Colors.white,
                fg: AppColors.textPrimary,
                border: AppColors.borderSubtle);
      case AppChipVariant.quickAmount:
        return selected
            ? const _ChipStyle(
                bg: AppColors.brandGreen, fg: Colors.white, border: AppColors.brandGreen)
            : const _ChipStyle(
                bg: AppColors.brandGreenLight,
                fg: AppColors.brandGreen,
                border: AppColors.brandGreenLight);
    }
  }
}

class _ChipStyle {
  const _ChipStyle({
    required this.bg,
    required this.fg,
    required this.border,
    this.borderWidth = 1,
  });
  final Color bg;
  final Color fg;
  final Color border;
  final double borderWidth;
}
