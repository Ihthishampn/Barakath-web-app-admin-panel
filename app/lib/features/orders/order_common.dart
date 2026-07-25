import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import 'data/order.dart';

/// Circle back button + screen title, shared by all order screens.
class OrderTopBar extends StatelessWidget {
  const OrderTopBar({
    super.key,
    required this.title,
    this.onBack,
    this.trailing,
    this.titleSize = 24,
  });

  final String title;
  final VoidCallback? onBack;
  final Widget? trailing;
  final double titleSize;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x12),
      child: Row(
        children: [
          GestureDetector(
            onTap: onBack ?? () => Navigator.of(context).maybePop(),
            behavior: HitTestBehavior.opaque,
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.borderSubtle),
              ),
              child: const Icon(Icons.arrow_back_rounded,
                  size: 20, color: AppColors.textPrimary),
            ),
          ),
          const SizedBox(width: AppSpacing.x14),
          Expanded(
            child: Text(title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppType.headingLarge.copyWith(
                    fontSize: titleSize,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.48)),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// Rounded status chip (e.g. "Out for delivery", "Delivered", "Cancelled").
class OrderStatusBadge extends StatelessWidget {
  const OrderStatusBadge(this.status, {super.key, this.label});
  final OrderStatus status;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = status.badgeColors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
          color: bg, borderRadius: BorderRadius.circular(AppRadii.pill)),
      child: Text(label ?? status.label,
          style: AppType.bodySmall
              .copyWith(fontSize: 12, fontWeight: FontWeight.w700, color: fg)),
    );
  }
}

/// Small tinted product thumbnail with an optional network image.
class OrderThumb extends StatelessWidget {
  const OrderThumb(
      {super.key,
      required this.imageUrl,
      required this.tint,
      this.size = 44,
      this.radius = AppRadii.tile});
  final String imageUrl;
  final String tint;
  final double size;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final bg = _hex(tint) ?? AppColors.bgMuted;
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: SizedBox(
        width: size,
        height: size,
        child: imageUrl.isNotEmpty
            ? Image.network(imageUrl,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => ColoredBox(color: bg),
                loadingBuilder: (_, child, p) =>
                    p == null ? child : ColoredBox(color: bg))
            : ColoredBox(color: bg),
      ),
    );
  }
}

Color? _hex(String? s) {
  if (s == null || s.isEmpty) return null;
  var h = s.replaceAll('#', '').trim();
  if (h.length == 6) h = 'FF$h';
  final v = int.tryParse(h, radix: 16);
  return v == null ? null : Color(v);
}
