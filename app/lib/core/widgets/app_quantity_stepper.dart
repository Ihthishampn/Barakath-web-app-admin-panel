import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

/// Outlined `− qty +` stepper — grey border (Figma), green +/− glyphs.
class AppQuantityStepper extends StatelessWidget {
  const AppQuantityStepper({
    super.key,
    required this.quantity,
    this.onDecrement,
    this.onIncrement,
    this.canIncrement = true,
  });

  final int quantity;
  final VoidCallback? onDecrement;
  final VoidCallback? onIncrement;
  final bool canIncrement;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 36,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadii.pill),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _btn(Icons.remove_rounded, onDecrement, enabled: true),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.x12),
            child: Text('$quantity',
                style: AppType.bodyMedium.copyWith(
                    fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
          ),
          _btn(Icons.add_rounded, canIncrement ? onIncrement : null,
              enabled: canIncrement),
        ],
      ),
    );
  }

  Widget _btn(IconData icon, VoidCallback? onTap, {required bool enabled}) {
    return InkResponse(
      onTap: onTap,
      radius: 20,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.x10),
        child: Icon(icon,
            size: 18,
            color: enabled
                ? AppColors.brandGreen
                : AppColors.brandGreen.withValues(alpha: 0.35)),
      ),
    );
  }
}
