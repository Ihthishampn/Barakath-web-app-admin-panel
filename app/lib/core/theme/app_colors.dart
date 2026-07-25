import 'package:flutter/material.dart';

/// Locked design tokens — spec §1.1. India-only, INR. Brand name: "Barkath".
///
/// Do not introduce colours outside this file. Every surface pulls from here so
/// the app stays pixel-aligned with the Figma design system.
abstract final class AppColors {
  // ── Brand ─────────────────────────────────────────────────────────
  // Values verified against the Figma design system (BARAKAT_ECOM), which
  // matches the web/admin tokens — not the slightly-off spec §1.1 hexes.
  /// Primary brand (Figma "Salem") — CTAs, positives, selected fills, links.
  static const brandGreen = Color(0xFF0F7A5A);

  /// Darker green — avatar gradient end, pressed states.
  static const brandGreenDark = Color(0xFF166534);

  /// Subtle green tint (Figma "Harp") — icon tiles, positive card fills.
  static const brandGreenSubtle = Color(0xFFE9F4EF);

  /// Legacy green tint (pills / DEFAULT badge).
  static const brandGreenLight = Color(0xFFD1E7DD);

  /// Rewards & money (Figma "Golden Grass") — CTAs, prices, stars, reward icons.
  static const brandAmber = Color(0xFFDAA227);

  /// Darker gold (Figma "Mandalay") — active bottom-nav icon/label, price emphasis.
  static const brandGoldStrong = Color(0xFFB8881F);

  /// Tinted amber fills (spin strip, wallet toggle, spin coupon cards).
  static const brandAmberLight = Color(0xFFFBEBB3);

  /// Soft gold tint (Figma "Citrine White") — wallet reward/cashback icon tiles.
  static const brandGoldSubtle = Color(0xFFFBF4DD);

  /// Gold border (Figma "Putty") — coupon ticket outline, reward code pill.
  static const brandGoldBorder = Color(0xFFE8D28A);

  /// Semantic success green (Figma "#16A34A") — wallet credit amounts, positive
  /// ledger deltas. Brighter than [brandGreen]; used for money-in emphasis.
  static const success = Color(0xFF16A34A);

  /// Immersive backgrounds — Spin & Win, affiliate heroes.
  static const brandBrownDark = Color(0xFF2A1F10);

  /// WhatsApp contact tile (Figma "Eucalyptus").
  static const supportWhatsapp = Color(0xFF25A35A);

  // ── Feedback ──────────────────────────────────────────────────────
  static const destructiveRed = Color(0xFFF44559);
  static const destructiveRedLight = Color(0xFFFDE7EA);

  /// Figma "Coral Red" — coupon "Expires in N days" status text.
  static const statusErrorRed = Color(0xFFFB3748);

  // ── Muted / disabled surfaces (Figma) ─────────────────────────────
  /// Expired coupon headline grey.
  static const neutralMuted = Color(0xFFB7B7B7);
  /// Figma "Alabaster" — expired coupon icon panel fill.
  static const surfaceChip = Color(0xFFF8F8F8);
  /// Figma "Pampas" — expired coupon ticket outline.
  static const borderMuted = Color(0xFFF0EEE6);

  static const sky100 = Color(0xFFD8E4EA); // info tints
  static const sky700 = Color(0xFF3D6A87); // info text/icons

  // ── Category schemes (product-facing surfaces) ────────────────────
  static const categoryPerfumesTint = Color(0xFFEFDFC5);
  static const categoryBooksTint = Color(0xFFDDE9DE);
  static const categoryClothingTint = Color(0xFFE6D8C4);
  static const categoryIslamicTint = sky100;
  static const categoryClothingAccent = Color(0xFF8B6F47);

  // ── Text & surfaces ───────────────────────────────────────────────
  static const textPrimary = Color(0xFF0A0A0A);
  /// Figma "Gray" — labels, sub-lines, body copy.
  static const textSecondary = Color(0xFF7F7F7F);
  /// Figma "Santas Gray" — finer disclaimers, "(optional)" hints.
  static const textTertiary = Color(0xFF9EA2AD);
  static const bgPrimary = Color(0xFFFFFFFF);
  /// Figma "Desert Storm" — auth/screen background.
  static const surfaceBackground = Color(0xFFFCFCFB);
  static const bgMuted = Color(0xFFF5F5F4);
  /// Figma "Gallery" — default field/card borders.
  static const borderSubtle = Color(0xFFECECEC);

  /// Splash boot gradient end (warm off-white).
  static const bootBackground = Color(0xFFF6F1E8);

  // ── Onboarding illustration tints ─────────────────────────────────
  static const onboardingBeige = Color(0xFFEEE8DE);
  static const onboardingMint = Color(0xFFDDECE1);
}

/// The four admin-managed categories, with their product-facing colour scheme.
enum CategoryKey { perfumes, books, clothing, islamic }

/// Colour scheme per category — used on product cards, tiles, PDP hero tint.
typedef CategoryScheme = ({Color bgTint, Color iconColor, Color tagText});

const Map<CategoryKey, CategoryScheme> categoryColorScheme = {
  CategoryKey.perfumes: (
    bgTint: AppColors.categoryPerfumesTint,
    iconColor: AppColors.brandAmber,
    tagText: AppColors.brandAmber,
  ),
  CategoryKey.books: (
    bgTint: AppColors.categoryBooksTint,
    iconColor: AppColors.brandGreen,
    tagText: AppColors.brandGreen,
  ),
  CategoryKey.clothing: (
    bgTint: AppColors.categoryClothingTint,
    iconColor: AppColors.categoryClothingAccent,
    tagText: AppColors.categoryClothingAccent,
  ),
  CategoryKey.islamic: (
    bgTint: AppColors.categoryIslamicTint,
    iconColor: AppColors.sky700,
    tagText: AppColors.sky700,
  ),
};

/// Resolve a category slug (from Firestore) to its scheme, defaulting to perfumes.
CategoryScheme schemeForCategory(String? slug) {
  final key = switch (slug?.toLowerCase()) {
    'perfumes' => CategoryKey.perfumes,
    'books' => CategoryKey.books,
    'clothing' => CategoryKey.clothing,
    'islamic' => CategoryKey.islamic,
    _ => CategoryKey.perfumes,
  };
  return categoryColorScheme[key]!;
}
