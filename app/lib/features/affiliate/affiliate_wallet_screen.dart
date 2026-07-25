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
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import 'data/affiliate_models.dart';
import 'data/affiliate_repository.dart';

/// Screen — Affiliate Wallet (Figma node 46:7615). Withdrawable balance hero,
/// "Withdraw to bank" action, and a live "Recent commission" activity feed
/// (commission credits + withdrawal debits).
class AffiliateWalletScreen extends StatelessWidget {
  const AffiliateWalletScreen({super.key});

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
                builder: (context, affSnap) {
                  final aff = affSnap.data;
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _header(context),
                      Expanded(child: _body(context, uid, aff)),
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
          Text('Affiliate Wallet',
              style: AppType.headingLarge.copyWith(
                  fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
        ],
      ),
    );
  }

  Widget _body(BuildContext context, String uid, AffiliateInfo? aff) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x24),
      children: [
        _hero(aff),
        const SizedBox(height: AppSpacing.x16),
        AppButton.reward(
          label: 'Withdraw to bank',
          onPressed:
              aff == null ? null : () => context.push(Routes.completeWithdrawal),
        ),
        const SizedBox(height: AppSpacing.x24),
        Text('Recent commission',
            style: AppType.bodyLarge
                .copyWith(fontSize: 17, fontWeight: FontWeight.w800)),
        const SizedBox(height: AppSpacing.x8),
        Text(
          'You earn commission every time someone shops using your referral '
          'code. It clears after delivery, then you can withdraw to your bank.',
          style: AppType.bodySmall
              .copyWith(fontSize: 13, color: AppColors.textSecondary),
        ),
        const SizedBox(height: AppSpacing.x16),
        _activity(uid, aff),
      ],
    );
  }

  Widget _hero(AffiliateInfo? aff) {
    if (aff == null) {
      return const AppShimmer(height: 132, radius: AppRadii.hero);
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppRadii.hero),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(22, 22, 22, 24),
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [AppColors.brandAmber, AppColors.brandGoldStrong],
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('WITHDRAWABLE BALANCE',
                style: AppType.labelUppercase.copyWith(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.6,
                    color: AppColors.textPrimary)),
            const SizedBox(height: AppSpacing.x8),
            Text(Money.fromPaise(aff.confirmedBalancePaise),
                style: AppType.displayLarge.copyWith(
                    fontSize: 40,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.8,
                    color: AppColors.textPrimary)),
            const SizedBox(height: AppSpacing.x4),
            Text('${Money.fromPaise(aff.pendingBalancePaise)} pending confirmation',
                style: AppType.bodyMedium.copyWith(
                    fontSize: 14,
                    color: AppColors.textPrimary.withValues(alpha: 0.7))),
          ],
        ),
      ),
    );
  }

  Widget _activity(String uid, AffiliateInfo? aff) {
    return StreamBuilder<List<Commission>>(
      stream: _repo.watchCommissions(uid),
      builder: (context, cSnap) {
        return StreamBuilder<List<WithdrawalRequest>>(
          stream: _repo.watchWithdrawals(uid),
          builder: (context, wSnap) {
            if (cSnap.connectionState == ConnectionState.waiting &&
                !cSnap.hasData) {
              return Column(
                children: List.generate(
                    3,
                    (_) => const Padding(
                          padding: EdgeInsets.only(bottom: AppSpacing.x12),
                          child: AppShimmer(height: 52, radius: AppRadii.field),
                        )),
              );
            }
            final rows = _merge(
              cSnap.data ?? const [],
              wSnap.data ?? const [],
              aff?.referralCode ?? '',
            );
            if (rows.isEmpty) {
              return const AppEmptyState(
                icon: Icons.receipt_long_outlined,
                title: 'No commission yet',
                subtitle: 'Share your referral code to start earning.',
                iconTint: AppColors.brandGoldStrong,
                iconBg: AppColors.brandGoldSubtle,
              );
            }
            return Column(
              children: [
                for (final r in rows) ...[
                  _ActivityRow(r),
                  const SizedBox(height: AppSpacing.x14),
                ],
              ],
            );
          },
        );
      },
    );
  }

  List<_Activity> _merge(
      List<Commission> commissions, List<WithdrawalRequest> withdrawals, String code) {
    final out = <_Activity>[];
    for (final c in commissions) {
      out.add(_Activity.commission(c, code));
    }
    for (final w in withdrawals) {
      if (w.status == 'cancelled') continue;
      out.add(_Activity.withdrawal(w));
    }
    out.sort((a, b) => (b.date ?? DateTime(0)).compareTo(a.date ?? DateTime(0)));
    return out;
  }
}

/// A unified row in the affiliate activity feed.
class _Activity {
  const _Activity({
    required this.title,
    required this.subtitle,
    required this.subtitleColor,
    required this.amountText,
    required this.amountColor,
    required this.icon,
    required this.iconBg,
    required this.iconFg,
    required this.date,
  });

  final String title;
  final String subtitle;
  final Color subtitleColor;
  final String amountText;
  final Color amountColor;
  final IconData icon;
  final Color iconBg;
  final Color iconFg;
  final DateTime? date;

  factory _Activity.commission(Commission c, String code) {
    final pending = c.status == 'pending';
    final cancelled = c.status == 'cancelled';
    return _Activity(
      title: code.isEmpty ? 'Order commission' : 'Order via $code',
      subtitle: switch (c.status) {
        'confirmed' => 'Confirmed',
        'paid' => 'Paid out',
        'cancelled' => 'Cancelled',
        _ => 'Pending · clears on delivery',
      },
      subtitleColor: cancelled
          ? AppColors.textTertiary
          : pending
              ? AppColors.brandGoldStrong
              : AppColors.success,
      amountText: '+${Money.fromPaise(c.commissionPaise)}',
      amountColor: cancelled
          ? AppColors.textTertiary
          : pending
              ? AppColors.brandGoldStrong
              : AppColors.success,
      icon: Icons.groups_2_rounded,
      iconBg: pending ? AppColors.brandGoldSubtle : AppColors.brandGreenSubtle,
      iconFg: pending ? AppColors.brandGoldStrong : AppColors.brandGreen,
      date: c.accruedAt,
    );
  }

  factory _Activity.withdrawal(WithdrawalRequest w) {
    final rejected = w.isRejected;
    return _Activity(
      title: 'Withdrawal to ${w.bankLabel}',
      // Settled requests carry their own verdict — "Amount credited to your
      // bank account." when paid, the admin's reason verbatim when rejected —
      // so nothing here is inferred from `processedAt`, which BOTH outcomes set.
      subtitle: w.outcomeMessage ??
          switch (w.status) {
            'approved' || 'processing' => 'Processing',
            _ => 'Requested',
          },
      subtitleColor: rejected
          ? AppColors.destructiveRed
          : w.isPaid
              ? AppColors.textSecondary
              : AppColors.brandGoldStrong,
      // Once paid this is the NET that actually left after the processing fee,
      // not the gross that was asked for — quoting the request would overstate
      // what landed in the bank.
      amountText: '−${Money.fromPaise(w.displayAmountPaise)}',
      amountColor:
          rejected ? AppColors.textTertiary : AppColors.textPrimary,
      icon: Icons.account_balance_wallet_rounded,
      iconBg: AppColors.bgMuted,
      iconFg: AppColors.textSecondary,
      // Ordered by when the payout was settled once it has been, so a decision
      // taken days after the request doesn't sink to the bottom of the feed.
      date: w.paidAt ?? w.rejectedAt ?? w.createdAt,
    );
  }
}

class _ActivityRow extends StatelessWidget {
  const _ActivityRow(this.a);
  final _Activity a;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: a.iconBg,
            borderRadius: BorderRadius.circular(AppRadii.chipSmall),
          ),
          child: Icon(a.icon, size: 20, color: a.iconFg),
        ),
        const SizedBox(width: AppSpacing.x12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(a.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.bodyMedium.copyWith(
                      fontSize: 14, fontWeight: FontWeight.w700)),
              const SizedBox(height: 2),
              Text(a.subtitle,
                  style: AppType.bodySmall.copyWith(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: a.subtitleColor)),
            ],
          ),
        ),
        const SizedBox(width: AppSpacing.x12),
        Text(a.amountText,
            style: AppType.bodyLarge.copyWith(
                fontSize: 15, fontWeight: FontWeight.w800, color: a.amountColor)),
      ],
    );
  }
}
