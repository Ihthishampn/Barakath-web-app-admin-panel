import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import 'data/content_page.dart';
import 'data/content_repository.dart';
import 'widgets/content_markdown.dart';

/// Screen — a single policy/content page (opened from Settings ▸ Legal). Streams
/// `content/{id}` live, so admin edits to the page's sections appear instantly.
/// Renders every section (heading + Markdown body) in order; falls back to the
/// legacy page-level body when a page has no sections.
class ContentPageScreen extends StatelessWidget {
  const ContentPageScreen({super.key, required this.pageId});

  final String pageId;

  static final _repo = ContentRepository();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surfaceBackground,
      body: SafeArea(
        bottom: false,
        child: StreamBuilder<ContentPage?>(
          stream: _repo.watchPage(pageId),
          builder: (context, snap) {
            final page = snap.data;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _header(context, page?.title ?? ''),
                Expanded(child: _body(context, snap.connectionState, page)),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _header(BuildContext context, String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x12),
      child: Row(
        children: [
          AppCircleIconButton(
            icon: Icons.arrow_back_rounded,
            iconColor: AppColors.textPrimary,
            onTap: () => context.pop(),
          ),
          const SizedBox(width: AppSpacing.x14),
          Expanded(
            child: Text(title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppType.headingLarge.copyWith(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.4)),
          ),
        ],
      ),
    );
  }

  Widget _body(BuildContext context, ConnectionState state, ContentPage? page) {
    if (page == null) {
      if (state == ConnectionState.waiting) {
        return const _Skeleton();
      }
      return const AppEmptyState(
        icon: Icons.description_outlined,
        title: 'Not available',
        subtitle: 'This page is no longer published.',
      );
    }

    final hasSections = page.sections.isNotEmpty;
    final hasBody = page.body.trim().isNotEmpty;
    if (!hasSections && !hasBody) {
      return const AppEmptyState(
        icon: Icons.description_outlined,
        title: 'Nothing here yet',
        subtitle: 'This page has no content.',
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x32),
      children: [
        if (page.updatedAt != null) ...[
          Text('Last updated ${DateFormat('d MMM yyyy').format(page.updatedAt!)}',
              style: AppType.bodySmall
                  .copyWith(fontSize: 12, color: AppColors.textTertiary)),
          const SizedBox(height: AppSpacing.x16),
        ],
        if (hasSections)
          for (final s in page.sections) ...[
            if (s.heading.trim().isNotEmpty) ...[
              Text(s.heading,
                  style: AppType.bodyLarge.copyWith(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary)),
              const SizedBox(height: AppSpacing.x8),
            ],
            ContentMarkdown(s.body),
            const SizedBox(height: AppSpacing.x20),
          ]
        else
          ContentMarkdown(page.body),
      ],
    );
  }
}

class _Skeleton extends StatelessWidget {
  const _Skeleton();
  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x12, AppSpacing.x20, AppSpacing.x20),
      children: const [
        AppShimmer(height: 20, radius: AppRadii.micro, width: 160),
        SizedBox(height: AppSpacing.x16),
        AppShimmer(height: 14, radius: AppRadii.micro),
        SizedBox(height: AppSpacing.x8),
        AppShimmer(height: 14, radius: AppRadii.micro),
        SizedBox(height: AppSpacing.x8),
        AppShimmer(height: 14, radius: AppRadii.micro, width: 220),
      ],
    );
  }
}
