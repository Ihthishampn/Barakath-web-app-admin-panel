import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/router/app_router.dart';
import '../../core/services/auth_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_shimmer.dart';
import 'data/content_page.dart';
import 'data/content_repository.dart';

/// Screen — Settings (Figma node 46:8306). Read-only personal information plus a
/// LEGAL list built dynamically from the Admin Panel's `content` pages. New
/// pages the admin publishes appear here automatically, in real time.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  static final _content = ContentRepository();

  @override
  Widget build(BuildContext context) {
    final uid = context.select<AuthProvider, String?>((a) => a.uid);
    return Scaffold(
      backgroundColor: AppColors.surfaceBackground,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _header(context),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                    AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x24),
                children: [
                  _sectionLabel('PERSONAL INFORMATION'),
                  const SizedBox(height: AppSpacing.x12),
                  _personalInfo(uid),
                  const SizedBox(height: AppSpacing.x20),
                  _sectionLabel('LEGAL'),
                  const SizedBox(height: AppSpacing.x12),
                  _legal(context),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _header(BuildContext context) {
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
          Text('Settings',
              style: AppType.headingLarge.copyWith(
                  fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
        ],
      ),
    );
  }

  Widget _sectionLabel(String text) => Text(text,
      style: AppType.labelUppercase.copyWith(
          fontSize: 12,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.6,
          color: AppColors.textTertiary));

  Widget _personalInfo(String? uid) {
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: uid == null
          ? null
          : FirebaseFirestore.instance.doc('customers/$uid').snapshots(),
      builder: (context, snap) {
        final d = snap.data?.data() ?? const <String, dynamic>{};
        final name = (d['name'] as String?)?.trim() ?? '';
        final phone = (d['phone'] as String?)?.trim() ?? '';
        return Column(
          children: [
            _readOnlyField('Full name', name.isEmpty ? '—' : name),
            const SizedBox(height: AppSpacing.x12),
            _readOnlyField('Mobile', phone.isEmpty ? '—' : phone),
          ],
        );
      },
    );
  }

  Widget _readOnlyField(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: AppType.bodySmall.copyWith(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary)),
        const SizedBox(height: 6),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 17, vertical: 14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppRadii.control),
            border: Border.all(color: AppColors.borderSubtle),
          ),
          child: Text(value,
              style: AppType.bodyMedium
                  .copyWith(fontSize: 14, color: AppColors.textPrimary)),
        ),
      ],
    );
  }

  Widget _legal(BuildContext context) {
    return StreamBuilder<List<ContentPage>>(
      stream: _content.watchPages(),
      builder: (context, snap) {
        if (snap.hasError) {
          return _card([
            _messageRow("Couldn't load. Pull to retry.", AppColors.textSecondary),
          ]);
        }
        if (!snap.hasData) {
          return _card([
            for (var i = 0; i < 2; i++) ...[
              if (i > 0) const Divider(height: 1, color: AppColors.borderSubtle),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16, vertical: 15),
                child: AppShimmer(height: 18, radius: AppRadii.micro),
              ),
            ],
          ]);
        }
        final pages = snap.data!;
        if (pages.isEmpty) {
          return _card([
            _messageRow('No policies published yet.', AppColors.textTertiary),
          ]);
        }
        return _card([
          for (var i = 0; i < pages.length; i++) ...[
            if (i > 0) const Divider(height: 1, color: AppColors.borderSubtle),
            _pageRow(context, pages[i]),
          ],
        ]);
      },
    );
  }

  Widget _card(List<Widget> children) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(children: children),
    );
  }

  Widget _pageRow(BuildContext context, ContentPage page) {
    return InkWell(
      onTap: () => context.push('${Routes.contentPage}/${page.id}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
        child: Row(
          children: [
            Expanded(
              child: Text(page.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.bodyMedium
                      .copyWith(fontSize: 14, color: AppColors.textPrimary)),
            ),
            const Icon(Icons.arrow_forward_rounded,
                size: 16, color: AppColors.textTertiary),
          ],
        ),
      ),
    );
  }

  Widget _messageRow(String text, Color color) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        child: Text(text,
            style: AppType.bodyMedium.copyWith(fontSize: 14, color: color)),
      );
}
