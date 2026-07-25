/// Spacing scale — spec §1.3. Use these instead of raw numbers.
abstract final class AppSpacing {
  static const double x4 = 4;
  static const double x8 = 8;
  static const double x10 = 10;
  static const double x12 = 12;
  static const double x14 = 14;
  static const double x16 = 16;
  static const double x20 = 20;
  static const double x24 = 24;
  static const double x28 = 28;
  static const double x32 = 32;
  static const double x40 = 40;
  static const double x48 = 48;
  static const double x56 = 56;
  static const double x64 = 64;
  static const double x80 = 80;

  /// Standard screen horizontal padding.
  static const double screenH = x20;
}

/// Radii scale — spec §1.3, reconciled with the Figma design system.
abstract final class AppRadii {
  static const double micro = 4;
  static const double chipSmall = 8;
  static const double control = 8; // buttons + auth text fields (Figma)
  static const double tile = 10; // small icon tiles, quick-add +
  static const double field = 12; // OTP boxes, medium chips, tile fills
  static const double card = 14; // default cards
  static const double hero = 16; // hero + invoice cards
  static const double dialog = 20;
  static const double sheet = 24; // bottom sheet top corners
  static const double pill = 999;
}
