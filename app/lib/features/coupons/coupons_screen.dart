import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/services/auth_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/expiry.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import 'data/coupon_repository.dart';
import 'data/user_coupon.dart';

/// Screen — My Coupons (Figma node 52:8927). The customer's own coupons
/// (`customers/{uid}/coupons`), bucketed into Active / Used / Expired. Reward
/// coupons won on the Spin & Win wheel land here.
class CouponsScreen extends StatefulWidget {
  const CouponsScreen({super.key});

  @override
  State<CouponsScreen> createState() => _CouponsScreenState();
}

class _CouponsScreenState extends State<CouponsScreen> {
  final _repo = CouponRepository();
  CouponState _tab = CouponState.active;

  @override
  Widget build(BuildContext context) {
    final uid = context.select<AuthProvider, String?>((a) => a.uid);
    return Scaffold(
      backgroundColor: AppColors.surfaceBackground,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _header(context),
            Expanded(
              child: uid == null
                  ? const SizedBox.shrink()
                  : StreamBuilder<List<UserCoupon>>(
                      stream: _repo.myCoupons(uid),
                      builder: (context, snap) {
                        if (snap.hasError) {
                          return const AppErrorState(
                              message:
                                  "Couldn't load your coupons. Please try again.");
                        }
                        if (!snap.hasData) return const _CouponsSkeleton();
                        final all = snap.data!;
                        final counts = <CouponState, int>{
                          for (final s in CouponState.values)
                            s: all.where((c) => c.state == s).length,
                        };
                        final visible =
                            all.where((c) => c.state == _tab).toList();
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _tabs(counts),
                            Expanded(child: _list(visible)),
                          ],
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _header(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x12),
      child: Row(
        children: [
          AppCircleIconButton(
            icon: Icons.arrow_back_rounded,
            iconColor: AppColors.textPrimary,
            onTap: () => context.pop(),
          ),
          const SizedBox(width: AppSpacing.x14),
          Text('My coupons',
              style: AppType.headingLarge.copyWith(
                  fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
        ],
      ),
    );
  }

  Widget _tabs(Map<CouponState, int> counts) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, 0, AppSpacing.x20, AppSpacing.x12),
      child: Row(
        children: [
          for (final s in CouponState.values) ...[
            _TabPill(
              label: s == CouponState.active
                  ? 'Active · ${counts[s]}'
                  : _tabLabel(s),
              selected: _tab == s,
              onTap: () => setState(() => _tab = s),
            ),
            if (s != CouponState.values.last)
              const SizedBox(width: AppSpacing.x8),
          ],
        ],
      ),
    );
  }

  String _tabLabel(CouponState s) => switch (s) {
        CouponState.active => 'Active',
        CouponState.used => 'Used',
        CouponState.expired => 'Expired',
      };

  Widget _list(List<UserCoupon> coupons) {
    if (coupons.isEmpty) {
      return AppEmptyState(
        icon: Icons.confirmation_number_outlined,
        title: switch (_tab) {
          CouponState.active => 'No active coupons',
          CouponState.used => 'No used coupons yet',
          CouponState.expired => 'No expired coupons',
        },
        subtitle: _tab == CouponState.active
            ? 'Win coupons on Spin & Win — they show up here.'
            : null,
        iconTint: AppColors.brandGoldStrong,
        iconBg: AppColors.brandGoldSubtle,
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x20),
      itemCount: coupons.length,
      separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.x14),
      itemBuilder: (_, i) => _CouponCard(coupons[i]),
    );
  }
}

class _TabPill extends StatelessWidget {
  const _TabPill(
      {required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 7),
        decoration: BoxDecoration(
          color: selected ? AppColors.brandGreen : Colors.white,
          borderRadius: BorderRadius.circular(AppRadii.pill),
          border: Border.all(
              color: selected ? AppColors.brandGreen : AppColors.borderSubtle),
        ),
        child: Text(label,
            style: AppType.bodyMedium.copyWith(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: selected ? Colors.white : AppColors.textPrimary)),
      ),
    );
  }
}

/// A coupon ticket — gold when active, muted grey when used/expired.
class _CouponCard extends StatelessWidget {
  const _CouponCard(this.coupon);
  final UserCoupon coupon;

  @override
  Widget build(BuildContext context) {
    final state = coupon.state;
    final active = state == CouponState.active;

    final panelBg = active ? AppColors.brandGoldSubtle : AppColors.surfaceChip;
    final dashColor = active ? AppColors.brandGoldBorder : AppColors.borderSubtle;
    final cardBorder = active ? AppColors.brandGoldBorder : AppColors.borderMuted;
    final iconColor = active ? AppColors.brandGoldStrong : AppColors.neutralMuted;
    final headlineColor =
        active ? AppColors.brandGoldStrong : AppColors.neutralMuted;

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: cardBorder),
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  width: 78,
                  child: CustomPaint(
                    painter: _DashedRightBorder(dashColor),
                    child: Container(
                      color: panelBg,
                      alignment: Alignment.center,
                      child: Icon(Icons.card_giftcard_rounded,
                          size: 26, color: iconColor),
                    ),
                  ),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(coupon.headline,
                            style: AppType.bodyLarge.copyWith(
                                fontSize: 18,
                                fontWeight: FontWeight.w800,
                                color: headlineColor)),
                        const SizedBox(height: 3),
                        Text(coupon.subtitle,
                            style: AppType.bodySmall.copyWith(
                                fontSize: 12, color: AppColors.textSecondary)),
                        const SizedBox(height: 3),
                        _statusLine(state),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          // "0/2" — how many of the per-customer allowance are spent. Only
          // shown when the coupon actually has a limit (an unlimited
          // promotional coupon's `usageLabel` is null).
          if (coupon.usageLabel != null)
            Positioned(
              top: 10,
              right: 12,
              child: _UsageBadge(coupon.usageLabel!, active: active),
            ),
        ],
      ),
    );
  }

  Widget _statusLine(CouponState state) {
    final (text, color) = switch (state) {
      CouponState.active => (_expiryLabel(coupon.expiresAt), AppColors.statusErrorRed),
      CouponState.used => (
          'Used${coupon.usedAt != null ? ' · ${_fmt(coupon.usedAt!)}' : ''}',
          AppColors.textTertiary
        ),
      CouponState.expired => (
          'Expired${coupon.expiresAt != null ? ' · ${_fmt(coupon.expiresAt!)}' : ''}',
          AppColors.textTertiary
        ),
    };
    return Text(text,
        style: AppType.bodySmall
            .copyWith(fontSize: 11, fontWeight: FontWeight.w700, color: color));
  }

  static String _fmt(DateTime d) => DateFormat('d MMM').format(d);

  static String _expiryLabel(DateTime? expiresAt) => expiryLabel(expiresAt);
}

/// Small "0/2" pill — how many of a coupon's per-customer uses are spent.
class _UsageBadge extends StatelessWidget {
  const _UsageBadge(this.label, {required this.active});
  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: active ? AppColors.brandGoldSubtle : AppColors.surfaceChip,
        borderRadius: BorderRadius.circular(AppRadii.pill),
        border: Border.all(
            color: active ? AppColors.brandGoldBorder : AppColors.borderMuted),
      ),
      child: Text(label,
          style: AppType.bodySmall.copyWith(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              color:
                  active ? AppColors.brandGoldStrong : AppColors.neutralMuted)),
    );
  }
}

/// Draws the dashed vertical divider at the right edge of the ticket stub.
class _DashedRightBorder extends CustomPainter {
  _DashedRightBorder(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;
    const dash = 4.0, gap = 3.0;
    final x = size.width - 1;
    var y = 0.0;
    while (y < size.height) {
      canvas.drawLine(
          Offset(x, y), Offset(x, math.min(y + dash, size.height)), paint);
      y += dash + gap;
    }
  }

  @override
  bool shouldRepaint(covariant _DashedRightBorder old) => old.color != color;
}

class _CouponsSkeleton extends StatelessWidget {
  const _CouponsSkeleton();
  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x16, AppSpacing.x20, AppSpacing.x20),
      itemCount: 4,
      separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.x14),
      itemBuilder: (_, _) =>
          const AppShimmer(height: 84, radius: 12),
    );
  }
}
