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
import 'data/address.dart';
import 'data/address_repository.dart';

/// Same rules the web add/edit form enforces
/// (web/src/app/(shop)/account/addresses/new/page.tsx).
final _pinRe = RegExp(r'^\d{6}$');
final _phoneRe = RegExp(r'^[6-9]\d{9}$');

/// Screen — Add / edit address (Figma node 46:6729). Persists to
/// `customers/{uid}.addresses`. Pops with the saved address id on success.
///
/// Collects the SAME fields the web form does — name, phone, line1, city,
/// state, pincode, landmark. It previously took only "Flat / building" and
/// "Area" and hard-coded `state: ''` / `pincode: ''`, so every address saved
/// from the app produced an unshippable order (no pincode for the courier, no
/// place-of-supply for the GST invoice). Name/phone were silently copied from
/// the profile and could not be corrected, so an order could never be sent to
/// anyone but the account holder.
class AddAddressScreen extends StatefulWidget {
  const AddAddressScreen({super.key, this.existing});

  final Address? existing;

  @override
  State<AddAddressScreen> createState() => _AddAddressScreenState();
}

class _AddAddressScreenState extends State<AddAddressScreen> {
  final _repo = AddressRepository();
  final _name = TextEditingController();
  final _phone = TextEditingController(); // local 10 digits, "+91" is implied
  final _flat = TextEditingController();
  final _area = TextEditingController();
  final _state = TextEditingController();
  final _pincode = TextEditingController();
  final _landmark = TextEditingController();
  final _labels = const ['Home', 'Office', 'Other'];

  String _label = 'Home';
  bool _saving = false;
  bool _touched = false;

  /// The 10 digits actually typed, however the field was filled (a saved
  /// address stores "+91 98765 43210"; the profile may store either form).
  String get _localPhone {
    final d = _phone.text.replaceAll(RegExp(r'\D'), '');
    return d.length > 10 ? d.substring(d.length - 10) : d;
  }

  bool get _nameValid => _name.text.trim().isNotEmpty;
  bool get _phoneValid => _phoneRe.hasMatch(_localPhone);
  bool get _flatValid => _flat.text.trim().isNotEmpty;
  bool get _areaValid => _area.text.trim().isNotEmpty;
  bool get _stateValid => _state.text.trim().isNotEmpty;
  bool get _pincodeValid => _pinRe.hasMatch(_pincode.text.trim());

  bool get _valid =>
      _nameValid &&
      _phoneValid &&
      _flatValid &&
      _areaValid &&
      _stateValid &&
      _pincodeValid;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    if (e != null) {
      _label = _labels.contains(e.label) ? e.label : 'Home';
      _name.text = e.name;
      _phone.text = e.phone;
      _flat.text = e.line1;
      _area.text = e.city;
      _state.text = e.state;
      _pincode.text = e.pincode;
      _landmark.text = e.line2 ?? '';
    }
    _loadProfile();
  }

  /// Seed name/phone from the profile for a NEW address only, and only where
  /// the customer hasn't typed something else — they are now editable fields,
  /// not hidden copies, so an order can be sent to somebody else.
  Future<void> _loadProfile() async {
    if (widget.existing != null) return;
    final uid = context.read<AuthProvider>().uid;
    if (uid == null) return;
    try {
      final snap = await FirebaseFirestore.instance.doc('customers/$uid').get();
      final d = snap.data();
      if (d == null || !mounted) return;
      setState(() {
        if (_name.text.trim().isEmpty) {
          _name.text = (d['name'] as String?)?.trim() ?? '';
        }
        if (_phone.text.trim().isEmpty) {
          _phone.text = (d['phone'] as String?)?.trim() ?? '';
        }
      });
    } catch (_) {
      // Offline — the fields simply start empty and are typed in by hand.
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _flat.dispose();
    _area.dispose();
    _state.dispose();
    _pincode.dispose();
    _landmark.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _touched = true);
    if (_saving) return;
    if (!_valid) {
      AppToast.show(context, 'Please fix the highlighted fields.',
          variant: AppToastVariant.error);
      return;
    }
    final uid = context.read<AuthProvider>().uid;
    if (uid == null) return;
    setState(() => _saving = true);
    final local = _localPhone;
    final landmark = _landmark.text.trim();
    final address = Address(
      id: widget.existing?.id ??
          DateTime.now().microsecondsSinceEpoch.toString(),
      label: _label,
      name: _name.text.trim(),
      // Stored exactly as the web stores it, so one account's addresses read
      // the same on both surfaces.
      phone: '+91 ${local.substring(0, 5)} ${local.substring(5)}',
      line1: _flat.text.trim(),
      line2: landmark.isEmpty ? null : landmark,
      city: _area.text.trim(),
      state: _state.text.trim(),
      pincode: _pincode.text.trim(),
      isDefault: widget.existing?.isDefault ?? false,
    );
    try {
      final id = await _repo.save(uid, address);
      if (!mounted) return;
      AppToast.show(context,
          widget.existing != null ? 'Address updated.' : 'Address saved.',
          variant: AppToastVariant.success);
      context.pop(id);
    } on StateError catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        AppToast.show(context, e.message, variant: AppToastVariant.error);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _saving = false);
        AppToast.show(context, 'Could not save the address. Please try again.',
            variant: AppToastVariant.error);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x8),
              child: Row(
                children: [
                  AppCircleIconButton(
                    icon: Icons.arrow_back_rounded,
                    iconColor: AppColors.textPrimary,
                    onTap: () => context.pop(),
                  ),
                  const SizedBox(width: AppSpacing.x12),
                  Text(widget.existing != null ? 'Edit address' : 'Add address',
                      style: AppType.headingLarge.copyWith(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.4)),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                    AppSpacing.x8, AppSpacing.x20, AppSpacing.x24),
                children: [
                  _mapPlaceholder(),
                  const SizedBox(height: AppSpacing.x20),
                  _fieldLabel('Address label'),
                  const SizedBox(height: AppSpacing.x10),
                  Row(
                    children: [
                      for (final l in _labels) ...[
                        _labelChip(l),
                        const SizedBox(width: AppSpacing.x10),
                      ],
                    ],
                  ),
                  const SizedBox(height: AppSpacing.x20),
                  _fieldLabel('Full name'),
                  const SizedBox(height: AppSpacing.x8),
                  _textField(_name, 'Who is this order for?',
                      invalid: !_nameValid,
                      capitalization: TextCapitalization.words),
                  const SizedBox(height: AppSpacing.x16),
                  _fieldLabel('Mobile number'),
                  const SizedBox(height: AppSpacing.x8),
                  _textField(_phone, '10-digit mobile number',
                      invalid: !_phoneValid,
                      keyboard: TextInputType.phone,
                      formatters: [LengthLimitingTextInputFormatter(16)]),
                  const SizedBox(height: AppSpacing.x16),
                  _fieldLabel('Flat / building'),
                  const SizedBox(height: AppSpacing.x8),
                  _textField(_flat, 'Flat 12, Marina Residency',
                      invalid: !_flatValid,
                      capitalization: TextCapitalization.words),
                  const SizedBox(height: AppSpacing.x16),
                  _fieldLabel('Area'),
                  const SizedBox(height: AppSpacing.x8),
                  _textField(_area, 'Kakkanad, Kochi',
                      invalid: !_areaValid,
                      capitalization: TextCapitalization.words),
                  const SizedBox(height: AppSpacing.x16),
                  _fieldLabel('State'),
                  const SizedBox(height: AppSpacing.x8),
                  _textField(_state, 'Kerala',
                      invalid: !_stateValid,
                      capitalization: TextCapitalization.words),
                  const SizedBox(height: AppSpacing.x16),
                  _fieldLabel('Pincode'),
                  const SizedBox(height: AppSpacing.x8),
                  _textField(_pincode, '6-digit pincode',
                      invalid: !_pincodeValid,
                      keyboard: TextInputType.number,
                      formatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(6),
                      ]),
                  const SizedBox(height: AppSpacing.x16),
                  _fieldLabel('Landmark (optional)'),
                  const SizedBox(height: AppSpacing.x8),
                  _textField(_landmark, 'Near the metro station',
                      invalid: false,
                      capitalization: TextCapitalization.sentences),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                  AppSpacing.x12, AppSpacing.x20, AppSpacing.x12),
              decoration: const BoxDecoration(
                color: Colors.white,
                border: Border(top: BorderSide(color: AppColors.borderSubtle)),
              ),
              child: SafeArea(
                top: false,
                child: AppButton.reward(
                  label: 'Save address',
                  loading: _saving,
                  // Always tappable: the field errors below only surface once
                  // Save has been pressed, so a disabled button left the
                  // customer with no way to find out what was missing.
                  onPressed: _save,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _mapPlaceholder() {
    return Container(
      height: 150,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadii.hero),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.brandGreenSubtle, Color(0xFFD6E7DC)],
        ),
      ),
      alignment: Alignment.center,
      child: const Icon(Icons.location_on_rounded,
          size: 34, color: AppColors.brandGreen),
    );
  }

  Widget _labelChip(String l) {
    final selected = _label == l;
    return GestureDetector(
      onTap: () => setState(() => _label = l),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
        decoration: BoxDecoration(
          color: selected ? AppColors.brandGreen : Colors.white,
          borderRadius: BorderRadius.circular(AppRadii.pill),
          border: Border.all(
              color: selected ? AppColors.brandGreen : AppColors.borderSubtle),
        ),
        child: Text(l,
            style: AppType.bodyMedium.copyWith(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: selected ? Colors.white : AppColors.textPrimary)),
      ),
    );
  }

  Widget _fieldLabel(String text) => Text(text,
      style: AppType.bodyMedium.copyWith(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: AppColors.textSecondary));

  Widget _textField(
    TextEditingController controller,
    String hint, {
    required bool invalid,
    TextInputType? keyboard,
    List<TextInputFormatter>? formatters,
    TextCapitalization capitalization = TextCapitalization.none,
  }) {
    final showError = _touched && invalid;
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(
            color: showError ? AppColors.destructiveRed : AppColors.borderSubtle),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: TextField(
        controller: controller,
        keyboardType: keyboard,
        inputFormatters: formatters,
        textCapitalization: capitalization,
        onChanged: (_) => setState(() {}),
        style: AppType.bodyMedium
            .copyWith(fontSize: 15, color: AppColors.textPrimary),
        decoration: InputDecoration(
          isCollapsed: true,
          contentPadding: const EdgeInsets.symmetric(vertical: 16),
          border: InputBorder.none,
          hintText: hint,
          hintStyle: AppType.bodyMedium
              .copyWith(fontSize: 15, color: AppColors.textTertiary),
        ),
      ),
    );
  }
}
