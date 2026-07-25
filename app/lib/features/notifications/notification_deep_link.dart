import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/router/app_router.dart';

/// Where a notification points, and how to get there.
///
/// The inbox ([NotificationsScreen]) and an FCM push carry the SAME
/// destination — the notification Cloud Functions write it to
/// `customers/{uid}/notifications/{id}.deepLink` AND send it in the push's
/// `data` payload (functions/src/notifications/push.ts) — so a tap on the inbox
/// row and a tap on the system notification for the same message must land in
/// the same place. This is the single implementation of that mapping; nothing
/// else may grow a second one.
abstract final class NotificationDeepLink {
  /// Shell-branch destinations. `push`ing one of these would stack a second
  /// copy of a tab on top of the shell instead of selecting it.
  static const _tabs = {Routes.home, Routes.wallet};

  /// Every in-app path the server's `routesFor` can produce
  /// (functions/src/notifications/push.ts). `appPath` arrives from the network,
  /// so it is matched against this list rather than pushed blindly — an
  /// unrecognised path would land the customer on go_router's error screen.
  static bool _isKnownPath(String p) =>
      p == Routes.home ||
      p == Routes.wallet ||
      p == Routes.affiliateDashboard ||
      p == Routes.myCoupons ||
      p == Routes.notifications ||
      p.startsWith('${Routes.product}/') ||
      p.startsWith('${Routes.category}/') ||
      p.startsWith('${Routes.order}/');

  /// Route from an FCM `data` payload.
  ///
  /// `appPath` is the server's ready-made per-surface destination and is
  /// preferred — it means a tapped push needs no mapping table on the client,
  /// and the two surfaces genuinely differ (`/order/{id}` in the app vs
  /// `/account/orders/{id}` on the web). `deepLinkType`/`deepLinkTarget` are
  /// the fallback for anything sent before `appPath` existed.
  static bool openData(GoRouter router, Map<String, dynamic> data) {
    final path = (data['appPath'] as String?)?.trim() ?? '';
    if (path.isNotEmpty && openPath(router, path)) return true;
    return open(router,
        type: data['deepLinkType'] as String?,
        target: data['deepLinkTarget'] as String?);
  }

  /// Route a ready-made path (or an absolute http(s) URL, which is what the
  /// server emits for a "Custom URL" broadcast). Returns false — without
  /// navigating — for anything it does not recognise.
  static bool openPath(GoRouter router, String path) {
    final p = path.trim();
    if (p.isEmpty) return false;
    if (p.startsWith('http://') || p.startsWith('https://')) {
      return _launchExternal(p);
    }
    if (!_isKnownPath(p)) return false;
    if (_tabs.contains(p)) {
      router.go(p);
    } else {
      router.push(p);
    }
    return true;
  }

  /// Route a `{type, target}` pair — the shape stored on the inbox document.
  ///
  /// The cases mirror the server's `routesFor` exactly. Deliberately tolerant:
  /// an unknown type, an absent target or a malformed URL is a no-op rather
  /// than an error — the notification has simply been opened, which is still
  /// the right outcome for a message with no destination. Returns true when
  /// navigation actually happened.
  static bool open(GoRouter router, {String? type, String? target}) {
    final t = target?.trim();
    final hasTarget = t != null && t.isNotEmpty;
    switch (type) {
      case 'product':
        return hasTarget && openPath(router, '${Routes.product}/$t');
      case 'category':
        return hasTarget && openPath(router, '${Routes.category}/$t');
      // Order-status pushes — placed, packed, shipped, out for delivery,
      // delivered, cancelled — all point at one order.
      case 'order':
        return hasTarget && openPath(router, '${Routes.order}/$t');
      // Refund credited, admin credit/debit, top-up credited.
      case 'wallet':
        return openPath(router, Routes.wallet);
      // Commission earned / cleared, withdrawal paid / rejected.
      case 'affiliate':
        return openPath(router, Routes.affiliateDashboard);
      case 'coupons':
        return openPath(router, Routes.myCoupons);
      case 'notifications':
        return openPath(router, Routes.notifications);
      case 'home':
        return openPath(router, Routes.home);
      case 'url':
        // The admin's "Custom URL" broadcasts have no in-app destination — open
        // them in the browser instead of leaving the card inert.
        return hasTarget && _launchExternal(t);
      default:
        return false; // 'none' / unknown — no destination
    }
  }

  /// Only http(s), so a malformed or hostile scheme can't be launched.
  static bool _launchExternal(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null || (uri.scheme != 'http' && uri.scheme != 'https')) {
      return false;
    }
    launchUrl(uri, mode: LaunchMode.externalApplication);
    return true;
  }
}
