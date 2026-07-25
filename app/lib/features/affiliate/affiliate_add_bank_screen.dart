import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/services/auth_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_toast.dart';
import 'data/affiliate_models.dart';
import 'data/affiliate_repository.dart';

final _ifscRe = RegExp(r'^[A-Z]{4}0[A-Z0-9]{6}$');
final _acctRe = RegExp(r'^\d{9,18}$');

/// Screen — Add / edit bank account (Figma node 46:7750). Collects holder name,
/// account number (+ re-entry), and IFSC; resolves the bank from the IFSC
/// against Razorpay's public directory into a "verified" card; saves it to
/// `customers/{uid}.bankAccounts` (only the masked last-4 is stored).
///
/// Passing [existing] switches the same form into edit mode, exactly as
/// AddAddressScreen does. The account number fields then start EMPTY and are
/// optional — only the mask is stored, so there is no number to pre-fill, and
/// forcing a re-type just to correct a holder name would be gratuitous.
class AffiliateAddBankScreen extends StatefulWidget {
  const AffiliateAddBankScreen({super.key, this.existing});

  final BankAccount? existing;

  @override
  State<AffiliateAddBankScreen> createState() => _AffiliateAddBankScreenState();
}

class _AffiliateAddBankScreenState extends State<AffiliateAddBankScreen> {
  final _repo = AffiliateRepository();
  final _holder = TextEditingController();
  final _account = TextEditingController();
  final _reenter = TextEditingController();
  final _ifsc = TextEditingController();

  IfscInfo? _ifscInfo;
  bool _touched = false;
  bool _saving = false;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    if (e != null) {
      _holder.text = e.accountHolderName;
      _ifsc.text = e.ifsc;
      // Seed the verified card from what was saved so the form is valid before
      // the network lookup answers; the lookup below then refreshes it.
      _ifscInfo =
          IfscInfo(bank: e.bankName, branch: e.branch ?? '', city: '');
      // Refresh against the real directory, but keep the saved details if the
      // lookup can't answer — an already-saved account must stay editable
      // offline. A typed-over IFSC goes through _onIfscChanged as usual.
      _repo.lookupIfsc(e.ifsc).then((info) {
        if (mounted && info != null) setState(() => _ifscInfo = info);
      });
      return; // the holder name is the saved one, not the profile name
    }
    final uid = context.read<AuthProvider>().uid;
    if (uid != null) {
      FirebaseFirestore.instance.doc('customers/$uid').get().then((snap) {
        final name = (snap.data()?['name'] as String?)?.trim() ?? '';
        if (mounted && name.isNotEmpty && _holder.text.isEmpty) {
          _holder.text = name;
          setState(() {});
        }
      });
    }
  }

  @override
  void dispose() {
    _holder.dispose();
    _account.dispose();
    _reenter.dispose();
    _ifsc.dispose();
    super.dispose();
  }

  /// In edit mode, leaving BOTH number fields untouched keeps the saved number.
  /// Typing into either one opts back into the full 9-18 digit + match checks,
  /// so a changed number is never accepted half-entered.
  bool get _numberUntouched =>
      _isEdit && _account.text.trim().isEmpty && _reenter.text.trim().isEmpty;

  /// Edit-mode hints spell out that the number fields are optional, since the
  /// saved number cannot be shown back — only its mask.
  String get _accountHint => _isEdit
      ? 'Leave blank to keep ${widget.existing!.accountNumberMasked}'
      : 'Enter account number';
  String get _reenterHint =>
      _isEdit ? 'Only if changing the number' : 'Re-enter account number';

  bool get _accountValid =>
      _numberUntouched || _acctRe.hasMatch(_account.text.trim());
  bool get _reenterValid =>
      _numberUntouched ||
      (_reenter.text.trim().isNotEmpty &&
          _reenter.text.trim() == _account.text.trim());
  bool get _ifscValid => _ifscRe.hasMatch(_ifsc.text.trim().toUpperCase());
  bool get _valid =>
      _holder.text.trim().isNotEmpty &&
      _accountValid &&
      _reenterValid &&
      _ifscValid &&
      _ifscInfo != null;

  void _onIfscChanged(String v) {
    final up = v.toUpperCase();
    if (up != v) {
      _ifsc.value = _ifsc.value.copyWith(
        text: up,
        selection: TextSelection.collapsed(offset: up.length),
      );
    }
    if (_ifscRe.hasMatch(up)) {
      _repo.lookupIfsc(up).then((info) {
        if (mounted) setState(() => _ifscInfo = info);
      });
    } else {
      setState(() => _ifscInfo = null);
    }
  }

  Future<void> _save() async {
    setState(() => _touched = true);
    if (!_valid || _saving) return;
    final uid = context.read<AuthProvider>().uid;
    if (uid == null) return;
    setState(() => _saving = true);
    final branch =
        _ifscInfo!.city.isNotEmpty ? _ifscInfo!.city : _ifscInfo!.branch;
    try {
      if (_isEdit) {
        await _repo.updateBankAccount(
          uid,
          widget.existing!.id,
          accountHolderName: _holder.text,
          // Null (not '') when untouched, so the repository keeps the mask.
          accountNumber: _numberUntouched ? null : _account.text.trim(),
          ifsc: _ifsc.text,
          bankName: _ifscInfo!.bank,
          branch: branch,
        );
      } else {
        await _repo.addBankAccount(
          uid,
          accountHolderName: _holder.text,
          accountNumber: _account.text.trim(),
          ifsc: _ifsc.text,
          bankName: _ifscInfo!.bank,
          branch: branch,
        );
      }
      if (!mounted) return;
      AppToast.show(context,
          _isEdit ? 'Bank account updated' : 'Bank account added',
          variant: AppToastVariant.success);
      context.pop();
    } on StateError catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        AppToast.show(context, e.message, variant: AppToastVariant.error);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _saving = false);
        AppToast.show(context, "That account couldn't be saved.",
            variant: AppToastVariant.error);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surfaceBackground,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _header(context),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                    AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x24),
                children: [
                  _infoBanner(),
                  const SizedBox(height: AppSpacing.x20),
                  _label('Account holder name'),
                  _field(_holder, 'Enter account holder name',
                      invalid: _touched && _holder.text.trim().isEmpty),
                  const SizedBox(height: AppSpacing.x16),
                  _label('Account number'),
                  _field(_account, _accountHint,
                      keyboard: TextInputType.number,
                      formatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(18),
                      ],
                      invalid: _touched && !_accountValid),
                  const SizedBox(height: AppSpacing.x16),
                  _label('Re-enter account number'),
                  _field(_reenter, _reenterHint,
                      keyboard: TextInputType.number,
                      formatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(18),
                      ],
                      invalid: _touched && !_reenterValid),
                  const SizedBox(height: AppSpacing.x16),
                  _label('IFSC code'),
                  _field(_ifsc, 'Enter IFSC code',
                      onChanged: _onIfscChanged,
                      formatters: [
                        LengthLimitingTextInputFormatter(11),
                      ],
                      invalid: _touched && !_ifscValid),
                  if (_ifscInfo != null) ...[
                    const SizedBox(height: AppSpacing.x14),
                    _verifiedCard(_ifscInfo!),
                  ],
                ],
              ),
            ),
            _bottomBar(),
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
          Text(_isEdit ? 'Edit bank account' : 'Add bank account',
              style: AppType.headingLarge.copyWith(
                  fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
        ],
      ),
    );
  }

  Widget _infoBanner() {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.x14),
      decoration: BoxDecoration(
        color: AppColors.brandGreenSubtle,
        borderRadius: BorderRadius.circular(AppRadii.field),
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
            child: Text(
                'Withdraw your affiliate earnings straight to this account.',
                style: AppType.bodyMedium.copyWith(
                    fontSize: 14, color: AppColors.textPrimary)),
          ),
        ],
      ),
    );
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.x8),
        child: Text(text,
            style: AppType.bodySmall
                .copyWith(fontSize: 13, color: AppColors.textSecondary)),
      );

  Widget _field(
    TextEditingController controller,
    String hint, {
    TextInputType? keyboard,
    List<TextInputFormatter>? formatters,
    ValueChanged<String>? onChanged,
    bool invalid = false,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(
            color: invalid ? AppColors.destructiveRed : AppColors.borderSubtle),
      ),
      child: TextField(
        controller: controller,
        keyboardType: keyboard,
        inputFormatters: formatters,
        onChanged: (v) {
          if (onChanged != null) onChanged(v);
          setState(() {});
        },
        style: AppType.bodyMedium
            .copyWith(fontSize: 15, color: AppColors.textPrimary),
        decoration: InputDecoration(
          isCollapsed: true,
          border: InputBorder.none,
          hintText: hint,
          hintStyle: AppType.bodyMedium
              .copyWith(fontSize: 15, color: AppColors.textTertiary),
        ),
      ),
    );
  }

  Widget _verifiedCard(IfscInfo info) {
    final sub = [
      if (info.city.isNotEmpty) info.city else if (info.branch.isNotEmpty) info.branch,
      'verified from IFSC',
    ].join(' · ');
    return Container(
      padding: const EdgeInsets.all(AppSpacing.x14),
      decoration: BoxDecoration(
        color: AppColors.brandGreenSubtle,
        borderRadius: BorderRadius.circular(AppRadii.field),
      ),
      child: Row(
        children: [
          const Icon(Icons.check_circle_rounded,
              size: 22, color: AppColors.brandGreen),
          const SizedBox(width: AppSpacing.x12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(info.bank,
                    style: AppType.bodyMedium.copyWith(
                        fontSize: 14, fontWeight: FontWeight.w800)),
                const SizedBox(height: 1),
                Text(sub,
                    style: AppType.bodySmall.copyWith(
                        fontSize: 12, color: AppColors.textSecondary)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _bottomBar() {
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
          label: _isEdit ? 'Save changes' : 'Save account',
          loading: _saving,
          onPressed: _valid ? _save : null,
        ),
      ),
    );
  }
}
