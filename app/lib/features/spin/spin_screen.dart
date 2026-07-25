import 'dart:math' as math;
import 'dart:ui' show lerpDouble;

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/router/app_router.dart';
import '../../core/services/auth_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_toast.dart';
import 'data/spin_campaign.dart';
import 'data/spin_repository.dart';
import 'spin_reward_screen.dart';

/// Segment colours, cycled around the wheel (matches the Figma palette).
const _wheelColors = [
  Color(0xFFE08A3C), // orange
  Color(0xFF16324D), // deep navy
  Color(0xFF2E6CA4), // blue
  Color(0xFFD23197), // magenta
];

/// Screen — Spin & Win (Figma node 52:8852). Reads the active campaign from
/// `spinCampaigns`, gates spinning on the customer's remaining daily spins, and
/// calls the server-authoritative `executeSpin`. The wheel animates to the slice
/// the server chose, then the reward screen is shown.
class SpinScreen extends StatefulWidget {
  const SpinScreen({super.key});

  @override
  State<SpinScreen> createState() => _SpinScreenState();
}

class _SpinScreenState extends State<SpinScreen>
    with SingleTickerProviderStateMixin {
  final _repo = SpinRepository();
  late final AnimationController _ctrl = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 3400));

  double _startAngle = 0;
  double _endAngle = 0;
  bool _spinning = false;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  double get _displayAngle {
    final t = Curves.easeOutCubic.transform(_ctrl.value);
    return lerpDouble(_startAngle, _endAngle, t)!;
  }

  Future<void> _onSpin(SpinCampaign campaign) async {
    if (_spinning || campaign.slices.isEmpty) return;
    setState(() => _spinning = true);
    try {
      final outcome = await _repo.executeSpin(campaign.id);
      final idx = campaign.slices.indexWhere((s) => s.id == outcome.sliceId);
      await _spinTo(idx >= 0 ? idx : 0, campaign.slices.length);
      if (!mounted) return;
      final slice = idx >= 0 ? campaign.slices[idx] : null;
      context.push(Routes.spinReward,
          extra: _rewardArgs(outcome, slice, campaign));
    } on FirebaseFunctionsException catch (e) {
      if (mounted) {
        AppToast.show(context, e.message ?? 'That spin could not be completed.',
            variant: AppToastVariant.error);
      }
    } catch (_) {
      if (mounted) {
        AppToast.show(context, 'That spin could not be completed.',
            variant: AppToastVariant.error);
      }
    } finally {
      if (mounted) setState(() => _spinning = false);
    }
  }

  /// Animate so slice [index] lands under the top pointer (+5 full turns).
  Future<void> _spinTo(int index, int n) async {
    const twoPi = 2 * math.pi;
    final sweep = twoPi / n;
    double norm(double a) => (a % twoPi + twoPi) % twoPi;
    final targetMod = norm(-(index + 0.5) * sweep);
    final current = norm(_endAngle);
    var delta = targetMod - current;
    if (delta < 0) delta += twoPi;
    _startAngle = _endAngle;
    _endAngle = _endAngle + twoPi * 5 + delta;
    _ctrl.reset();
    await _ctrl.forward();
  }

  SpinRewardArgs _rewardArgs(
      SpinOutcome outcome, SpinSlice? slice, SpinCampaign campaign) {
    if (outcome.prizeType == 'cashback') {
      return SpinRewardArgs(
        kind: 'cashback',
        headline: outcome.label.isNotEmpty ? outcome.label : 'Cashback',
        subtitle: 'Added to your wallet',
      );
    }
    if (outcome.prizeType == 'better_luck') {
      return SpinRewardArgs(
        kind: 'better_luck',
        headline: outcome.label.isNotEmpty ? outcome.label : 'Better luck!',
        subtitle: 'No prize this time — try again tomorrow',
      );
    }
    final min = slice?.minCartValuePaise ?? 0;
    final days = slice?.validityDays ?? campaign.rewardCouponExpiryDays;
    final parts = <String>[
      if (min > 0) 'Min order ${Money.fromPaiseCompact(min)}',
      'expires in $days ${days == 1 ? 'day' : 'days'}',
    ];
    return SpinRewardArgs(
      kind: 'coupon',
      headline: outcome.label.isNotEmpty ? outcome.label : 'You won!',
      subtitle: parts.join(' · '),
      code: outcome.couponCode,
    );
  }

  @override
  Widget build(BuildContext context) {
    final uid = context.select<AuthProvider, String?>((a) => a.uid);
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [AppColors.brandBrownDark, Color(0xFF3A2C17)],
          ),
        ),
        child: SafeArea(
          bottom: false,
          child: StreamBuilder<SpinCampaign?>(
            stream: _repo.activeCampaign(),
            builder: (context, campSnap) {
              final campaign = campSnap.data;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _header(context),
                  Expanded(
                    child: (campaign == null || campaign.slices.isEmpty)
                        ? _noCampaign(campSnap.connectionState)
                        : (uid == null
                            ? const SizedBox.shrink()
                            : _campaignBody(uid, campaign)),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _header(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x8),
      child: Row(
        children: [
          AppCircleIconButton.dark(
            icon: Icons.arrow_back_rounded,
            iconColor: Colors.white,
            onTap: () => context.pop(),
          ),
          const SizedBox(width: AppSpacing.x14),
          Text('Spin & Win',
              style: AppType.headingLarge.copyWith(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.4,
                  color: Colors.white)),
        ],
      ),
    );
  }

  Widget _noCampaign(ConnectionState state) {
    if (state == ConnectionState.waiting) {
      return const Center(
        child: CircularProgressIndicator(
            valueColor: AlwaysStoppedAnimation(AppColors.brandAmber)),
      );
    }
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.x32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.casino_rounded,
                size: 56, color: Colors.white.withValues(alpha: 0.5)),
            const SizedBox(height: AppSpacing.x16),
            Text('No spins available right now',
                textAlign: TextAlign.center,
                style: AppType.headingMedium
                    .copyWith(fontSize: 18, color: Colors.white)),
            const SizedBox(height: AppSpacing.x8),
            Text('Check back soon for your next chance to win.',
                textAlign: TextAlign.center,
                style: AppType.bodyMedium
                    .copyWith(color: Colors.white.withValues(alpha: 0.7))),
          ],
        ),
      ),
    );
  }

  Widget _campaignBody(String uid, SpinCampaign campaign) {
    return StreamBuilder<int>(
      stream: _repo.spinsLeftToday(uid, campaign),
      builder: (context, spinsSnap) {
        final spinsLeft = spinsSnap.data ?? 0;
        final hasData = spinsSnap.hasData;
        final canSpin = hasData && spinsLeft > 0 && !_spinning;
        return Column(
          children: [
            const Spacer(flex: 2),
            Text('Feeling lucky?',
                style: AppType.displayLarge.copyWith(
                    fontSize: 28,
                    fontWeight: FontWeight.w800,
                    color: Colors.white)),
            const SizedBox(height: AppSpacing.x8),
            Text(_spinsCopy(hasData, spinsLeft),
                style: AppType.bodyMedium.copyWith(
                    fontSize: 14, color: Colors.white.withValues(alpha: 0.7))),
            const Spacer(flex: 1),
            _wheel(campaign, canSpin),
            const Spacer(flex: 2),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.x20),
              child: AppButton.reward(
                label: spinsLeft <= 0 && hasData ? 'No spins left' : 'Spin now',
                loading: _spinning,
                onPressed: canSpin ? () => _onSpin(campaign) : null,
              ),
            ),
            const SizedBox(height: AppSpacing.x14),
            Text(
              'Rewards become coupons · valid ${campaign.rewardCouponExpiryDays} days · one per order',
              textAlign: TextAlign.center,
              style: AppType.bodySmall
                  .copyWith(color: Colors.white.withValues(alpha: 0.55)),
            ),
            const SizedBox(height: AppSpacing.x20),
          ],
        );
      },
    );
  }

  String _spinsCopy(bool hasData, int left) {
    if (!hasData) return 'Loading your spins…';
    if (left <= 0) return 'No spins left today';
    return 'You have $left free spin${left == 1 ? '' : 's'} today';
  }

  Widget _wheel(SpinCampaign campaign, bool canSpin) {
    const size = 300.0;
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          AnimatedBuilder(
            animation: _ctrl,
            builder: (_, _) => Transform.rotate(
              angle: _displayAngle,
              child: CustomPaint(
                size: const Size(size, size),
                painter: _WheelPainter(campaign.slices),
              ),
            ),
          ),
          // Centre hub — also a tap target to spin.
          GestureDetector(
            onTap: canSpin ? () => _onSpin(campaign) : null,
            child: Container(
              width: 74,
              height: 74,
              decoration: BoxDecoration(
                color: AppColors.brandAmber,
                shape: BoxShape.circle,
                border: Border.all(color: const Color(0xFFB88A1E), width: 3),
                boxShadow: [
                  BoxShadow(
                      color: Colors.black.withValues(alpha: 0.3),
                      blurRadius: 8,
                      offset: const Offset(0, 2)),
                ],
              ),
              alignment: Alignment.center,
              child: Text('SPIN',
                  style: AppType.bodyMedium.copyWith(
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                      color: AppColors.textPrimary,
                      letterSpacing: 0.5)),
            ),
          ),
          // Top pointer.
          const Positioned(
            top: 0,
            child: CustomPaint(size: Size(26, 22), painter: _PointerPainter()),
          ),
        ],
      ),
    );
  }
}

class _WheelPainter extends CustomPainter {
  _WheelPainter(this.slices);
  final List<SpinSlice> slices;

  @override
  void paint(Canvas canvas, Size size) {
    final r = size.width / 2;
    final center = Offset(r, r);
    const rim = 14.0;
    final wheelR = r - 2;
    final innerR = wheelR - rim;
    final n = slices.length;
    if (n == 0) return;
    final sweep = 2 * math.pi / n;

    // Metallic rim.
    canvas.drawCircle(center, wheelR, Paint()..color = const Color(0xFFAEB6C0));
    canvas.drawCircle(center, wheelR,
        Paint()..color = const Color(0xFF8B94A0)..style = PaintingStyle.stroke..strokeWidth = 2);

    // Segments.
    for (var i = 0; i < n; i++) {
      final start = -math.pi / 2 + i * sweep;
      canvas.drawArc(
        Rect.fromCircle(center: center, radius: innerR),
        start,
        sweep,
        true,
        Paint()..color = _wheelColors[i % _wheelColors.length],
      );
    }

    // Labels — radial, centred in each segment.
    for (var i = 0; i < n; i++) {
      final mid = -math.pi / 2 + (i + 0.5) * sweep;
      final label = slices[i].displayLabel;
      if (label.isEmpty) continue;
      final tp = TextPainter(
        text: TextSpan(
          text: label,
          style: const TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.w700,
              height: 1.0),
        ),
        textDirection: TextDirection.ltr,
        textAlign: TextAlign.center,
        maxLines: 2,
        ellipsis: '…',
      )..layout(maxWidth: innerR * 0.62);
      canvas.save();
      canvas.translate(center.dx, center.dy);
      canvas.rotate(mid);
      canvas.translate(innerR * 0.60, 0);
      // Flip labels on the left half so they stay upright-ish.
      final flip = mid > math.pi / 2 && mid < 3 * math.pi / 2;
      if (flip) canvas.rotate(math.pi);
      tp.paint(canvas, Offset(-tp.width / 2, -tp.height / 2));
      canvas.restore();
    }

    // Rim bolts at each segment boundary.
    final bolt = Paint()..color = Colors.white.withValues(alpha: 0.9);
    for (var i = 0; i < n; i++) {
      final a = -math.pi / 2 + i * sweep;
      final p = center +
          Offset(math.cos(a), math.sin(a)) * (wheelR - rim / 2);
      canvas.drawCircle(p, 2.5, bolt);
    }
  }

  @override
  bool shouldRepaint(covariant _WheelPainter old) => old.slices != slices;
}

class _PointerPainter extends CustomPainter {
  const _PointerPainter();
  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(size.width / 2, size.height)
      ..lineTo(0, 0)
      ..lineTo(size.width, 0)
      ..close();
    canvas.drawShadow(path, Colors.black, 3, false);
    canvas.drawPath(path, Paint()..color = AppColors.brandAmber);
    canvas.drawPath(
        path,
        Paint()
          ..color = const Color(0xFFB88A1E)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5);
  }

  @override
  bool shouldRepaint(covariant _PointerPainter oldDelegate) => false;
}
