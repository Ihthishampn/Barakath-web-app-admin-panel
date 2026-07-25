import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/router/app_router.dart';
import '../../core/services/auth_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_dialog.dart';
import '../../core/widgets/app_medallion.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import '../../core/widgets/app_toast.dart';
import 'data/affiliate_models.dart';
import 'data/affiliate_repository.dart';

/// Screen — Bank accounts. Lists the affiliate's saved payout accounts
/// (`customers/{uid}.bankAccounts`) with add / edit / delete / set-default,
/// reusing [AffiliateAddBankScreen] for both create and edit. Reached from the
/// Withdraw screen once at least one account exists.
///
/// Whichever account an unsettled withdrawal is pointed at is frozen — see
/// [AffiliateRepository.lockedBankIdFrom].
class AffiliateBanksScreen extends StatelessWidget {
  const AffiliateBanksScreen({super.key});

  static final _repo = AffiliateRepository();

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
                  ? const AppErrorState(
                      message: "Couldn't load your bank accounts.")
                  : _streams(context, uid),
            ),
          ],
        ),
      ),
    );
  }

  /// affiliate → withdrawals → banks. The first two exist only to work out
  /// which account is mid-payout; they are nested (rather than combined) to
  /// match how the Withdraw screen composes the same two sources.
  Widget _streams(BuildContext context, String uid) {
    return StreamBuilder<AffiliateInfo?>(
      stream: _repo.watchAffiliate(uid),
      builder: (context, affSnap) {
        return StreamBuilder<List<WithdrawalRequest>>(
          stream: _repo.watchWithdrawals(uid),
          builder: (context, wSnap) {
            final lockedId = AffiliateRepository.lockedBankIdFrom(
                affSnap.data, wSnap.data ?? const <WithdrawalRequest>[]);
            return StreamBuilder<List<BankAccount>>(
              stream: _repo.watchBanks(uid),
              builder: (context, bankSnap) {
                if (bankSnap.hasError) {
                  return const AppErrorState(
                      message: "Couldn't load your bank accounts.");
                }
                if (!bankSnap.hasData) return const _BankSkeleton();
                final banks = bankSnap.data!;
                if (banks.isEmpty) return _empty(context);
                return _list(context, uid, banks, lockedId);
              },
            );
          },
        );
      },
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
          Text('Bank accounts',
              style: AppType.headingLarge.copyWith(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.4)),
        ],
      ),
    );
  }

  Widget _list(BuildContext context, String uid, List<BankAccount> banks,
      String? lockedId) {
    final atCap = banks.length >= AffiliateRepository.maxBankAccounts;
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x24),
      children: [
        for (final b in banks) ...[
          _BankCard(
              uid: uid, bank: b, repo: _repo, locked: b.id == lockedId),
          const SizedBox(height: AppSpacing.x12),
        ],
        const SizedBox(height: AppSpacing.x4),
        AppButton.outlined(
          label: 'Add new bank account',
          icon: Icons.add_rounded,
          // Disabled rather than letting the form be filled in and then fail on
          // save — the rules cap the array at 5 and so does the repository.
          onPressed: atCap ? null : () => context.push(Routes.addBank),
        ),
        if (atCap) ...[
          const SizedBox(height: AppSpacing.x8),
          Text(
              'You can save up to ${AffiliateRepository.maxBankAccounts} bank '
              'accounts. Delete one to add another.',
              textAlign: TextAlign.center,
              style: AppType.bodySmall
                  .copyWith(fontSize: 12, color: AppColors.textSecondary)),
        ],
      ],
    );
  }

  Widget _empty(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x24, AppSpacing.x20, AppSpacing.x24),
      children: [
        const AppEmptyState(
          icon: Icons.account_balance_outlined,
          title: 'No bank accounts',
          subtitle: 'Add an account to receive your affiliate payouts.',
        ),
        const SizedBox(height: AppSpacing.x20),
        AppButton.reward(
          label: 'Add bank account',
          icon: Icons.add_rounded,
          onPressed: () => context.push(Routes.addBank),
        ),
      ],
    );
  }
}

class _BankCard extends StatelessWidget {
  const _BankCard({
    required this.uid,
    required this.bank,
    required this.repo,
    required this.locked,
  });

  final String uid;
  final BankAccount bank;
  final AffiliateRepository repo;

  /// True when an unsettled withdrawal is pointed at this account.
  final bool locked;

  void _explainLock(BuildContext context) => AppToast.show(
      context, AffiliateRepository.bankLockedMessage,
      variant: AppToastVariant.error);

  void _edit(BuildContext context) {
    if (locked) return _explainLock(context);
    context.push(Routes.addBank, extra: bank);
  }

  Future<void> _delete(BuildContext context) async {
    if (locked) return _explainLock(context);
    final ok = await AppDialog.show<bool>(
      context,
      dialog: Builder(
        builder: (ctx) => AppDialog(
          medallion: AppMedallionVariant.destructiveIconed,
          title: 'Delete this bank account?',
          body: 'This removes ${bank.label} from your payout accounts. '
              'This cannot be undone.',
          primaryLabel: 'Delete',
          primaryVariant: AppButtonVariant.destructive,
          onPrimary: () => Navigator.of(ctx).pop(true),
          secondaryLabel: 'Keep',
          onSecondary: () => Navigator.of(ctx).pop(false),
        ),
      ),
    );
    if (ok != true) return;
    try {
      await repo.deleteBankAccount(uid, bank.id);
      if (context.mounted) {
        AppToast.show(context, 'Bank account deleted',
            variant: AppToastVariant.success);
      }
    } on StateError catch (e) {
      // Raised when a withdrawal was requested elsewhere while this list was
      // open — the repository re-checks at write time.
      if (context.mounted) {
        AppToast.show(context, e.message, variant: AppToastVariant.error);
      }
    } catch (_) {
      if (context.mounted) {
        AppToast.show(context, "Couldn't delete this bank account.",
            variant: AppToastVariant.error);
      }
    }
  }

  Future<void> _setDefault(BuildContext context) async {
    try {
      await repo.setDefaultBankAccount(uid, bank.id);
      if (context.mounted) {
        AppToast.show(context, 'Default account updated',
            variant: AppToastVariant.success);
      }
    } catch (_) {
      if (context.mounted) {
        AppToast.show(context, "Couldn't update the default account.",
            variant: AppToastVariant.error);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final actionTint =
        locked ? AppColors.textTertiary : AppColors.textSecondary;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.x16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.card),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(bank.bankName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppType.bodyMedium.copyWith(
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary)),
              ),
              const SizedBox(width: AppSpacing.x8),
              GestureDetector(
                onTap: () => _edit(context),
                behavior: HitTestBehavior.opaque,
                child: Icon(Icons.edit_outlined, size: 19, color: actionTint),
              ),
              const SizedBox(width: AppSpacing.x16),
              GestureDetector(
                onTap: () => _delete(context),
                behavior: HitTestBehavior.opaque,
                child: Icon(Icons.delete_outline_rounded,
                    size: 19,
                    color: locked
                        ? AppColors.textTertiary
                        : AppColors.destructiveRed),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.x8),
          Text(bank.accountNumberMasked,
              style: AppType.bodySmall.copyWith(
                  fontWeight: FontWeight.w600, color: AppColors.textSecondary)),
          const SizedBox(height: 2),
          Text(
              [
                bank.accountHolderName,
                bank.ifsc,
                if (bank.branch != null && bank.branch!.trim().isNotEmpty)
                  bank.branch!.trim(),
              ].join(' · '),
              style: AppType.bodySmall
                  .copyWith(height: 1.4, color: AppColors.textSecondary)),
          if (bank.isDefault || locked) ...[
            const SizedBox(height: AppSpacing.x12),
            Row(
              children: [
                if (bank.isDefault) _pill('Default'),
                if (bank.isDefault && locked)
                  const SizedBox(width: AppSpacing.x8),
                // Says WHY edit/delete do nothing, before the affiliate taps.
                if (locked)
                  _pill('Payout in progress',
                      bg: AppColors.brandGoldSubtle,
                      fg: AppColors.brandGoldStrong),
              ],
            ),
          ],
          if (!bank.isDefault) ...[
            const SizedBox(height: AppSpacing.x12),
            GestureDetector(
              onTap: () => _setDefault(context),
              behavior: HitTestBehavior.opaque,
              child: Text('Set as default',
                  style: AppType.bodySmall.copyWith(
                      fontWeight: FontWeight.w800,
                      color: AppColors.brandGreen)),
            ),
          ],
        ],
      ),
    );
  }

  Widget _pill(String text, {Color? bg, Color? fg}) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: bg ?? AppColors.brandGreenSubtle,
          borderRadius: BorderRadius.circular(AppRadii.pill),
        ),
        child: Text(text,
            style: AppType.bodySmall.copyWith(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                color: fg ?? AppColors.brandGreen)),
      );
}

class _BankSkeleton extends StatelessWidget {
  const _BankSkeleton();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x24),
      children: const [
        AppShimmer(height: 108, radius: AppRadii.card),
        SizedBox(height: AppSpacing.x12),
        AppShimmer(height: 108, radius: AppRadii.card),
      ],
    );
  }
}
