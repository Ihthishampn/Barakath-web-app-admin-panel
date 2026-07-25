import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import 'app_toast.dart';

/// Dashed amber-border coupon code chip — spec §1.7.
/// Used for spin reward codes + affiliate referral codes. Tap copies to clipboard.
class AppCouponCodeChip extends StatelessWidget {
  const AppCouponCodeChip({super.key, required this.code, this.copyable = true});

  final String code;
  final bool copyable;

  @override
  Widget build(BuildContext context) {
    final chip = CustomPaint(
      painter: _DashedBorderPainter(
        color: AppColors.brandAmber,
        radius: AppRadii.tile,
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.x12, vertical: AppSpacing.x8),
        decoration: BoxDecoration(
          color: AppColors.brandAmberLight,
          borderRadius: BorderRadius.circular(AppRadii.tile),
        ),
        child: Text(
          code,
          style: const TextStyle(
            fontFamily: 'monospace',
            fontWeight: FontWeight.w700,
            letterSpacing: 1.5,
            color: AppColors.brandAmber,
            fontSize: 14,
          ),
        ),
      ),
    );

    if (!copyable) return chip;
    return InkWell(
      borderRadius: BorderRadius.circular(AppRadii.tile),
      onTap: () async {
        await Clipboard.setData(ClipboardData(text: code));
        if (context.mounted) {
          AppToast.show(context, 'Code copied', variant: AppToastVariant.success);
        }
      },
      child: chip,
    );
  }
}

class _DashedBorderPainter extends CustomPainter {
  _DashedBorderPainter({required this.color, required this.radius});
  final Color color;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;
    final rrect = RRect.fromRectAndRadius(
      Offset.zero & size,
      Radius.circular(radius),
    );
    final path = Path()..addRRect(rrect);
    const dash = 5.0, gap = 3.0;
    for (final metric in path.computeMetrics()) {
      var dist = 0.0;
      while (dist < metric.length) {
        canvas.drawPath(
          metric.extractPath(dist, dist + dash),
          paint,
        );
        dist += dash + gap;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DashedBorderPainter old) =>
      old.color != color || old.radius != radius;
}
