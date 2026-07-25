import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'app_colors.dart';

/// Typography scale — the Figma design system uses **Manrope** (400/500/600/700/800).
///
/// Each getter returns a base style; callers may `.copyWith(color:/weight:)` for
/// local variants (e.g. bodyLarge at 700 for prices).
abstract final class AppType {
  static TextStyle _manrope({
    required double size,
    required double height,
    required FontWeight weight,
    double? spacing,
    Color color = AppColors.textPrimary,
  }) =>
      GoogleFonts.manrope(
        fontSize: size,
        height: height / size,
        fontWeight: weight,
        letterSpacing: spacing,
        color: color,
      );

  /// Wallet balance, reward headline, hero money.
  static TextStyle get displayLarge =>
      _manrope(size: 40, height: 48, weight: FontWeight.w700);

  /// Screen titles, auth heroes.
  static TextStyle get headingLarge =>
      _manrope(size: 24, height: 32, weight: FontWeight.w700);

  /// In-content section headers, dialog titles, prize headline.
  static TextStyle get headingMedium =>
      _manrope(size: 20, height: 28, weight: FontWeight.w600);

  /// Product name, price, primary field values, transaction titles.
  static TextStyle get bodyLarge =>
      _manrope(size: 16, height: 24, weight: FontWeight.w600);

  /// Default body, field labels, chip/button labels.
  static TextStyle get bodyMedium =>
      _manrope(size: 14, height: 20, weight: FontWeight.w400);

  /// Timestamps, sub-lines, disclaimers, badge text.
  static TextStyle get bodySmall =>
      _manrope(size: 12, height: 16, weight: FontWeight.w400, color: AppColors.textSecondary);

  /// Section labels — RECENT, TODAY, PAY USING, DEFAULT pill, etc.
  static TextStyle get labelUppercase => _manrope(
        size: 12,
        height: 16,
        weight: FontWeight.w600,
        spacing: 0.96, // ~0.08em at 12px
        color: AppColors.textSecondary,
      );
}
