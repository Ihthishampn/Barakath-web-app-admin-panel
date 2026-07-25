import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/constants/strings.dart';
import '../../core/router/app_router.dart';
import '../../core/services/auth_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_toast.dart';
import 'data/affiliate_models.dart';
import 'data/affiliate_repository.dart';

/// Screen — Affiliate dashboard (Figma node 46:7548). Total earnings hero, the
/// referral code (copy/share), and Pending / Confirmed / Referrals stats. Opens
/// the Affiliate Wallet. Reads `customers/{uid}.affiliate` + the commission
/// ledger live.
class AffiliateDashboardScreen extends StatelessWidget {
  const AffiliateDashboardScreen({super.key});

  static final _repo = AffiliateRepository();

  @override
  Widget build(BuildContext context) {
    final uid = context.select<AuthProvider, String?>((a) => a.uid);
    return Scaffold(
      backgroundColor: AppColors.surfaceBackground,
      body: SafeArea(
        bottom: false,
        child: uid == null
            ? const SizedBox.shrink()
            : StreamBuilder<AffiliateInfo?>(
                stream: _repo.watchAffiliate(uid),
                builder: (context, snap) {
                  final aff = snap.data;
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _header(context),
                      Expanded(
                        child: aff == null
                            ? _body(context, null, uid)
                            : _body(context, aff, uid),
                      ),
                      _bottomBar(context, aff),
                    ],
                  );
                },
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
          Text('Affiliate',
              style: AppType.headingLarge.copyWith(
                  fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: AppColors.brandAmber,
              borderRadius: BorderRadius.circular(AppRadii.pill),
            ),
            child: Text('ALLOCATED',
                style: AppType.bodySmall.copyWith(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary)),
          ),
        ],
      ),
    );
  }

  Widget _body(BuildContext context, AffiliateInfo? aff, String uid) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x20),
      children: [
        _hero(uid, aff),
        const SizedBox(height: AppSpacing.x16),
        _referralCard(context, aff),
        const SizedBox(height: AppSpacing.x16),
        _stats(aff),
      ],
    );
  }

  Widget _hero(String uid, AffiliateInfo? aff) {
    if (aff == null) {
      return const AppShimmer(height: 132, radius: AppRadii.hero);
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppRadii.hero),
      child: Stack(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(22, 26, 22, 23),
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment(-0.7, -1),
                end: Alignment(0.7, 1),
                colors: [Color(0xFF2A2118), Color(0xFF4A3A22)],
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('TOTAL EARNINGS',
                    style: AppType.labelUppercase.copyWith(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.48,
                        color: AppColors.brandAmber)),
                const SizedBox(height: AppSpacing.x4),
                Text(Money.fromPaise(aff.lifetimeEarningsPaise),
                    style: AppType.displayLarge.copyWith(
                        fontSize: 36,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.72,
                        color: Colors.white)),
                const SizedBox(height: AppSpacing.x4),
                StreamBuilder<List<Commission>>(
                  stream: _repo.watchCommissions(uid),
                  builder: (context, snap) {
                    final thisMonth = _thisMonthPaise(snap.data ?? const []);
                    return Text('+${Money.fromPaise(thisMonth)} this month',
                        style: AppType.bodySmall.copyWith(
                            fontSize: 13,
                            color: Colors.white.withValues(alpha: 0.8)));
                  },
                ),
              ],
            ),
          ),
          Positioned(
            right: -30,
            top: -50,
            child: Container(
              width: 150,
              height: 150,
              decoration: BoxDecoration(
                color: AppColors.brandAmber.withValues(alpha: 0.25),
                shape: BoxShape.circle,
              ),
            ),
          ),
        ],
      ),
    );
  }

  static int _thisMonthPaise(List<Commission> commissions) {
    final now = DateTime.now();
    var sum = 0;
    for (final c in commissions) {
      if (c.status == 'cancelled') continue;
      final a = c.accruedAt;
      if (a != null && a.year == now.year && a.month == now.month) {
        sum += c.commissionPaise;
      }
    }
    return sum;
  }

  Widget _referralCard(BuildContext context, AffiliateInfo? aff) {
    final code = aff?.referralCode ?? '—';
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Your referral code',
                  style: AppType.bodyMedium.copyWith(
                      fontSize: 13, fontWeight: FontWeight.w800)),
              GestureDetector(
                onTap: aff == null ? null : () => _copy(context, code, 'Code copied'),
                behavior: HitTestBehavior.opaque,
                child: Text('Copy',
                    style: AppType.bodySmall.copyWith(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppColors.brandGreen)),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.x12),
          Row(
            children: [
              Expanded(
                child: CustomPaint(
                  painter: _DashedBorder(AppColors.brandGoldBorder),
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    decoration: BoxDecoration(
                      color: AppColors.brandGoldSubtle,
                      borderRadius: BorderRadius.circular(AppRadii.control),
                    ),
                    child: Text(code,
                        style: AppType.bodyLarge.copyWith(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 2,
                            color: AppColors.brandGoldStrong)),
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.x10),
              GestureDetector(
                onTap: aff == null ? null : () => _shareLink(code),
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 17, vertical: 13),
                  decoration: BoxDecoration(
                    color: AppColors.brandAmber,
                    borderRadius: BorderRadius.circular(AppRadii.control),
                  ),
                  child: Text('Share',
                      style: AppType.bodyMedium.copyWith(
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _stats(AffiliateInfo? aff) {
    return Row(
      children: [
        Expanded(
          child: _StatCard(
            label: 'Pending',
            value: Money.fromPaise(aff?.pendingBalancePaise ?? 0),
            valueColor: AppColors.brandGoldStrong,
          ),
        ),
        const SizedBox(width: AppSpacing.x10),
        Expanded(
          child: _StatCard(
            label: 'Confirmed',
            value: Money.fromPaise(aff?.confirmedBalancePaise ?? 0),
            valueColor: AppColors.success,
          ),
        ),
        const SizedBox(width: AppSpacing.x10),
        Expanded(
          child: _StatCard(
            label: 'Referrals',
            value: '${aff?.referredCount ?? 0}',
            valueColor: AppColors.textPrimary,
          ),
        ),
      ],
    );
  }

  Widget _bottomBar(BuildContext context, AffiliateInfo? aff) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x12, AppSpacing.x20, AppSpacing.x12),
      decoration: const BoxDecoration(
        color: AppColors.surfaceBackground,
        border: Border(top: BorderSide(color: AppColors.borderSubtle)),
      ),
      child: SafeArea(
        top: false,
        child: AppButton.reward(
          label: 'Open Affiliate Wallet',
          onPressed:
              aff == null ? null : () => context.push(Routes.affiliateWallet),
        ),
      ),
    );
  }

  Future<void> _copy(BuildContext context, String text, String msg) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (context.mounted) {
      AppToast.show(context, msg, variant: AppToastVariant.success);
    }
  }

  /// "Share" opens the OS share sheet (the same `share_plus` sheet the product
  /// detail screen uses) instead of copying to the clipboard — a referral link
  /// exists to be sent to somebody, and a silent clipboard write left the
  /// affiliate to find their own way into WhatsApp.
  ///
  /// The URL is built from [Strings.referralLink] so the domain lives in ONE
  /// place: it has to keep matching the web's `/r/[code]` landing route, which
  /// is what actually attributes the referral.
  Future<void> _shareLink(String code) async {
    final link = Strings.referralLink(code);
    await Share.share(
      'Shop on ${Strings.brand} with my referral code $code\n$link',
      subject: '${Strings.brand} referral',
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard(
      {required this.label, required this.value, required this.valueColor});
  final String label;
  final String value;
  final Color valueColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: AppType.bodySmall
                  .copyWith(fontSize: 11, color: AppColors.textSecondary)),
          const SizedBox(height: AppSpacing.x4),
          Text(value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppType.bodyLarge.copyWith(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                  color: valueColor)),
        ],
      ),
    );
  }
}

/// Dashed rounded border for the referral-code pill.
class _DashedBorder extends CustomPainter {
  _DashedBorder(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;
    final rrect = RRect.fromRectAndRadius(
        Offset.zero & size, const Radius.circular(AppRadii.control));
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
  bool shouldRepaint(covariant _DashedBorder old) => old.color != color;
}
