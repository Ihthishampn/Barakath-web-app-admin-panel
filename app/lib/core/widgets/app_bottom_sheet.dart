import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

/// Rounded-top bottom sheet with grabber + optional sticky CTA — spec §1.8.
abstract final class AppBottomSheet {
  static Future<T?> show<T>(
    BuildContext context, {
    required String title,
    required Widget body,
    Widget? stickyBottom,
    bool isDismissible = true,
    bool showGrabber = true,
    EdgeInsets? bodyPadding,
  }) {
    return showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      isDismissible: isDismissible,
      enableDrag: isDismissible,
      backgroundColor: Colors.white,
      barrierColor: Colors.black.withValues(alpha: 0.5),
      shape: const RoundedRectangleBorder(
        borderRadius:
            BorderRadius.vertical(top: Radius.circular(AppRadii.sheet)),
      ),
      builder: (ctx) {
        final maxH = MediaQuery.of(ctx).size.height * 0.85;
        return SafeArea(
          top: false,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: maxH),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (showGrabber)
                  Container(
                    margin: const EdgeInsets.only(top: AppSpacing.x12),
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.borderSubtle,
                      borderRadius: BorderRadius.circular(AppRadii.pill),
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                      AppSpacing.x16, AppSpacing.x20, AppSpacing.x8),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(title,
                        style: AppType.headingMedium
                            .copyWith(color: AppColors.textPrimary)),
                  ),
                ),
                Flexible(
                  child: SingleChildScrollView(
                    padding: bodyPadding ??
                        const EdgeInsets.fromLTRB(AppSpacing.x20, 0,
                            AppSpacing.x20, AppSpacing.x16),
                    child: body,
                  ),
                ),
                if (stickyBottom != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                        AppSpacing.x8, AppSpacing.x20, AppSpacing.x16),
                    child: stickyBottom,
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}
