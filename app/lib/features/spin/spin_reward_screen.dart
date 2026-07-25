import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_toast.dart';

/// The prize to present on the reward screen, resolved from the `executeSpin`
/// outcome + the winning wheel slice.
class SpinRewardArgs {
  const SpinRewardArgs({
    required this.kind, // 'coupon' | 'cashback' | 'better_luck'
    required this.headline,
    required this.subtitle,
    this.code,
  });

  final String kind;
  final String headline;
  final String subtitle;
  final String? code;

  bool get isCoupon => kind == 'coupon';
  bool get isCashback => kind == 'cashback';
}

/// Screen — Spin reward (Figma node 52:8895). A celebratory card over the
/// immersive Spin & Win backdrop. For a coupon win, "Save to coupons" opens the
/// My Coupons screen (the coupon is already saved server-side by `executeSpin`).
class SpinRewardScreen extends StatelessWidget {
  const SpinRewardScreen({super.key, required this.args});

  final SpinRewardArgs args;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFF2A2118), Color(0xFF4A3A22)],
          ),
        ),
        child: Container(
          color: Colors.black.withValues(alpha: 0.35),
          child: SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 28),
                child: _card(context),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _card(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 28, 24, 28),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.4),
            blurRadius: 30,
            offset: const Offset(0, 30),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 76,
            height: 76,
            decoration: const BoxDecoration(
              color: AppColors.brandAmber,
              shape: BoxShape.circle,
            ),
            child: Icon(
              args.isCashback
                  ? Icons.account_balance_wallet_rounded
                  : Icons.card_giftcard_rounded,
              size: 38,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: AppSpacing.x16),
          Text(
            args.kind == 'better_luck' ? 'SO CLOSE' : 'YOU WON',
            style: AppType.labelUppercase.copyWith(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.78,
              color: AppColors.brandGoldStrong,
            ),
          ),
          const SizedBox(height: AppSpacing.x8),
          Text(
            args.headline,
            textAlign: TextAlign.center,
            style: AppType.displayLarge.copyWith(
              fontSize: 34,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.68,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: AppSpacing.x8),
          Text(
            args.subtitle,
            textAlign: TextAlign.center,
            style: AppType.bodyMedium.copyWith(
                fontSize: 14, color: AppColors.textSecondary),
          ),
          if (args.code != null) ...[
            const SizedBox(height: 18),
            _codePill(context, args.code!),
          ],
          const SizedBox(height: 18),
          _cta(context),
        ],
      ),
    );
  }

  Widget _codePill(BuildContext context, String code) {
    return GestureDetector(
      onTap: () async {
        await Clipboard.setData(ClipboardData(text: code));
        if (context.mounted) {
          AppToast.show(context, 'Code copied',
              variant: AppToastVariant.success);
        }
      },
      child: CustomPaint(
        painter: _DashedRoundedBorder(
            color: AppColors.brandGoldBorder, radius: 8, strokeWidth: 2),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.brandGoldSubtle,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            code,
            textAlign: TextAlign.center,
            style: AppType.bodyLarge.copyWith(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              letterSpacing: 2,
              color: AppColors.brandGoldStrong,
            ),
          ),
        ),
      ),
    );
  }

  Widget _cta(BuildContext context) {
    if (args.isCoupon) {
      return AppButton.reward(
        label: 'Save to coupons',
        onPressed: () => context.pushReplacement(Routes.myCoupons),
      );
    }
    if (args.isCashback) {
      return AppButton.reward(
        label: 'Go to wallet',
        onPressed: () => context.go(Routes.wallet),
      );
    }
    return AppButton.reward(
      label: 'Spin again',
      onPressed: () => context.pop(),
    );
  }
}

/// Dashed rounded rectangle border (reward code pill).
class _DashedRoundedBorder extends CustomPainter {
  _DashedRoundedBorder(
      {required this.color, required this.radius, required this.strokeWidth});
  final Color color;
  final double radius;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = strokeWidth
      ..style = PaintingStyle.stroke;
    final rrect = RRect.fromRectAndRadius(
        Offset.zero & size, Radius.circular(radius));
    final path = Path()..addRRect(rrect);
    const dash = 6.0, gap = 4.0;
    for (final metric in path.computeMetrics()) {
      var dist = 0.0;
      while (dist < metric.length) {
        canvas.drawPath(metric.extractPath(dist, dist + dash), paint);
        dist += dash + gap;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DashedRoundedBorder old) => old.color != color;
}
