import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/services/auth_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_toast.dart';
import '../auth/data/auth_repository.dart';

final _emailRe = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

/// Screen — Edit profile. Reached from the pencil icon on the Profile header.
/// Lets the customer edit the fields the security rules permit them to change
/// on their own `customers/{uid}` doc (name, email). Phone is the auth identity
/// and is shown read-only.
class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();

  String _phone = '';
  bool _loading = true;
  bool _touched = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final uid = context.read<AuthProvider>().uid;
    if (uid == null) {
      _loading = false;
      return;
    }
    FirebaseFirestore.instance.doc('customers/$uid').get().then((snap) {
      final d = snap.data() ?? const <String, dynamic>{};
      if (!mounted) return;
      _name.text = (d['name'] as String?)?.trim() ?? '';
      _email.text = (d['email'] as String?)?.trim() ?? '';
      _phone = (d['phone'] as String?)?.trim() ?? '';
      setState(() => _loading = false);
    }).catchError((_) {
      if (mounted) setState(() => _loading = false);
    });
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    super.dispose();
  }

  bool get _emailValid {
    final e = _email.text.trim();
    return e.isEmpty || _emailRe.hasMatch(e);
  }

  bool get _valid => _name.text.trim().isNotEmpty && _emailValid;

  Future<void> _save() async {
    setState(() => _touched = true);
    if (!_valid || _saving) return;
    final uid = context.read<AuthProvider>().uid;
    if (uid == null) return;
    setState(() => _saving = true);
    try {
      // Reuse the signup writer: besides name/email it sets `profileComplete`
      // and recomputes `searchIndex`. Writing name alone left a customer who
      // tapped "Skip" at signup flagged incomplete forever, so both the app
      // splash and the web sign-in kept bouncing them to Create Profile.
      await context.read<AuthRepository>().completeProfile(
            name: _name.text,
            email: _email.text,
          );
      if (!mounted) return;
      AppToast.show(context, 'Profile updated',
          variant: AppToastVariant.success);
      context.pop();
    } catch (_) {
      if (mounted) {
        setState(() => _saving = false);
        AppToast.show(context, "Your profile couldn't be saved.",
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
              child: _loading
                  ? const Center(
                      child: CircularProgressIndicator(
                          valueColor:
                              AlwaysStoppedAnimation(AppColors.brandGreen)))
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                          AppSpacing.x8, AppSpacing.x20, AppSpacing.x24),
                      children: [
                        _label('Full name'),
                        _field(_name, 'Enter your name',
                            invalid: _touched && _name.text.trim().isEmpty),
                        const SizedBox(height: AppSpacing.x16),
                        _label('Email'),
                        _field(_email, 'you@example.com',
                            keyboard: TextInputType.emailAddress,
                            invalid: _touched && !_emailValid),
                        if (_phone.isNotEmpty) ...[
                          const SizedBox(height: AppSpacing.x16),
                          _label('Phone'),
                          _readOnly(_phone),
                          const SizedBox(height: AppSpacing.x8),
                          Text('Your phone number is linked to your account '
                              'and can’t be changed here.',
                              style: AppType.bodySmall.copyWith(
                                  fontSize: 12,
                                  color: AppColors.textTertiary)),
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
          Text('Edit profile',
              style: AppType.headingLarge.copyWith(
                  fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
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

  Widget _field(TextEditingController controller, String hint,
      {TextInputType? keyboard, bool invalid = false}) {
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
        onChanged: (_) => setState(() {}),
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

  Widget _readOnly(String value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      decoration: BoxDecoration(
        color: AppColors.bgMuted,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      child: Text(value,
          style: AppType.bodyMedium
              .copyWith(fontSize: 15, color: AppColors.textSecondary)),
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
          label: 'Save changes',
          loading: _saving,
          onPressed: _valid ? _save : null,
        ),
      ),
    );
  }
}
