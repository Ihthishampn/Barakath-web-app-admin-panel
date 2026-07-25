import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
import 'data/affiliate_models.dart';
import 'data/affiliate_repository.dart';

/// Screen — Withdraw funds (Figma node 46:7691, titled "Refer & earn"). Shows
/// the referral earnings banner, the withdrawable balance with an editable
/// amount, the payout bank selector, and submits a withdrawal request via the
/// `requestWithdrawal` Cloud Function (which the admin then approves/rejects).
class AffiliateWithdrawScreen extends StatefulWidget {
  const AffiliateWithdrawScreen({super.key});

  @override
  State<AffiliateWithdrawScreen> createState() =>
      _AffiliateWithdrawScreenState();
}

class _AffiliateWithdrawScreenState extends State<AffiliateWithdrawScreen> {
  final _repo = AffiliateRepository();
  final _amount = TextEditingController();

  AffiliateSettings _settings = const AffiliateSettings();
  String? _selectedBankId;
  bool _amountInitialised = false;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _repo.settings().then((s) {
      if (mounted) setState(() => _settings = s);
    });
  }

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  int get _amountPaise {
    final v = double.tryParse(_amount.text.trim());
    if (v == null) return 0;
    return (v * 100).round();
  }

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
                  if (aff != null && !_amountInitialised) {
                    _amountInitialised = true;
                    _amount.text =
                        (aff.confirmedBalancePaise / 100).toStringAsFixed(2);
                  }
                  return StreamBuilder<List<BankAccount>>(
                    stream: _repo.watchBanks(uid),
                    builder: (context, bankSnap) {
                      final banks = bankSnap.data ?? const <BankAccount>[];
                      // Re-resolve when the selected account is gone as well as
                      // when none is picked yet: deleting it from "Manage bank
                      // accounts" and coming back left this pointing at an id
                      // that no longer exists, so the card showed "Add a bank
                      // account" — and the Request button stayed dead — while
                      // other saved accounts sat right there.
                      if (_selectedBankId == null ||
                          !banks.any((b) => b.id == _selectedBankId)) {
                        _selectedBankId = _defaultBankId(banks);
                      }
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _header(context),
                          Expanded(
                            child: _body(context, uid, aff, banks),
                          ),
                        ],
                      );
                    },
                  );
                },
              ),
      ),
    );
  }

  String? _defaultBankId(List<BankAccount> banks) {
    if (banks.isEmpty) return null;
    final def = banks.where((b) => b.isDefault);
    return def.isNotEmpty ? def.first.id : banks.first.id;
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
          Text('Refer & earn',
              style: AppType.headingLarge.copyWith(
                  fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
        ],
      ),
    );
  }

  Widget _body(BuildContext context, String uid, AffiliateInfo? aff,
      List<BankAccount> banks) {
    final selected = banks.where((b) => b.id == _selectedBankId);
    final bank = selected.isNotEmpty ? selected.first : null;
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x24),
      children: [
        _earningsBanner(aff),
        const SizedBox(height: AppSpacing.x20),
        const Divider(height: 1, color: AppColors.borderSubtle),
        const SizedBox(height: AppSpacing.x20),
        Text('Withdraw funds',
            style: AppType.bodyLarge
                .copyWith(fontSize: 17, fontWeight: FontWeight.w800)),
        const SizedBox(height: AppSpacing.x12),
        _withdrawCard(context, aff, banks, bank),
        const SizedBox(height: AppSpacing.x16),
        // With nothing saved this is the only sensible action, so it stays a
        // straight "add". Once accounts exist, the same slot is the way into
        // the list, where they can be edited, deleted, defaulted or added to.
        AppButton.outlined(
          label: banks.isEmpty ? 'Add new bank account' : 'Manage bank accounts',
          onPressed: () => context
              .push(banks.isEmpty ? Routes.addBank : Routes.affiliateBanks),
        ),
        const SizedBox(height: AppSpacing.x12),
        AppButton.reward(
          label: 'Request withdrawal',
          loading: _submitting,
          onPressed: _canSubmit(aff, bank) ? () => _submit(aff!, bank!) : null,
        ),
        if (aff?.hasPendingWithdrawal == true) ...[
          const SizedBox(height: AppSpacing.x12),
          Text('A withdrawal is already in progress. You can request another '
              'once it is settled.',
              textAlign: TextAlign.center,
              style: AppType.bodySmall.copyWith(
                  fontSize: 12, color: AppColors.brandGoldStrong)),
        ],
      ],
    );
  }

  Widget _earningsBanner(AffiliateInfo? aff) {
    return Container(
      padding:
          const EdgeInsets.symmetric(horizontal: 16, vertical: AppSpacing.x16),
      decoration: BoxDecoration(
        color: AppColors.brandGreenSubtle,
        borderRadius: BorderRadius.circular(AppRadii.field),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text('Earned from ${aff?.referredCount ?? 0} referrals',
                style: AppType.bodyMedium.copyWith(
                    fontSize: 14, color: AppColors.textPrimary)),
          ),
          Text(Money.fromPaise(aff?.lifetimeEarningsPaise ?? 0),
              style: AppType.bodyLarge.copyWith(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: AppColors.brandGreen)),
        ],
      ),
    );
  }

  /// Why the typed amount can't be withdrawn, in the affiliate's own terms.
  ///
  /// These are the same two rejections [_canSubmit] uses to grey out the button
  /// and [_submit] repeats as a guard — the toasts there were unreachable, so
  /// an over-balance or under-minimum amount simply killed the button with no
  /// explanation. Stays silent while the field is blank or zero: there is
  /// nothing to object to until an amount has actually been entered.
  String? _amountIssue(AffiliateInfo? aff) {
    if (aff == null) return null;
    final amt = _amountPaise;
    if (amt <= 0) return null;
    if (amt > aff.confirmedBalancePaise) {
      return 'Amount exceeds your withdrawable balance '
          '(${Money.fromPaise(aff.confirmedBalancePaise)}).';
    }
    if (amt < _settings.minWithdrawalPaise) {
      return 'Minimum withdrawal is '
          '${Money.fromPaise(_settings.minWithdrawalPaise)}.';
    }
    return null;
  }

  Widget _withdrawCard(BuildContext context, AffiliateInfo? aff,
      List<BankAccount> banks, BankAccount? bank) {
    final issue = _amountIssue(aff);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.x16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Text('₹',
                        style: AppType.displayLarge.copyWith(
                            fontSize: 30, fontWeight: FontWeight.w800)),
                    const SizedBox(width: 2),
                    Expanded(
                      child: TextField(
                        controller: _amount,
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true),
                        inputFormatters: [
                          FilteringTextInputFormatter.allow(
                              RegExp(r'[0-9.]')),
                        ],
                        onChanged: (_) => setState(() {}),
                        style: AppType.displayLarge.copyWith(
                            fontSize: 30, fontWeight: FontWeight.w800),
                        decoration: const InputDecoration(
                          isCollapsed: true,
                          border: InputBorder.none,
                          hintText: '0.00',
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              GestureDetector(
                onTap: aff == null
                    ? null
                    : () {
                        _amount.text =
                            (aff.confirmedBalancePaise / 100).toStringAsFixed(2);
                        setState(() {});
                      },
                behavior: HitTestBehavior.opaque,
                child: Text('Withdraw all',
                    style: AppType.bodyMedium.copyWith(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: AppColors.brandGreen)),
              ),
            ],
          ),
          if (issue != null) ...[
            const SizedBox(height: AppSpacing.x8),
            Text(issue,
                style: AppType.bodySmall.copyWith(
                    fontSize: 12, color: AppColors.destructiveRed)),
          ],
          const SizedBox(height: AppSpacing.x14),
          if (bank == null)
            _noBankRow()
          else
            _bankRow(context, bank, banks),
        ],
      ),
    );
  }

  Widget _bankRow(
      BuildContext context, BankAccount bank, List<BankAccount> banks) {
    return GestureDetector(
      onTap: banks.length > 1 ? () => _pickBank(context, banks) : null,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.x12),
        decoration: BoxDecoration(
          color: AppColors.bgMuted,
          borderRadius: BorderRadius.circular(AppRadii.control),
        ),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: AppColors.brandGreen,
                borderRadius: BorderRadius.circular(AppRadii.control),
              ),
              child: const Icon(Icons.account_balance_wallet_rounded,
                  size: 18, color: Colors.white),
            ),
            const SizedBox(width: AppSpacing.x12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(bank.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppType.bodyMedium.copyWith(
                          fontSize: 14, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 1),
                  Text('Payout in 2-3 business days',
                      style: AppType.bodySmall.copyWith(
                          fontSize: 12, color: AppColors.textSecondary)),
                ],
              ),
            ),
            if (banks.length > 1)
              const Icon(Icons.arrow_forward_rounded,
                  size: 18, color: AppColors.textTertiary),
          ],
        ),
      ),
    );
  }

  Widget _noBankRow() {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.x12),
      decoration: BoxDecoration(
        color: AppColors.bgMuted,
        borderRadius: BorderRadius.circular(AppRadii.control),
      ),
      child: Row(
        children: [
          const Icon(Icons.info_outline_rounded,
              size: 18, color: AppColors.textSecondary),
          const SizedBox(width: AppSpacing.x10),
          Expanded(
            child: Text('Add a bank account to receive your payout.',
                style: AppType.bodySmall.copyWith(
                    fontSize: 12, color: AppColors.textSecondary)),
          ),
        ],
      ),
    );
  }

  Future<void> _pickBank(BuildContext context, List<BankAccount> banks) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius:
            BorderRadius.vertical(top: Radius.circular(AppRadii.sheet)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
              child: Text('Select bank account',
                  style: AppType.bodyLarge.copyWith(
                      fontSize: 16, fontWeight: FontWeight.w800)),
            ),
            for (final b in banks)
              ListTile(
                onTap: () => Navigator.of(ctx).pop(b.id),
                leading: Icon(
                    b.id == _selectedBankId
                        ? Icons.radio_button_checked_rounded
                        : Icons.radio_button_off_rounded,
                    color: b.id == _selectedBankId
                        ? AppColors.brandGreen
                        : AppColors.textTertiary),
                title: Text(b.label,
                    style: AppType.bodyMedium.copyWith(
                        fontSize: 14, fontWeight: FontWeight.w700)),
                subtitle: Text(b.accountHolderName,
                    style: AppType.bodySmall
                        .copyWith(fontSize: 12, color: AppColors.textSecondary)),
              ),
            const SizedBox(height: AppSpacing.x8),
          ],
        ),
      ),
    );
    if (picked != null && mounted) setState(() => _selectedBankId = picked);
  }

  /// Mirrors the checks `requestWithdrawal` performs, so an obviously doomed
  /// request never leaves the device. Deliberately does NOT gate on
  /// `aff.walletEnabled`: a disabled wallet is rare and the server's wording
  /// ("Wallet access is disabled on your account.") explains it, whereas a
  /// silently dead button would not. `aff == null` already covers "affiliate not
  /// enabled" — [AffiliateInfo.fromCustomer] returns null unless enabled.
  bool _canSubmit(AffiliateInfo? aff, BankAccount? bank) {
    if (_submitting || aff == null || bank == null) return false;
    if (aff.hasPendingWithdrawal) return false;
    final amt = _amountPaise;
    if (amt <= 0) return false;
    if (amt > aff.confirmedBalancePaise) return false;
    if (amt < _settings.minWithdrawalPaise) return false;
    return true;
  }

  Future<void> _submit(AffiliateInfo aff, BankAccount bank) async {
    final amt = _amountPaise;
    if (amt > aff.confirmedBalancePaise) {
      AppToast.show(context, 'Amount exceeds your withdrawable balance.',
          variant: AppToastVariant.error);
      return;
    }
    if (amt < _settings.minWithdrawalPaise) {
      AppToast.show(
          context,
          'Minimum withdrawal is ${Money.fromPaise(_settings.minWithdrawalPaise)}.',
          variant: AppToastVariant.error);
      return;
    }
    setState(() => _submitting = true);
    try {
      final shortId =
          await _repo.requestWithdrawal(amountPaise: amt, bankAccountId: bank.id);
      if (!mounted) return;
      AppToast.show(
          context,
          shortId.isEmpty
              ? 'Withdrawal requested.'
              : 'Withdrawal $shortId requested.',
          variant: AppToastVariant.success);
      context.pop();
    } on FirebaseFunctionsException catch (e) {
      if (mounted) {
        AppToast.show(context, e.message ?? "That withdrawal couldn't be requested.",
            variant: AppToastVariant.error);
      }
    } catch (_) {
      if (mounted) {
        AppToast.show(context, "That withdrawal couldn't be requested.",
            variant: AppToastVariant.error);
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }
}
