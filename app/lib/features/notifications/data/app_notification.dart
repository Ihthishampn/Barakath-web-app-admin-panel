import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';

/// One row in a customer's inbox: `customers/{uid}/notifications/{id}`.
///
/// Written **server-side only** — by the admin panel's broadcast
/// (`adminSendBroadcastNotification` Cloud Function → per-user fan-out) and by
/// backend triggers. Security rules forbid client create/delete; a customer may
/// only flip `read`/`readAt` on their own rows (that clears the bell dot).
///
/// Byte-for-byte with what the broadcast CF actually writes: `type:'broadcast'`,
/// `deepLink` is an OBJECT `{type,target}` (not a string). We also tolerate the
/// richer `category`/`iconType`/`iconColor` fields the shared type declares, so
/// categorised notifications render the right icon when they exist.
class AppNotification {
  const AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.category,
    this.iconType,
    this.iconColorKey,
    this.deepLinkType,
    this.deepLinkTarget,
    required this.read,
    this.createdAt,
  });

  final String id;
  final String title;
  final String body;

  /// Semantic category — `order_status | spin_reward | wallet | affiliate |
  /// promo | system | support`, or `broadcast` (what admin sends today).
  final String category;
  final String? iconType; // explicit icon override: truck | gift | check | wallet
  final String? iconColorKey; // green | amber | blue | red | gray

  /// Parsed deep link. `type` ∈ home | product | category | url.
  final String? deepLinkType;
  final String? deepLinkTarget;

  final bool read;
  final DateTime? createdAt;

  factory AppNotification.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};

    // deepLink is written as an object {type,target} by the broadcast CF; also
    // tolerate a bare string (legacy/seed data).
    String? dlType;
    String? dlTarget;
    final dl = d['deepLink'];
    if (dl is Map) {
      dlType = dl['type'] as String?;
      dlTarget = dl['target'] as String?;
    } else if (dl is String && dl.isNotEmpty) {
      dlType = 'url';
      dlTarget = dl;
    }

    return AppNotification(
      id: doc.id,
      title: (d['title'] as String?) ?? '',
      body: (d['body'] as String?) ?? '',
      category: (d['category'] as String?) ?? (d['type'] as String?) ?? 'system',
      iconType: d['iconType'] as String?,
      iconColorKey: d['iconColor'] as String?,
      deepLinkType: dlType,
      deepLinkTarget: dlTarget,
      read: (d['read'] as bool?) ?? false,
      createdAt: (d['createdAt'] as Timestamp?)?.toDate(),
    );
  }

  /// Leading icon — mirrors web's `iconType` override → `category` map → bell.
  IconData get icon {
    switch (iconType) {
      case 'truck':
        return Icons.local_shipping_outlined;
      case 'gift':
        return Icons.card_giftcard_rounded;
      case 'check':
        return Icons.check_rounded;
      case 'wallet':
        return Icons.account_balance_wallet_outlined;
    }
    switch (category) {
      case 'order_status':
        return Icons.local_shipping_outlined;
      case 'spin_reward':
        return Icons.card_giftcard_rounded;
      case 'wallet':
        return Icons.account_balance_wallet_outlined;
      case 'affiliate':
        return Icons.groups_2_rounded;
      case 'promo':
        return Icons.local_offer_outlined;
      case 'support':
        return Icons.support_agent_rounded;
      default: // system | broadcast | unknown
        return Icons.notifications_none_rounded;
    }
  }

  /// (accent, subtle) colours for the icon tile. Unread rows fill the tile with
  /// [accent] (white icon); read rows use [subtle] (accent-coloured icon).
  (Color accent, Color subtle) get palette {
    switch (iconColorKey) {
      case 'amber':
        return (AppColors.brandGoldStrong, AppColors.brandGoldSubtle);
      case 'blue':
        return (AppColors.sky700, AppColors.sky100);
      case 'red':
        return (AppColors.destructiveRed, AppColors.destructiveRedLight);
      case 'gray':
        return (AppColors.textSecondary, AppColors.bgMuted);
      case 'green':
        return (AppColors.brandGreen, AppColors.brandGreenSubtle);
    }
    switch (category) {
      case 'spin_reward':
      case 'affiliate':
      case 'promo':
        return (AppColors.brandGoldStrong, AppColors.brandGoldSubtle);
      case 'wallet':
        return (AppColors.success, AppColors.success.withValues(alpha: 0.1));
      case 'support':
        return (AppColors.sky700, AppColors.sky100);
      default: // order_status | system | broadcast
        return (AppColors.brandGreen, AppColors.brandGreenSubtle);
    }
  }
}
