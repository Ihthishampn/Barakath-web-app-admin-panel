import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// Circular icon button — spec §2.3.
/// `.light` (white fill, colored icon) for most chrome; `.dark` for Spin & Win.
class AppCircleIconButton extends StatelessWidget {
  const AppCircleIconButton({
    super.key,
    required this.icon,
    this.onTap,
    this.dark = false,
    this.iconColor,
    this.size = 42,
    this.showDot = false,
    this.tooltip,
  });

  const AppCircleIconButton.dark({
    super.key,
    required this.icon,
    this.onTap,
    this.iconColor,
    this.size = 42,
    this.showDot = false,
    this.tooltip,
  }) : dark = true;

  final IconData icon;
  final VoidCallback? onTap;
  final bool dark;
  final Color? iconColor;
  final double size;

  /// Red notification dot (top-right) — used on the Home bell.
  final bool showDot;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final bg = dark ? const Color(0xFF3B3128) : Colors.white;
    final fg = iconColor ?? (dark ? Colors.white : AppColors.textSecondary);

    Widget button = Material(
      color: bg,
      shape: const CircleBorder(),
      elevation: dark ? 0 : 1.5,
      shadowColor: Colors.black.withValues(alpha: 0.08),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: SizedBox(
          width: size,
          height: size,
          child: Icon(icon, size: size * 0.46, color: fg),
        ),
      ),
    );

    if (showDot) {
      button = Stack(
        clipBehavior: Clip.none,
        children: [
          button,
          const Positioned(
            right: 2,
            top: 2,
            child: _Dot(),
          ),
        ],
      );
    }

    if (tooltip != null) return Tooltip(message: tooltip!, child: button);
    return button;
  }
}

class _Dot extends StatelessWidget {
  const _Dot();
  @override
  Widget build(BuildContext context) => Container(
        width: 8,
        height: 8,
        decoration: const BoxDecoration(
          color: AppColors.destructiveRed,
          shape: BoxShape.circle,
        ),
      );
}
