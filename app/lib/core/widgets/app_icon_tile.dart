import 'package:flutter/material.dart';

import '../theme/app_spacing.dart';

/// Rounded-square tinted tile with a colored icon inside — spec §1.4.
/// Sizes: small (~36), medium (~44), large (~64).
enum AppIconTileSize { small, medium, large }

class AppIconTile extends StatelessWidget {
  const AppIconTile({
    super.key,
    required this.icon,
    required this.bg,
    required this.iconColor,
    this.size = AppIconTileSize.medium,
  });

  final IconData icon;
  final Color bg;
  final Color iconColor;
  final AppIconTileSize size;

  @override
  Widget build(BuildContext context) {
    final (dim, radius, iconSize) = switch (size) {
      AppIconTileSize.small => (36.0, AppRadii.tile, 18.0),
      AppIconTileSize.medium => (44.0, AppRadii.field, 22.0),
      AppIconTileSize.large => (64.0, AppRadii.hero, 30.0),
    };
    return Container(
      width: dim,
      height: dim,
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(radius),
      ),
      child: Icon(icon, size: iconSize, color: iconColor),
    );
  }
}
