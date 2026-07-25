import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/constants/strings.dart';
import '../../core/router/app_router.dart';
import '../../core/services/app_prefs.dart';
import '../../core/services/auth_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import 'data/auth_repository.dart';

/// Screen 01 — Splash. Boot check + auth-route decision (spec §3.1).
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _boot());
  }

  Future<void> _boot() async {
    final auth = context.read<AuthProvider>();
    final repo = context.read<AuthRepository>();

    // Minimum splash dwell + wait for the first auth state to resolve. Wait
    // generously (not just 2s): falling through before Firebase restores a
    // persisted session would wrongly send a logged-in user to sign-in on a
    // slow cold start.
    await Future<void>.delayed(const Duration(milliseconds: 1200));
    var waited = 0;
    while (!auth.ready && waited < 8000) {
      await Future<void>.delayed(const Duration(milliseconds: 50));
      waited += 50;
    }
    if (!mounted) return;

    if (!await AppPrefs.onboardingComplete()) {
      if (mounted) context.go(Routes.onboarding);
      return;
    }
    if (!auth.isAuthenticated) {
      if (mounted) context.go(Routes.signin);
      return;
    }
    final complete = await repo.isProfileComplete();
    final skipped = await AppPrefs.profileSkipped();
    if (!mounted) return;
    context.go(complete || skipped ? Routes.home : Routes.createProfile);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Colors.white, AppColors.bootBackground],
          ),
        ),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Image.asset('assets/images/brand/lockup_full.png',
                  width: 118, fit: BoxFit.contain),
              const SizedBox(height: AppSpacing.x20),
              Opacity(
                opacity: 0.85,
                child: Text(
                  Strings.tagline,
                  style: AppType.bodyMedium.copyWith(
                    fontSize: 15,
                    letterSpacing: 0.3,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
