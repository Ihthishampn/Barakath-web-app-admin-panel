import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../core/router/app_router.dart';
import '../../core/services/app_prefs.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_toast.dart';
import 'data/auth_repository.dart';

/// Screen 07 — Create Profile (spec §3.5).
class CreateProfileScreen extends StatefulWidget {
  const CreateProfileScreen({super.key, required this.localPhone});

  final String localPhone;

  @override
  State<CreateProfileScreen> createState() => _CreateProfileScreenState();
}

class _CreateProfileScreenState extends State<CreateProfileScreen> {
  final _name = TextEditingController();
  final _friend = TextEditingController();
  final _email = TextEditingController();
  bool _saving = false;
  bool _photoBusy = false;
  String? _avatarUrl;
  // The profile write succeeded at least once. A referral code that the server
  // rejected keeps the customer on this screen to correct it, and that retry
  // must not re-save a profile that is already saved.
  bool _profileSaved = false;
  // The server's verdict on the code last submitted, while it can still be
  // fixed by typing a different one. Non-null ⇒ the field is flagged and the
  // account is already created and waiting.
  String? _referralError;

  bool get _valid => _name.text.trim().length >= 2;

  /// Email is optional, but if present it must look like an email — same rule as
  /// the web (`EMAIL_RE`). Empty = ok.
  bool get _emailOk {
    final e = _email.text.trim();
    return e.isEmpty || emailRe.hasMatch(e);
  }

  String get _initial {
    final n = _name.text.trim();
    return n.isEmpty ? 'B' : n[0].toUpperCase();
  }

  String get _phoneDisplay {
    final d = widget.localPhone;
    return d.length == 10 ? '+91 ${d.substring(0, 5)} ${d.substring(5)}' : '+91 $d';
  }

  @override
  void dispose() {
    _name.dispose();
    _friend.dispose();
    _email.dispose();
    super.dispose();
  }

  Future<void> _skip() async {
    await AppPrefs.setProfileSkipped();
    // Also record it on the account itself: the local pref is device-wide, so
    // without this the skip is invisible to the web/admin (and to this user on
    // any other device). Best-effort — never block entry on it.
    // Not awaited: offline, a Firestore write doesn't settle until the device
    // reconnects, which would leave Skip hanging. The local pref already gates
    // the splash route, so this is best-effort.
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid != null) {
      FirebaseFirestore.instance.doc('customers/$uid').update({
        'profileSkipped': true,
        'updatedAt': FieldValue.serverTimestamp(),
      }).catchError((Object _) {});
    }
    if (mounted) context.go(Routes.home);
  }

  /// Pick an avatar from the gallery and upload it to `avatars/{uid}/…` in
  /// Storage (owner-writable per the rules). The download URL is saved with the
  /// profile on submit.
  Future<void> _pickPhoto() async {
    if (_photoBusy) return;
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;
    try {
      final picked = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        maxWidth: 1024,
        maxHeight: 1024,
        imageQuality: 85,
      );
      if (picked == null) return;
      setState(() => _photoBusy = true);
      final ref = FirebaseStorage.instance.ref('avatars/$uid/avatar.jpg');
      await ref.putData(
        await picked.readAsBytes(),
        SettableMetadata(contentType: 'image/jpeg'),
      );
      final url = await ref.getDownloadURL();
      if (!mounted) return;
      setState(() {
        _avatarUrl = url;
        _photoBusy = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() => _photoBusy = false);
        AppToast.show(context, "Couldn't upload that photo. Please try again.",
            variant: AppToastVariant.error);
      }
    }
  }

  Future<void> _save() async {
    if (!_valid || _saving) return;
    if (!_emailOk) {
      AppToast.show(context, 'That email address looks invalid.',
          variant: AppToastVariant.error);
      return;
    }
    setState(() {
      _saving = true;
      // A fresh attempt: the last verdict was about the code as it was then.
      _referralError = null;
    });
    final repo = context.read<AuthRepository>();
    try {
      // Skipped on a retry after a rejected code — the profile landed the first
      // time round and re-writing it would only be another round-trip.
      if (!_profileSaved) {
        await repo.completeProfile(
            name: _name.text, email: _email.text, avatarUrl: _avatarUrl);
        _profileSaved = true;
      }
    } catch (_) {
      if (mounted) {
        setState(() => _saving = false);
        AppToast.show(context, 'Could not save your profile. Please try again.',
            variant: AppToastVariant.error);
      }
      return;
    }
    // From here the account AND the profile exist whatever happens next:
    // linkReferral never throws, so no referral outcome can undo them.
    //
    // Apply the friend's code against a live affiliate via the linkReferral
    // Cloud Function. Sign-up is the ONLY chance a customer has to be
    // attributed now that checkout no longer asks, so a rejection that a
    // different code would fix keeps them here — flagged, with the code they
    // typed still in the field and an explicit way out — instead of being
    // toasted away on the road to Home.
    final referral = await repo.linkReferral(_friend.text);
    if (!mounted) return;
    if (referral.message != null) {
      AppToast.show(context, referral.message!,
          variant:
              referral.ok ? AppToastVariant.success : AppToastVariant.error);
    }
    if (referral.isFixable) {
      setState(() {
        _saving = false;
        _referralError = referral.message;
      });
      return;
    }
    // Applied, absent, or final (already linked — no code will ever attach to
    // this account). Nothing left to correct, so let them in.
    context.go(Routes.home);
  }

  /// Give up on the code and enter the app. The profile is already saved by the
  /// time this can be tapped, so this abandons the attribution only.
  void _continueWithoutReferral() => context.go(Routes.home);

  @override
  Widget build(BuildContext context) {
    // Once the OTP is verified the Firebase account already exists, so there is
    // nothing to go "back" to — block the system/gesture back and drop the back
    // arrow. Leaving via Skip or Enter Barakath both `context.go(home)`, which
    // resets the router stack (Home lives in a different top-level branch), so
    // Home can never navigate back into the auth flow.
    return PopScope(
      canPop: false,
      child: Scaffold(
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: _skip,
                    child: Text('Skip',
                        style: AppType.bodyMedium.copyWith(
                            color: AppColors.brandGreen,
                            fontWeight: FontWeight.w700)),
                  ),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                    AppSpacing.x28, AppSpacing.x4, AppSpacing.x28, AppSpacing.x28),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Create your profile',
                        style: AppType.headingLarge.copyWith(
                            fontSize: 26,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.52)),
                    const SizedBox(height: AppSpacing.x4),
                    Text(
                      'Tell us a little about you — you can skip and do this later.',
                      style: AppType.bodyMedium.copyWith(
                          fontSize: 14, color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: AppSpacing.x16),
                    Center(child: _avatar()),
                    const SizedBox(height: AppSpacing.x16),
                    _field('Display name',
                        controller: _name,
                        hint: 'Your full name',
                        onChanged: (_) => setState(() {})),
                    const SizedBox(height: AppSpacing.x16),
                    _field('WhatsApp number',
                        readOnly: true, hintOverride: _phoneDisplay),
                    const SizedBox(height: AppSpacing.x16),
                    _field("Friend's code (optional)",
                        controller: _friend,
                        hint: 'Referral code',
                        icon: Icons.card_giftcard_rounded,
                        caps: true,
                        invalid: _referralError != null,
                        // Editing means a new code: drop the verdict so the
                        // field isn't still flagged for one they've changed.
                        onChanged: (_) {
                          if (_referralError != null) {
                            setState(() => _referralError = null);
                          }
                        }),
                    if (_referralError != null) ...[
                      const SizedBox(height: AppSpacing.x8),
                      _referralErrorRow(),
                    ],
                    const SizedBox(height: AppSpacing.x16),
                    _field('Email address (optional)',
                        controller: _email,
                        hint: 'you@example.com',
                        icon: Icons.mail_outline_rounded,
                        keyboardType: TextInputType.emailAddress),
                    const SizedBox(height: AppSpacing.x24),
                    AppButton.reward(
                      label: 'Enter Barakath',
                      loading: _saving,
                      onPressed: _valid ? _save : null,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    ));
  }

  Widget _avatar() {
    return SizedBox(
      width: 88,
      height: 88,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: 88,
            height: 88,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [AppColors.brandGreen, AppColors.brandGreenDark],
              ),
              image: _avatarUrl != null
                  ? DecorationImage(
                      image: NetworkImage(_avatarUrl!), fit: BoxFit.cover)
                  : null,
            ),
            alignment: Alignment.center,
            child: _photoBusy
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                        strokeWidth: 2.5, color: Colors.white),
                  )
                : (_avatarUrl == null
                    ? Text(_initial,
                        style: AppType.headingLarge.copyWith(
                            color: Colors.white,
                            fontSize: 32,
                            fontWeight: FontWeight.w800))
                    : null),
          ),
          Positioned(
            right: 0,
            bottom: 0,
            child: GestureDetector(
              onTap: _pickPhoto,
              child: Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: AppColors.brandAmber,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: AppColors.surfaceBackground, width: 3),
                ),
                child: const Icon(Icons.edit_rounded, size: 15, color: Colors.white),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// The server's verdict on the code, with the two things the customer can do
  /// about it: type a different one (the button above submits again, and the
  /// profile is not re-saved), or walk away from the attribution entirely. The
  /// account is already created either way — this must never read as a wall.
  Widget _referralErrorRow() {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(_referralError!,
              style: AppType.bodySmall.copyWith(
                  color: AppColors.destructiveRed,
                  fontWeight: FontWeight.w600)),
        ),
        const SizedBox(width: AppSpacing.x10),
        GestureDetector(
          onTap: _continueWithoutReferral,
          behavior: HitTestBehavior.opaque,
          child: Text('Continue without it',
              style: AppType.bodySmall.copyWith(
                  color: AppColors.brandGreen, fontWeight: FontWeight.w700)),
        ),
      ],
    );
  }

  Widget _field(
    String label, {
    TextEditingController? controller,
    String? hint,
    String? hintOverride,
    IconData? icon,
    bool readOnly = false,
    bool caps = false,
    bool invalid = false,
    TextInputType? keyboardType,
    ValueChanged<String>? onChanged,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: AppType.bodyMedium.copyWith(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary)),
        const SizedBox(height: 7),
        // Locked, non-editable display (e.g. the verified WhatsApp number):
        // a filled grey chip so it clearly reads as read-only — matches web.
        if (readOnly)
          Container(
            width: double.infinity,
            decoration: BoxDecoration(
              color: AppColors.bgMuted,
              borderRadius: BorderRadius.circular(AppRadii.control),
              border: Border.all(color: AppColors.borderSubtle),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 17, vertical: 15),
            child: Row(
              children: [
                if (icon != null) ...[
                  Icon(icon, size: 18, color: AppColors.textTertiary),
                  const SizedBox(width: AppSpacing.x10),
                ],
                Icon(Icons.lock_outline_rounded,
                    size: 15, color: AppColors.textTertiary),
                const SizedBox(width: AppSpacing.x8),
                Expanded(
                  child: Text(
                    hintOverride ?? hint ?? '',
                    style: AppType.bodyMedium.copyWith(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary),
                  ),
                ),
              ],
            ),
          )
        else
          Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppRadii.control),
            border: Border.all(
                color:
                    invalid ? AppColors.destructiveRed : AppColors.borderSubtle),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 17),
          child: Row(
            children: [
              if (icon != null) ...[
                Icon(icon, size: 18, color: AppColors.brandGreen),
                const SizedBox(width: AppSpacing.x10),
              ],
              Expanded(
                child: TextField(
                  controller: controller,
                  readOnly: readOnly,
                  keyboardType: keyboardType,
                  onChanged: onChanged,
                  textCapitalization:
                      caps ? TextCapitalization.characters : TextCapitalization.words,
                  inputFormatters: caps
                      ? [
                          UpperCaseFormatter(),
                          // Matches the callable's `z.string().max(40)`: a
                          // longer code is rejected as a malformed payload
                          // rather than as a code that doesn't exist.
                          LengthLimitingTextInputFormatter(40),
                        ]
                      : null,
                  style: AppType.bodyMedium.copyWith(
                      fontSize: 15,
                      color: readOnly ? AppColors.textPrimary : AppColors.textPrimary),
                  decoration: InputDecoration(
                    isCollapsed: true,
                    contentPadding: const EdgeInsets.symmetric(vertical: 15),
                    border: InputBorder.none,
                    hintText: hintOverride ?? hint,
                    hintStyle: AppType.bodyMedium.copyWith(
                        fontSize: 15,
                        color: readOnly
                            ? AppColors.textPrimary
                            : AppColors.textTertiary),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Uppercases referral-code input as the user types.
class UpperCaseFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
      TextEditingValue oldValue, TextEditingValue newValue) {
    return newValue.copyWith(text: newValue.text.toUpperCase());
  }
}
