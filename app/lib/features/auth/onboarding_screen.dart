import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/router/app_router.dart';
import '../../core/services/app_prefs.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_button.dart';

/// Screens 02–04 — Onboarding (spec §3.2). Three slides over a shared hero
/// photo, dots, headline/body, amber CTA. Skip jumps to the last slide.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _Slide {
  const _Slide(this.title, this.body, this.cta);
  final String title;
  final String body;
  final String cta;
}

const _slides = [
  _Slide(
    'Four worlds, one store',
    'Perfumes, books, clothing and Islamic essentials — handpicked and delivered with care.',
    'Next',
  ),
  _Slide(
    'Spin, earn, save',
    'Win rewards on Spin & Win, stack coupons and pay with your wallet. The more you shop, the more you save.',
    'Next',
  ),
  _Slide(
    'Checkout in seconds',
    "Saved addresses, one-tap payment and free delivery over ₹499. Nice — that's on its way!",
    'Get started',
  ),
];

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _controller = PageController();
  int _index = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    await AppPrefs.setOnboardingComplete();
    if (mounted) context.go(Routes.signin);
  }

  void _next() {
    if (_index < _slides.length - 1) {
      _controller.nextPage(
          duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
    } else {
      _finish();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // Skip
            Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(0, AppSpacing.x8,
                    AppSpacing.x24, AppSpacing.x4),
                child: TextButton(
                  onPressed: () => _controller.animateToPage(_slides.length - 1,
                      duration: const Duration(milliseconds: 250),
                      curve: Curves.easeOut),
                  child: Text('Skip',
                      style: AppType.bodyMedium.copyWith(
                          color: AppColors.brandGreen,
                          fontWeight: FontWeight.w700)),
                ),
              ),
            ),
            // Hero photo (shared across slides)
            Expanded(
              flex: 5,
              child: Container(
                width: double.infinity,
                margin: const EdgeInsets.only(top: AppSpacing.x4),
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFFF0EDE4), Color(0xFFE6DDCB)],
                  ),
                ),
                child: Image.asset('assets/images/onboarding/hero.png',
                    fit: BoxFit.cover),
              ),
            ),
            // Dots → text → CTA
            Expanded(
              flex: 4,
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(AppSpacing.x28,
                        AppSpacing.x28, AppSpacing.x28, AppSpacing.x8),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: _Dots(count: _slides.length, index: _index),
                    ),
                  ),
                  Expanded(
                    child: PageView.builder(
                      controller: _controller,
                      itemCount: _slides.length,
                      onPageChanged: (i) => setState(() => _index = i),
                      itemBuilder: (context, i) => _SlideBody(slide: _slides[i]),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(AppSpacing.x28, 0,
                        AppSpacing.x28, AppSpacing.x24),
                    child: AppButton.reward(
                        label: _slides[_index].cta, onPressed: _next),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SlideBody extends StatelessWidget {
  const _SlideBody({required this.slide});
  final _Slide slide;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.x28),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(slide.title,
              style: AppType.headingLarge.copyWith(
                  fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: -0.56)),
          const SizedBox(height: AppSpacing.x12),
          Text(slide.body,
              style: AppType.bodyMedium.copyWith(
                  fontSize: 15, height: 23.25 / 15, color: AppColors.textSecondary)),
        ],
      ),
    );
  }
}

class _Dots extends StatelessWidget {
  const _Dots({required this.count, required this.index});
  final int count;
  final int index;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.start,
      children: [
        for (var i = 0; i < count; i++) ...[
          if (i > 0) const SizedBox(width: AppSpacing.x8),
          AnimatedContainer(
            duration: const Duration(milliseconds: 250),
            width: i == index ? 22 : 6,
            height: 6,
            decoration: BoxDecoration(
              color: i == index ? AppColors.brandGreen : AppColors.borderSubtle,
              borderRadius: BorderRadius.circular(AppRadii.pill),
            ),
          ),
        ],
      ],
    );
  }
}
