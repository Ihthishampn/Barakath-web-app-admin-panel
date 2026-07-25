import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/router/app_router.dart';
import '../../core/services/auth_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_dialog.dart';
import '../../core/widgets/app_medallion.dart';
import '../notifications/data/notifications_repository.dart';

/// Screen — Profile (tab 5, Figma node 46:8136). Header (avatar + name + email +
/// edit), an optional affiliate dashboard card, two grouped menu lists, and a
/// Log out action. Reads the live `customers/{uid}` doc for the identity block.
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final uid = context.select<AuthProvider, String?>((a) => a.uid);
    return SafeArea(
      bottom: false,
      child: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        stream: uid == null
            ? null
            : FirebaseFirestore.instance.doc('customers/$uid').snapshots(),
        builder: (context, snap) {
          final d = snap.data?.data() ?? const <String, dynamic>{};
          final name = (d['name'] as String?)?.trim() ?? '';
          final email = (d['email'] as String?)?.trim() ?? '';
          final avatarUrl = (d['avatarUrl'] as String?) ?? '';
          final affiliate = d['affiliate'] as Map<String, dynamic>?;
          final isAffiliate = (affiliate?['enabled'] as bool?) ?? false;

          return ListView(
            padding: const EdgeInsets.fromLTRB(AppSpacing.x20, AppSpacing.x12,
                AppSpacing.x20, AppSpacing.x20),
            children: [
              _Header(name: name, email: email, avatarUrl: avatarUrl),
              const SizedBox(height: AppSpacing.x16),
              if (isAffiliate) ...[
                _AffiliateCard(affiliate: affiliate!),
                const SizedBox(height: AppSpacing.x16),
              ],
              _MenuCard(items: [
                _MenuItem(
                  icon: Icons.shopping_bag_outlined,
                  iconColor: AppColors.brandGreen,
                  label: 'My orders',
                  onTap: () => context.push(Routes.orders),
                ),
                _MenuItem(
                  icon: Icons.favorite_border_rounded,
                  iconColor: AppColors.brandGreen,
                  label: 'Wishlist',
                  onTap: () => context.push(Routes.wishlist),
                ),
                _MenuItem(
                  icon: Icons.location_on_outlined,
                  iconColor: AppColors.brandGreen,
                  label: 'Saved addresses',
                  onTap: () => context.push(Routes.savedAddresses),
                ),
                _MenuItem(
                  icon: Icons.card_giftcard_rounded,
                  iconColor: AppColors.brandGreen,
                  label: 'Spin & Win',
                  onTap: () => context.push(Routes.spin),
                ),
                _MenuItem(
                  icon: Icons.confirmation_number_outlined,
                  iconColor: AppColors.brandGreen,
                  label: 'My coupons',
                  onTap: () => context.push(Routes.myCoupons),
                ),
              ]),
              const SizedBox(height: AppSpacing.x16),
              _MenuCard(items: [
                _MenuItem(
                  icon: Icons.notifications_none_rounded,
                  iconColor: AppColors.textPrimary,
                  label: 'Notifications',
                  onTap: () => context.push(Routes.notifications),
                  trailing: uid == null ? null : _NotifBadge(uid: uid),
                ),
                _MenuItem(
                  icon: Icons.mail_outline_rounded,
                  iconColor: AppColors.textPrimary,
                  label: 'Help & support',
                  onTap: () => context.push(Routes.helpCentre),
                ),
                _MenuItem(
                  icon: Icons.settings_outlined,
                  iconColor: AppColors.textPrimary,
                  label: 'Settings',
                  onTap: () => context.push(Routes.settings),
                ),
              ]),
              const SizedBox(height: AppSpacing.x8),
              _LogOutButton(),
            ],
          );
        },
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header(
      {required this.name, required this.email, required this.avatarUrl});
  final String name;
  final String email;
  final String avatarUrl;

  @override
  Widget build(BuildContext context) {
    final initial = name.isNotEmpty ? name[0].toUpperCase() : '?';
    return Row(
      children: [
        Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [AppColors.brandGreen, AppColors.brandGreenDark],
            ),
            borderRadius: BorderRadius.circular(32),
            image: avatarUrl.isNotEmpty
                ? DecorationImage(
                    image: NetworkImage(avatarUrl), fit: BoxFit.cover)
                : null,
          ),
          alignment: Alignment.center,
          child: avatarUrl.isNotEmpty
              ? null
              : Text(initial,
                  style: AppType.displayLarge.copyWith(
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                      color: Colors.white)),
        ),
        const SizedBox(width: AppSpacing.x14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(name.isEmpty ? 'Your account' : name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.headingLarge.copyWith(
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.4,
                      color: AppColors.textPrimary)),
              if (email.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(email,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppType.bodySmall.copyWith(
                        fontSize: 13, color: AppColors.textSecondary)),
              ],
            ],
          ),
        ),
        const SizedBox(width: AppSpacing.x8),
        GestureDetector(
          onTap: () => context.push(Routes.editProfile),
          behavior: HitTestBehavior.opaque,
          child: const Icon(Icons.edit_outlined,
              size: 20, color: AppColors.brandGreen),
        ),
      ],
    );
  }
}

class _AffiliateCard extends StatelessWidget {
  const _AffiliateCard({required this.affiliate});
  final Map<String, dynamic> affiliate;

  @override
  Widget build(BuildContext context) {
    final withdrawablePaise =
        (affiliate['confirmedBalancePaise'] as num?)?.toInt() ??
            (affiliate['availableBalancePaise'] as num?)?.toInt() ??
            0;
    final referrals = (affiliate['referredCount'] as num?)?.toInt() ??
        (affiliate['totalReferrals'] as num?)?.toInt() ??
        0;
    return GestureDetector(
      onTap: () => context.push(Routes.affiliateDashboard),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.x16),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppRadii.field),
          gradient: const LinearGradient(
            begin: Alignment.centerLeft,
            end: Alignment.centerRight,
            colors: [Color(0xFF2A2118), Color(0xFF4A3A22)],
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: AppColors.brandAmber,
                borderRadius: BorderRadius.circular(AppRadii.control),
              ),
              child: const Icon(Icons.groups_2_rounded,
                  size: 22, color: Colors.white),
            ),
            const SizedBox(width: AppSpacing.x12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Affiliate dashboard',
                      style: AppType.bodyMedium.copyWith(
                          fontWeight: FontWeight.w800, color: Colors.white)),
                  const SizedBox(height: 2),
                  Text(
                      '${Money.fromPaise(withdrawablePaise)} withdrawable · $referrals referrals',
                      style: AppType.bodySmall.copyWith(
                          fontSize: 12, color: AppColors.brandAmber)),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.x8),
            const Icon(Icons.arrow_forward_rounded,
                size: 18, color: AppColors.brandAmber),
          ],
        ),
      ),
    );
  }
}

class _MenuCard extends StatelessWidget {
  const _MenuCard({required this.items});
  final List<_MenuItem> items;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < items.length; i++) ...[
            items[i],
            if (i < items.length - 1)
              const Divider(
                  height: 1, thickness: 1, color: AppColors.borderSubtle),
          ],
        ],
      ),
    );
  }
}

class _MenuItem extends StatelessWidget {
  const _MenuItem(
      {required this.icon,
      required this.iconColor,
      required this.label,
      required this.onTap,
      this.trailing});
  final IconData icon;
  final Color iconColor;
  final String label;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.x16, vertical: 15),
        child: Row(
          children: [
            Icon(icon, size: 20, color: iconColor),
            const SizedBox(width: AppSpacing.x12),
            Expanded(
              child: Text(label,
                  style: AppType.bodyMedium.copyWith(
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary)),
            ),
            if (trailing != null) ...[
              trailing!,
              const SizedBox(width: AppSpacing.x8),
            ],
            const Icon(Icons.chevron_right_rounded,
                size: 18, color: AppColors.textTertiary),
          ],
        ),
      ),
    );
  }
}

/// Amber unread-count pill shown on the Profile "Notifications" row.
class _NotifBadge extends StatelessWidget {
  const _NotifBadge({required this.uid});
  final String uid;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<int>(
      stream: NotificationsRepository().unreadCount(uid),
      builder: (context, snap) {
        final n = snap.data ?? 0;
        if (n == 0) return const SizedBox.shrink();
        return Container(
          constraints: const BoxConstraints(minWidth: 20),
          height: 20,
          padding: const EdgeInsets.symmetric(horizontal: 6),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.brandAmber,
            borderRadius: BorderRadius.circular(AppRadii.pill),
          ),
          child: Text(n > 9 ? '9+' : '$n',
              style: AppType.bodySmall.copyWith(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary)),
        );
      },
    );
  }
}

class _LogOutButton extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () async {
        final ok = await AppDialog.show<bool>(
          context,
          dialog: Builder(
            builder: (ctx) => AppDialog(
              medallion: AppMedallionVariant.destructiveIconed,
              title: 'Log out?',
              body: "You'll need to sign in again to place orders.",
              primaryLabel: 'Log out',
              primaryVariant: AppButtonVariant.destructive,
              onPrimary: () => Navigator.of(ctx).pop(true),
              secondaryLabel: 'Cancel',
              onSecondary: () => Navigator.of(ctx).pop(false),
            ),
          ),
        );
        if (ok != true || !context.mounted) return;
        await context.read<AuthProvider>().signOut();
        if (context.mounted) context.go(Routes.signin);
      },
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Center(
          child: Text('Log out',
              style: AppType.bodyMedium.copyWith(
                  fontWeight: FontWeight.w700,
                  color: AppColors.destructiveRed)),
        ),
      ),
    );
  }
}
