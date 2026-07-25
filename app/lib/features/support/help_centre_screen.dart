import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import '../../core/widgets/app_toast.dart';
import 'data/support_settings.dart';
import 'data/support_repository.dart';

/// Screen — Help centre (Figma node 46:8069). Contact methods (Call / WhatsApp /
/// Email) built dynamically from the admin-managed `settings/support` doc, live.
/// A card appears for each populated field, so filling in more fields in the
/// Admin Panel surfaces more cards here automatically — no app change needed.
class HelpCentreScreen extends StatelessWidget {
  const HelpCentreScreen({super.key});

  static final _repo = SupportRepository();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surfaceBackground,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _header(context),
            Expanded(
              child: StreamBuilder<SupportSettings?>(
                stream: _repo.watch(),
                builder: (context, snap) {
                  if (snap.hasError) {
                    return const AppErrorState(
                        message: "Couldn't load support details.");
                  }
                  if (snap.connectionState == ConnectionState.waiting &&
                      !snap.hasData) {
                    return const _Skeleton();
                  }
                  final s = snap.data;
                  if (s == null || !s.enabled || !s.hasAnyContact) {
                    return const AppEmptyState(
                      icon: Icons.support_agent_rounded,
                      title: 'Support is unavailable',
                      subtitle: 'Please check back a little later.',
                    );
                  }
                  return _body(context, s);
                },
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
          Text('Help centre',
              style: AppType.headingLarge.copyWith(
                  fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
        ],
      ),
    );
  }

  Widget _body(BuildContext context, SupportSettings s) {
    final cards = <Widget>[];
    if (s.hasPhone) {
      cards.add(_card(
        icon: Icons.call_rounded,
        tileColor: AppColors.brandGreen,
        title: 'Call us',
        subtitle: s.phone,
        onTap: () => _launch(context, 'tel:${s.phoneDigits}'),
      ));
      cards.add(_card(
        icon: Icons.chat_rounded,
        tileColor: AppColors.supportWhatsapp,
        title: 'WhatsApp',
        subtitle: 'Chat with support',
        onTap: () => _launch(context, 'https://wa.me/${s.phoneDigits}'),
      ));
    }
    if (s.hasEmail) {
      cards.add(_card(
        icon: Icons.mail_outline_rounded,
        tileColor: AppColors.brandGoldStrong,
        title: 'Email',
        subtitle: s.email,
        onTap: () => _launch(context, 'mailto:${s.email}'),
      ));
    }
    // Any extra string fields the admin adds later — shown generically.
    for (final e in s.extraFields.entries) {
      cards.add(_card(
        icon: Icons.info_outline_rounded,
        tileColor: AppColors.textSecondary,
        title: _humanize(e.key),
        subtitle: e.value,
        onTap: () => _copy(context, e.value),
      ));
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x24),
      children: [
        Text('Contact us',
            style: AppType.bodyMedium.copyWith(
                fontSize: 14, fontWeight: FontWeight.w800)),
        const SizedBox(height: AppSpacing.x14),
        for (var i = 0; i < cards.length; i++) ...[
          cards[i],
          if (i < cards.length - 1) const SizedBox(height: AppSpacing.x12),
        ],
        if (s.hours.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.x16),
          Text(s.hours,
              style: AppType.bodySmall.copyWith(
                  fontSize: 12, height: 1.5, color: AppColors.textSecondary)),
        ],
      ],
    );
  }

  Widget _card({
    required IconData icon,
    required Color tileColor,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.all(17),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(AppRadii.field),
          border: Border.all(color: AppColors.borderSubtle),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: tileColor,
                borderRadius: BorderRadius.circular(AppRadii.field),
              ),
              child: Icon(icon, size: 20, color: Colors.white),
            ),
            const SizedBox(width: AppSpacing.x14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: AppType.bodyLarge.copyWith(
                          fontSize: 15, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 1),
                  Text(subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppType.bodySmall.copyWith(
                          fontSize: 12, color: AppColors.textSecondary)),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.x8),
            const Icon(Icons.chevron_right_rounded,
                size: 18, color: AppColors.textTertiary),
          ],
        ),
      ),
    );
  }

  Future<void> _launch(BuildContext context, String url) async {
    try {
      final ok =
          await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      if (!ok && context.mounted) {
        AppToast.show(context, "Couldn't open that on your device.",
            variant: AppToastVariant.error);
      }
    } catch (_) {
      if (context.mounted) {
        AppToast.show(context, "Couldn't open that on your device.",
            variant: AppToastVariant.error);
      }
    }
  }

  Future<void> _copy(BuildContext context, String value) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (context.mounted) {
      AppToast.show(context, 'Copied', variant: AppToastVariant.success);
    }
  }

  /// 'supportAddress' → 'Address', 'whatsappNumber' → 'Whatsapp number'.
  static String _humanize(String key) {
    var k = key.startsWith('support') ? key.substring(7) : key;
    k = k.replaceAllMapped(RegExp(r'([a-z])([A-Z])'), (m) => '${m[1]} ${m[2]}');
    k = k.replaceAll('_', ' ').trim();
    if (k.isEmpty) return key;
    return '${k[0].toUpperCase()}${k.substring(1)}';
  }
}

class _Skeleton extends StatelessWidget {
  const _Skeleton();
  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x12, AppSpacing.x20, AppSpacing.x20),
      children: [
        for (var i = 0; i < 3; i++) ...[
          const AppShimmer(height: 78, radius: AppRadii.field),
          const SizedBox(height: AppSpacing.x12),
        ],
      ],
    );
  }
}
