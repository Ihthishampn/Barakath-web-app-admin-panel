import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/services/auth_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import 'data/app_notification.dart';
import 'data/notifications_repository.dart';
import 'notification_deep_link.dart';

/// Screen — Notifications (Figma node 46:7995). The customer's inbox
/// (`customers/{uid}/notifications`) sent from the Admin Panel, live and synced
/// with the User Web. Unread rows are highlighted; opening the screen (and
/// leaving it) marks them read, clearing the home bell's yellow dot.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  final _repo = NotificationsRepository();
  String? _uid;

  @override
  void dispose() {
    // Mirror the web: mark everything read on leave so the unread badge/dot
    // clears once the inbox has been opened. Fire-and-forget.
    final uid = _uid;
    // Nothing is left to show an error on once we're disposed, so swallow it
    // rather than leaving an unhandled Future error on the zone.
    if (uid != null) _repo.markAllRead(uid).catchError((Object _) {});
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final uid = context.select<AuthProvider, String?>((a) => a.uid);
    _uid = uid;
    return Scaffold(
      backgroundColor: AppColors.surfaceBackground,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _header(context, uid),
            Expanded(
              child: uid == null
                  ? const SizedBox.shrink()
                  : StreamBuilder<List<AppNotification>>(
                      stream: _repo.all(uid),
                      builder: (context, snap) {
                        if (snap.hasError) {
                          return const AppErrorState(
                            message: 'Could not load your notifications.\n'
                                'Please check your connection and try again.',
                          );
                        }
                        if (!snap.hasData) return const _Skeleton();
                        final items = snap.data!;
                        if (items.isEmpty) {
                          return const AppEmptyState(
                            icon: Icons.notifications_none_rounded,
                            title: "You're all caught up",
                            subtitle:
                                'Order updates, rewards and wallet activity '
                                'will show up here.',
                          );
                        }
                        return _list(context, uid, items);
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _header(BuildContext context, String? uid) {
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
          Text('Notifications',
              style: AppType.headingLarge.copyWith(
                  fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
          const Spacer(),
          if (uid != null)
            StreamBuilder<int>(
              stream: _repo.unreadCount(uid),
              builder: (context, snap) {
                final hasUnread = (snap.data ?? 0) > 0;
                return GestureDetector(
                  onTap: hasUnread
                      ? () => _repo.markAllRead(uid).catchError((Object _) {})
                      : null,
                  behavior: HitTestBehavior.opaque,
                  child: Text('Mark all read',
                      style: AppType.bodySmall.copyWith(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: hasUnread
                              ? AppColors.brandGreen
                              : AppColors.textTertiary)),
                );
              },
            ),
        ],
      ),
    );
  }

  Widget _list(BuildContext context, String uid, List<AppNotification> items) {
    final now = DateTime.now();
    bool isToday(DateTime? d) =>
        d != null && d.year == now.year && d.month == now.month && d.day == now.day;
    final today = items.where((n) => isToday(n.createdAt)).toList();
    final earlier = items.where((n) => !isToday(n.createdAt)).toList();

    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x20),
      children: [
        if (today.isNotEmpty) ...[
          _sectionLabel('TODAY'),
          for (final n in today) ...[
            _NotificationCard(n, onTap: () => _onTap(context, uid, n)),
            const SizedBox(height: AppSpacing.x8),
          ],
        ],
        if (earlier.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.x4),
          _sectionLabel('EARLIER'),
          for (final n in earlier) ...[
            _NotificationCard(n, onTap: () => _onTap(context, uid, n)),
            const SizedBox(height: AppSpacing.x8),
          ],
        ],
      ],
    );
  }

  Widget _sectionLabel(String text) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Text(text,
            style: AppType.labelUppercase.copyWith(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.55,
                color: AppColors.textTertiary)),
      );

  void _onTap(BuildContext context, String uid, AppNotification n) {
    if (!n.read) _repo.markRead(uid, n.id); // fire-and-forget
    // Shared with the FCM push handlers ([PushMessageService]) so a tap on the
    // inbox row and a tap on the system notification for the SAME message land
    // in the same place.
    NotificationDeepLink.open(GoRouter.of(context),
        type: n.deepLinkType, target: n.deepLinkTarget);
  }
}

class _NotificationCard extends StatelessWidget {
  const _NotificationCard(this.n, {required this.onTap});
  final AppNotification n;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final unread = !n.read;
    final (accent, subtle) = n.palette;
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: unread ? AppColors.brandGreenSubtle : Colors.white,
          borderRadius: BorderRadius.circular(AppRadii.field),
          border: unread ? null : Border.all(color: AppColors.borderSubtle),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: unread ? accent : subtle,
                borderRadius: BorderRadius.circular(AppRadii.chipSmall),
              ),
              child: Icon(n.icon,
                  size: 20, color: unread ? Colors.white : accent),
            ),
            const SizedBox(width: AppSpacing.x12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(n.title,
                      style: AppType.bodyMedium.copyWith(
                          fontSize: 13, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 1),
                  Text(n.body,
                      style: AppType.bodySmall.copyWith(
                          fontSize: 12,
                          height: 1.4,
                          color: AppColors.textSecondary)),
                ],
              ),
            ),
            if (unread) ...[
              const SizedBox(width: AppSpacing.x8),
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Container(
                  width: 8,
                  height: 8,
                  decoration: const BoxDecoration(
                    color: AppColors.brandGreen,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
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
      children: [
        for (var i = 0; i < 5; i++) ...[
          const AppShimmer(height: 68, radius: AppRadii.field),
          const SizedBox(height: AppSpacing.x8),
        ],
      ],
    );
  }
}
