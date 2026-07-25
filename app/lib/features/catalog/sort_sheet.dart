import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_bottom_sheet.dart';
import 'data/product_filters.dart';

/// Shows the shared "Sort by" bottom sheet and returns the chosen [SortOption]
/// (or null if dismissed). Extracted so the Category Products screen and the
/// Home screen open the SAME sheet with identical options + behaviour.
Future<SortOption?> showSortSheet(
  BuildContext context, {
  required SortOption current,
}) {
  return AppBottomSheet.show<SortOption>(
    context,
    title: 'Sort by',
    body: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final opt in SortOption.values)
          SortRow(
            label: opt.label,
            selected: opt == current,
            onTap: () => Navigator.of(context).pop(opt),
          ),
      ],
    ),
  );
}

/// One row in the sort sheet.
class SortRow extends StatelessWidget {
  const SortRow({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 13),
        child: Row(
          children: [
            Expanded(
              child: Text(label,
                  style: AppType.bodyLarge.copyWith(
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                      color: selected
                          ? AppColors.brandGreen
                          : AppColors.textPrimary)),
            ),
            if (selected)
              const Icon(Icons.check_rounded,
                  size: 20, color: AppColors.brandGreen),
          ],
        ),
      ),
    );
  }
}
