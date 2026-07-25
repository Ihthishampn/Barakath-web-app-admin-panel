import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// Filled circle with an icon inside — spec §1.4 / §12.
/// Used on dialogs (medium) and Order Success / Reward Result (hero).
enum AppMedallionVariant {
  destructiveFlat, // pink circle, NO icon (Log out)
  destructiveIconed, // pink circle + red ✕
  affirmative, // mint circle + green icon
  reward, // amber circle + amber/white icon
  info, // blue circle + i
  successHero, // green filled + white check (Order Success)
}

class AppMedallion extends StatelessWidget {
  const AppMedallion({
    super.key,
    required this.variant,
    this.icon,
    this.hero = false,
  });

  final AppMedallionVariant variant;
  final IconData? icon;

  /// Hero size (~88px) for Order Success / Reward Result; else dialog size (48).
  final bool hero;

  @override
  Widget build(BuildContext context) {
    final dim = hero ? 88.0 : 48.0;
    final (bg, fg, defaultIcon) = switch (variant) {
      AppMedallionVariant.destructiveFlat => (
          AppColors.destructiveRedLight,
          AppColors.destructiveRed,
          null,
        ),
      AppMedallionVariant.destructiveIconed => (
          AppColors.destructiveRedLight,
          AppColors.destructiveRed,
          Icons.close_rounded,
        ),
      AppMedallionVariant.affirmative => (
          AppColors.brandGreenLight,
          AppColors.brandGreen,
          Icons.check_rounded,
        ),
      AppMedallionVariant.reward => (
          AppColors.brandAmber,
          Colors.white,
          Icons.card_giftcard_rounded,
        ),
      AppMedallionVariant.info => (
          AppColors.sky100,
          AppColors.sky700,
          Icons.info_outline_rounded,
        ),
      AppMedallionVariant.successHero => (
          AppColors.brandGreen,
          Colors.white,
          Icons.check_rounded,
        ),
    };
    final shown = icon ?? defaultIcon;
    return Container(
      width: dim,
      height: dim,
      decoration: BoxDecoration(
        color: bg,
        shape: BoxShape.circle,
        boxShadow: hero
            ? [
                BoxShadow(
                  color: bg.withValues(alpha: 0.35),
                  blurRadius: 24,
                  offset: const Offset(0, 8),
                )
              ]
            : null,
      ),
      child: shown == null
          ? null
          : Icon(shown, color: fg, size: hero ? 44 : 24),
    );
  }
}
