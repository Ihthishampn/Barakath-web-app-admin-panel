import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_toast.dart';
import 'data/auth_repository.dart';

/// Screen 05 — Enter Mobile Number (spec §3.3). No back button (one-way gate).
class EnterMobileScreen extends StatefulWidget {
  const EnterMobileScreen({super.key});

  @override
  State<EnterMobileScreen> createState() => _EnterMobileScreenState();
}

class _EnterMobileScreenState extends State<EnterMobileScreen> {
  final _controller = TextEditingController();
  final _focus = FocusNode();
  bool _sending = false;

  // Doc ids of the two system content pages (see scripts/seed.ts) — content
  // pages are keyed by id, not slug, matching how the Settings list already
  // navigates (`Routes.contentPage/${page.id}`).
  late final _termsTap = TapGestureRecognizer()
    ..onTap = () => context.push('${Routes.contentPage}/termsConditions');
  late final _privacyTap = TapGestureRecognizer()
    ..onTap = () => context.push('${Routes.contentPage}/privacyPolicy');

  bool get _valid => RegExp(r'^[6-9]\d{9}$').hasMatch(_controller.text);

  @override
  void initState() {
    super.initState();
    _focus.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    _termsTap.dispose();
    _privacyTap.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    // `_sending` also disables the button, but a double tap can land before the
    // rebuild — an extra send here would cost a real SMS.
    if (!_valid || _sending) return;
    setState(() => _sending = true);
    final repo = context.read<AuthRepository>();
    final e164 = AuthRepository.toE164(_controller.text);
    try {
      final session = await repo.sendOtp(e164);
      if (!mounted) return;
      // The session (id + timings) is what the OTP screen works against; the
      // code itself never leaves the server now.
      context.push(Routes.otp,
          extra: {'phone': _controller.text, 'session': session});
    } on OtpException catch (e) {
      // Covers the MSG91-side refusal too ('unavailable'), which reads as a
      // plain retryable failure rather than anything the user did wrong.
      if (mounted) {
        AppToast.show(context, e.message, variant: AppToastVariant.error);
      }
    } catch (_) {
      if (mounted) {
        AppToast.show(context, "Couldn't send the code. Please try again.",
            variant: AppToastVariant.error);
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final focused = _focus.hasFocus;
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.x28, AppSpacing.x28, AppSpacing.x28, AppSpacing.x32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Image.asset('assets/images/brand/flame_small.png',
                  height: 48, fit: BoxFit.contain),
              const SizedBox(height: AppSpacing.x20),
              Text('Enter your mobile number',
                  style: AppType.headingLarge.copyWith(
                      fontSize: 28,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.56)),
              const SizedBox(height: AppSpacing.x8),
              Text(
                "We'll send a 6-digit code to verify it's you. No passwords needed.",
                style: AppType.bodyMedium.copyWith(
                    fontSize: 15, height: 22.5 / 15, color: AppColors.textSecondary),
              ),
              const SizedBox(height: AppSpacing.x24),
              Text('Mobile number',
                  style: AppType.bodyMedium.copyWith(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textSecondary)),
              const SizedBox(height: AppSpacing.x8),
              Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(AppRadii.control),
                  border: Border.all(
                    color: focused ? AppColors.brandGreen : AppColors.borderSubtle,
                    width: focused ? 2 : 1,
                  ),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 18),
                child: Row(
                  children: [
                    Text('+91',
                        style: AppType.bodyMedium.copyWith(
                            fontSize: 15, fontWeight: FontWeight.w700)),
                    Container(
                      margin: const EdgeInsets.symmetric(horizontal: 13),
                      width: 1,
                      height: 22,
                      color: AppColors.borderSubtle,
                    ),
                    Expanded(
                      child: TextField(
                        controller: _controller,
                        focusNode: _focus,
                        autofocus: true,
                        keyboardType: TextInputType.phone,
                        maxLength: 10,
                        onChanged: (_) => setState(() {}),
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                        ],
                        style: AppType.bodyMedium.copyWith(fontSize: 15),
                        decoration: const InputDecoration(
                          counterText: '',
                          isCollapsed: true,
                          contentPadding: EdgeInsets.symmetric(vertical: 17),
                          border: InputBorder.none,
                          hintText: '00000 00000',
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.x24),
              AppButton.reward(
                label: 'Send OTP',
                loading: _sending,
                onPressed: _valid ? _send : null,
              ),
              const SizedBox(height: AppSpacing.x16),
              Center(
                child: Text.rich(
                  TextSpan(
                    text: 'By continuing you agree to our ',
                    style: AppType.bodySmall
                        .copyWith(fontSize: 11, color: AppColors.textTertiary),
                    children: [
                      TextSpan(
                        text: 'Terms & Conditions',
                        style: const TextStyle(color: AppColors.brandGreen),
                        recognizer: _termsTap,
                      ),
                      const TextSpan(text: ' and '),
                      TextSpan(
                        text: 'Privacy Policy',
                        style: const TextStyle(color: AppColors.brandGreen),
                        recognizer: _privacyTap,
                      ),
                    ],
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
