import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

/// The 7 button variants — spec §1.5.
enum AppButtonVariant {
  /// Amber solid, black bold. All pre-login CTAs + money-forward post-login CTAs.
  reward,

  /// Green solid, white bold. Post-login secondary primaries.
  primary,

  /// Red solid, white bold. Destructive dialog primaries.
  destructive,

  /// Outlined green, white fill.
  secondary,

  /// Neutral outlined (Continue shopping, Cancel on sheets, Sort).
  outlined,

  /// Outlined red (Cancel order on Order Detail).
  destructiveOutlined,

  /// Plain link (inline Change / Track / Reorder / Log out).
  text,
}

/// Reusable pill button. Full CTAs are 52–56px tall, radius 999, 16/700.
class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.label,
    this.onPressed,
    this.variant = AppButtonVariant.reward,
    this.loading = false,
    this.expand = true,
    this.icon,
    this.height = 54,
  });

  const AppButton.reward({
    super.key,
    required this.label,
    this.onPressed,
    this.loading = false,
    this.expand = true,
    this.icon,
    this.height = 54,
  }) : variant = AppButtonVariant.reward;

  const AppButton.primary({
    super.key,
    required this.label,
    this.onPressed,
    this.loading = false,
    this.expand = true,
    this.icon,
    this.height = 54,
  }) : variant = AppButtonVariant.primary;

  const AppButton.destructive({
    super.key,
    required this.label,
    this.onPressed,
    this.loading = false,
    this.expand = true,
    this.icon,
    this.height = 54,
  }) : variant = AppButtonVariant.destructive;

  const AppButton.outlined({
    super.key,
    required this.label,
    this.onPressed,
    this.loading = false,
    this.expand = true,
    this.icon,
    this.height = 54,
  }) : variant = AppButtonVariant.outlined;

  const AppButton.secondary({
    super.key,
    required this.label,
    this.onPressed,
    this.loading = false,
    this.expand = true,
    this.icon,
    this.height = 54,
  }) : variant = AppButtonVariant.secondary;

  const AppButton.destructiveOutlined({
    super.key,
    required this.label,
    this.onPressed,
    this.loading = false,
    this.expand = true,
    this.icon,
    this.height = 54,
  }) : variant = AppButtonVariant.destructiveOutlined;

  final String label;
  final VoidCallback? onPressed;
  final AppButtonVariant variant;
  final bool loading;
  final bool expand;
  final IconData? icon;
  final double height;

  bool get _enabled => onPressed != null && !loading;

  @override
  Widget build(BuildContext context) {
    final style = _resolve();
    final child = loading
        ? SizedBox(
            height: 20,
            width: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2.2,
              valueColor: AlwaysStoppedAnimation(style.fg),
            ),
          )
        : Row(
            mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 18, color: style.fg),
                const SizedBox(width: AppSpacing.x8),
              ],
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.bodyLarge.copyWith(
                    color: style.fg,
                    fontWeight: FontWeight.w700,
                    fontSize: 16,
                  ),
                ),
              ),
            ],
          );

    if (variant == AppButtonVariant.text) {
      return TextButton(
        onPressed: _enabled ? onPressed : null,
        style: TextButton.styleFrom(
          foregroundColor: style.fg,
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.x8, vertical: AppSpacing.x4),
        ),
        child: child,
      );
    }

    // The Figma design system uses 8px-radius CTAs (not full pills).
    final radius = BorderRadius.circular(AppRadii.control);
    return Opacity(
      opacity: _enabled ? 1 : 0.5,
      child: Material(
        color: style.bg,
        shape: RoundedRectangleBorder(
          borderRadius: radius,
          side: style.border == null
              ? BorderSide.none
              : BorderSide(color: style.border!, width: 1.5),
        ),
        child: InkWell(
          onTap: _enabled ? onPressed : null,
          borderRadius: radius,
          child: SizedBox(
            height: height,
            width: expand ? double.infinity : null,
            child: Padding(
              padding: EdgeInsets.symmetric(
                  horizontal: expand ? AppSpacing.x16 : AppSpacing.x24),
              child: Center(child: child),
            ),
          ),
        ),
      ),
    );
  }

  _ButtonStyle _resolve() => switch (variant) {
        AppButtonVariant.reward =>
          const _ButtonStyle(bg: AppColors.brandAmber, fg: AppColors.textPrimary),
        AppButtonVariant.primary =>
          const _ButtonStyle(bg: AppColors.brandGreen, fg: Colors.white),
        AppButtonVariant.destructive =>
          const _ButtonStyle(bg: AppColors.destructiveRed, fg: Colors.white),
        AppButtonVariant.secondary => const _ButtonStyle(
            bg: Colors.white,
            fg: AppColors.brandGreen,
            border: AppColors.brandGreen,
          ),
        AppButtonVariant.outlined => const _ButtonStyle(
            bg: Colors.white,
            fg: AppColors.textPrimary,
            border: AppColors.borderSubtle,
          ),
        AppButtonVariant.destructiveOutlined => const _ButtonStyle(
            bg: Colors.white,
            fg: AppColors.destructiveRed,
            border: AppColors.destructiveRed,
          ),
        AppButtonVariant.text =>
          const _ButtonStyle(bg: Colors.transparent, fg: AppColors.brandGreen),
      };
}

class _ButtonStyle {
  const _ButtonStyle({required this.bg, required this.fg, this.border});
  final Color bg;
  final Color fg;
  final Color? border;
}
