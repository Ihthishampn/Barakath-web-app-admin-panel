import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_icon_tile.dart';
import '../../core/widgets/app_pin_field.dart';
import '../../core/widgets/app_toast.dart';
import 'data/auth_repository.dart';

/// Screen 06 — OTP Verification (spec §3.4).
class OtpScreen extends StatefulWidget {
  const OtpScreen({super.key, required this.localPhone, this.session});

  /// 10-digit local number entered on the previous screen.
  final String localPhone;

  /// The session opened by `sendOtp` on the previous screen. Null only if this
  /// route was reached without one (deep link / restart), which is handled as
  /// an expired sign-in rather than a crash.
  final OtpSession? session;

  @override
  State<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends State<OtpScreen> {
  final _pinKey = GlobalKey<AppPinFieldState>();
  String _code = '';
  bool _verifying = false;
  bool _resending = false;

  /// Inline red line under the boxes — the server's own sentence when we have
  /// one. Null means "no error".
  String? _errorText;

  /// The live session. Swapped for a fresh one when the user asks for another
  /// code after the previous session died.
  OtpSession? _session;

  /// True once the session can no longer be verified or resent against
  /// (expired, out of attempts/resends, already used, blocked). The next
  /// "Resend code" tap then opens a brand-new session instead.
  bool _sessionDead = false;

  /// Resends left on the current session. At zero the session is still perfectly
  /// verifiable — only the *next* code request has to open a new session.
  int _resendsLeft = 0;

  int _remaining = 30;
  Timer? _timer;

  bool get _hasError => _errorText != null;

  @override
  void initState() {
    super.initState();
    _session = widget.session;
    if (_session == null) {
      // Nothing to verify against — say so and let the user request a new code.
      _errorText = 'This sign-in has expired. Request a new code.';
      _sessionDead = true;
      _remaining = 0;
    } else {
      _resendsLeft = _session!.maxResends;
      _startTimer(_session!.resendAfterSec);
    }
  }

  /// Countdown to the next allowed resend. Driven by the server's
  /// `resendAfterSec` so the UI can never offer a resend the server will reject.
  void _startTimer(int seconds) {
    if (mounted) {
      setState(() => _remaining = seconds); // show the countdown immediately
    } else {
      _remaining = seconds;
    }
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (_remaining <= 0) {
        t.cancel();
      } else {
        setState(() => _remaining--);
      }
    });
  }

  /// Stop the countdown and expose the resend link right away — used when the
  /// session dies, since waiting out a cooldown on a dead session is pointless.
  void _openResend() {
    _timer?.cancel();
    _remaining = 0;
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  String get _phoneDisplay {
    final d = widget.localPhone;
    return d.length == 10 ? '+91 ${d.substring(0, 5)} ${d.substring(5)}' : '+91 $d';
  }

  Future<void> _verify() async {
    // Guards the auto-submit from the pin field firing on top of a button tap,
    // and any second tap while a call is already in flight — the server counts
    // every verify as an attempt, so duplicates burn the user's budget.
    final session = _session;
    if (_code.length != 6 ||
        _verifying ||
        _resending ||
        _sessionDead || // the pin field auto-submits, so guard here too
        session == null) {
      return;
    }
    setState(() {
      _verifying = true;
      _errorText = null;
    });
    final repo = context.read<AuthRepository>();
    final e164 = AuthRepository.toE164(widget.localPhone);
    try {
      // Signs in with the server-minted custom token; the uid comes from the
      // server, so nothing is created here.
      await repo.verifyOtp(sessionId: session.sessionId, code: _code);
      // The callables never write the customer doc — that stays client-side,
      // and its `profileComplete` is still what picks the post-login route.
      final complete = await repo.ensureCustomerDoc(e164);
      // Best-effort directory write (already swallows its own errors and its
      // result is unused) — fire-and-forget instead of blocking navigation on
      // a fourth sequential round-trip.
      unawaited(repo.registerUser(e164));
      if (!mounted) return;
      context.go(complete ? Routes.home : Routes.createProfile,
          extra: {'phone': widget.localPhone});
    } on OtpException catch (e) {
      if (!mounted) return;
      // 'failed-precondition' on a verify means the code was already used, so
      // unlike on a resend it kills the session.
      final dead = e.isSessionDead || e.kind == OtpErrorKind.notAllowed;
      final codeRelated = dead || e.kind == OtpErrorKind.invalidCode;
      setState(() {
        _verifying = false;
        if (dead) {
          _sessionDead = true;
          _openResend();
        }
        // Network/unknown faults leave the typed code valid, so they are
        // toasted like every other transient failure in the app instead of
        // marking the boxes red.
        if (codeRelated) _errorText = e.message;
      });
      if (codeRelated) {
        _pinKey.currentState?.clear();
        setState(() => _code = '');
      } else {
        AppToast.show(context, e.message, variant: AppToastVariant.error);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _verifying = false);
        AppToast.show(context, "Couldn't verify the code. Please try again.",
            variant: AppToastVariant.error);
      }
    }
  }

  Future<void> _resend() async {
    // Never automatic: only a tap gets here, and only one at a time.
    if (_resending || _verifying) return;
    if (_remaining > 0) return; // cooldown still running
    setState(() {
      _resending = true;
      _errorText = null;
    });
    final repo = context.read<AuthRepository>();
    final e164 = AuthRepository.toE164(widget.localPhone);
    final session = _session;
    try {
      final int nextCooldown;
      if (session == null || _sessionDead || _resendsLeft <= 0) {
        // Nothing left to resend against, so "resend" means "start again" — a
        // fresh sendOtp, still bounded by the server's per-number hourly
        // ceiling, which is what stops this being a loophole.
        final fresh = await repo.sendOtp(e164);
        if (!mounted) return;
        _session = fresh;
        _sessionDead = false;
        _resendsLeft = fresh.maxResends;
        nextCooldown = fresh.resendAfterSec;
      } else {
        final res = await repo.resendOtp(session.sessionId);
        if (!mounted) return;
        _resendsLeft = res.resendsLeft;
        nextCooldown = res.resendAfterSec;
      }
      _pinKey.currentState?.clear();
      _code = '';
      _startTimer(nextCooldown); // resets countdown + re-renders (setState inside)
      AppToast.show(context, 'A new code has been sent to $_phoneDisplay.',
          variant: AppToastVariant.success);
    } on OtpException catch (e) {
      if (!mounted) return;
      // 'failed-precondition' here is the server's own cooldown — our countdown
      // and the server disagreed, so trust the server and re-arm the wait.
      if (e.kind == OtpErrorKind.notAllowed) {
        _startTimer(_session?.resendAfterSec ?? 30);
      } else if (e.kind == OtpErrorKind.exhausted) {
        // 'No resends left' / 'too many codes for this number'. The code the
        // user already has still works, so the session is NOT killed — only
        // the resend budget is, which routes the next tap to a fresh send.
        setState(() => _resendsLeft = 0);
      } else if (e.isSessionDead) {
        setState(() => _sessionDead = true);
      }
      AppToast.show(context, e.message, variant: AppToastVariant.error);
    } catch (_) {
      if (mounted) {
        AppToast.show(context, "Couldn't resend the code. Please try again.",
            variant: AppToastVariant.error);
      }
    } finally {
      if (mounted) setState(() => _resending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final mm = (_remaining ~/ 60).toString().padLeft(2, '0');
    final ss = (_remaining % 60).toString().padLeft(2, '0');
    // One request at a time: a resend in flight also locks the verify path.
    final busy = _verifying || _resending;
    return Scaffold(
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x12),
              child: AppCircleIconButton(
                icon: Icons.arrow_back_rounded,
                iconColor: AppColors.textPrimary,
                onTap: () => context.pop(),
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                    AppSpacing.x28, AppSpacing.x8, AppSpacing.x28, AppSpacing.x32),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const AppIconTile(
                      icon: Icons.mail_outline_rounded,
                      bg: AppColors.brandGreenSubtle,
                      iconColor: AppColors.brandGreen,
                      size: AppIconTileSize.large,
                    ),
                    const SizedBox(height: AppSpacing.x16),
                    Text('Verify your number',
                        style: AppType.headingLarge.copyWith(
                            fontSize: 26,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.52)),
                    const SizedBox(height: AppSpacing.x8),
                    Text.rich(
                      TextSpan(
                        text: 'We sent a 6-digit code to ',
                        style: AppType.bodyMedium.copyWith(
                            fontSize: 14, color: AppColors.textSecondary),
                        children: [
                          TextSpan(
                            text: _phoneDisplay,
                            style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontWeight: FontWeight.w700),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.x24),
                    AppPinField(
                      key: _pinKey,
                      hasError: _hasError,
                      onChanged: (v) => setState(() {
                        _code = v;
                        _errorText = null;
                      }),
                      onCompleted: (_) => _verify(),
                    ),
                    if (_hasError) ...[
                      const SizedBox(height: AppSpacing.x8),
                      // The server phrases these (wrong code, expired, too many
                      // attempts, already used) — show its sentence verbatim.
                      Text(_errorText!,
                          style: AppType.bodySmall
                              .copyWith(color: AppColors.destructiveRed)),
                    ],
                    const SizedBox(height: AppSpacing.x24),
                    if (_remaining > 0)
                      Text.rich(
                        TextSpan(
                          text: 'Resend code in ',
                          style: AppType.bodyMedium.copyWith(
                              fontSize: 14, color: AppColors.textSecondary),
                          children: [
                            TextSpan(
                                text: '$mm:$ss',
                                style: const TextStyle(
                                    color: AppColors.brandGreen,
                                    fontWeight: FontWeight.w700)),
                          ],
                        ),
                      )
                    else
                      Text.rich(
                        TextSpan(
                          text: "Didn't receive it? ",
                          style: AppType.bodyMedium.copyWith(
                              fontSize: 14, color: AppColors.textSecondary),
                          children: [
                            WidgetSpan(
                              alignment: PlaceholderAlignment.middle,
                              child: GestureDetector(
                                onTap: busy ? null : _resend,
                                child: Text(
                                    _resending ? 'Sending…' : 'Resend code',
                                    style: TextStyle(
                                        color: busy
                                            ? AppColors.textTertiary
                                            : AppColors.brandGreen,
                                        fontWeight: FontWeight.w700,
                                        fontSize: 14)),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.x28, 0, AppSpacing.x28, AppSpacing.x24),
              child: AppButton.reward(
                label: 'Verify & continue',
                loading: _verifying,
                // Also inert while a resend is in flight or the session is
                // gone — both make a verify certain to fail.
                onPressed: _code.length == 6 && !_resending && !_sessionDead
                    ? _verify
                    : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
