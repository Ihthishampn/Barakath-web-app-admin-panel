import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';

/// Renders the deliberately-minimal Markdown the admin authors for policy
/// sections — matching the web's `renderMarkdown`: `#`/`##`/`###` headings,
/// `-`/`*` bullets, and paragraphs separated by blank lines. No inline styling
/// (bold/italic/links) — content is treated as safe text.
class ContentMarkdown extends StatelessWidget {
  const ContentMarkdown(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) {
    final blocks = <Widget>[];
    final lines = text.replaceAll('\r\n', '\n').split('\n');

    for (final raw in lines) {
      final line = raw.trimRight();
      final t = line.trim();
      if (t.isEmpty) {
        blocks.add(const SizedBox(height: AppSpacing.x10));
        continue;
      }
      if (t.startsWith('### ')) {
        blocks.add(_heading(t.substring(4), 15));
      } else if (t.startsWith('## ')) {
        blocks.add(_heading(t.substring(3), 16));
      } else if (t.startsWith('# ')) {
        blocks.add(_heading(t.substring(2), 18));
      } else if (t.startsWith('- ') || t.startsWith('* ')) {
        blocks.add(_bullet(t.substring(2)));
      } else {
        blocks.add(_paragraph(t));
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: blocks,
    );
  }

  Widget _heading(String text, double size) => Padding(
        padding: const EdgeInsets.only(top: AppSpacing.x8, bottom: AppSpacing.x4),
        child: Text(text,
            style: AppType.bodyLarge.copyWith(
                fontSize: size,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary,
                height: 1.35)),
      );

  Widget _paragraph(String text) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.x4),
        child: Text(text,
            style: AppType.bodyMedium.copyWith(
                fontSize: 14, height: 1.55, color: AppColors.textSecondary)),
      );

  Widget _bullet(String text) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.x4, left: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 7, right: 10),
              child: Container(
                width: 5,
                height: 5,
                decoration: const BoxDecoration(
                    color: AppColors.textTertiary, shape: BoxShape.circle),
              ),
            ),
            Expanded(
              child: Text(text,
                  style: AppType.bodyMedium.copyWith(
                      fontSize: 14, height: 1.55, color: AppColors.textSecondary)),
            ),
          ],
        ),
      );
}
