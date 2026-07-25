import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:go_router/go_router.dart';

import '../../features/notifications/notification_deep_link.dart';
import '../router/app_router.dart';
import 'auth_provider.dart';

/// Handler for a push that arrives while the app is in the background or dead.
///
/// Runs in its own isolate with no access to the app's state, so it must be a
/// top-level function annotated for AOT retention. There is deliberately
/// nothing to do here: the server sends a `notification` block alongside the
/// `data` (functions/src/notifications/push.ts), so the OS renders the alert
/// itself, and the inbox row was already written by the same Cloud Function —
/// re-doing either from here would double up. Registering the handler is still
/// required: without it a high-priority data message has no entry point and
/// FCM logs a warning on every delivery.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // The isolate starts cold — Firebase must be initialised before any plugin
  // touches it, even though we only read the message.
  await Firebase.initializeApp();
}

/// Delivers FCM messages to the customer, on all four paths.
///
/// [PushTokenService] registers the device so a push can be ADDRESSED to it;
/// this is what happens when one arrives. Before it existed the app had no
/// message handling at all — a push in the foreground was swallowed silently,
/// and tapping one from the tray just reopened the app wherever it had been
/// left, ignoring the destination the admin had configured.
///
/// * foreground  — [FirebaseMessaging.onMessage]: Android does NOT raise a tray
///   notification while the app is showing, so one is posted locally.
/// * background  — [FirebaseMessaging.onMessageOpenedApp]: the OS drew the
///   notification; this fires when it is tapped.
/// * terminated  — [FirebaseMessaging.getInitialMessage]: the tap that STARTED
///   the process.
/// * background isolate — [firebaseMessagingBackgroundHandler], registered in
///   `main()` before the app runs.
///
/// iOS is deliberately not configured (out of scope): the APNs entitlement and
/// certificates don't exist yet, so nothing here can work there. Everything
/// below is a no-op or harmless on iOS rather than an error.
class PushMessageService {
  PushMessageService._();

  static final PushMessageService instance = PushMessageService._();

  /// Must match `default_notification_channel_id` in AndroidManifest.xml — the
  /// channel the OS uses for the server-rendered (background/terminated)
  /// notifications. Using the same one here means the foreground alert looks
  /// identical and obeys the same per-channel settings the customer chose.
  static const _channel = AndroidNotificationChannel(
    'barakath_default',
    'Order updates & offers',
    description:
        'Order status, rewards, wallet activity and offers from Barakath.',
    importance: Importance.high,
  );

  final FlutterLocalNotificationsPlugin _local =
      FlutterLocalNotificationsPlugin();

  bool _started = false;
  GoRouter? _router;
  AuthProvider? _auth;
  final _subs = <StreamSubscription<RemoteMessage>>[];

  /// A destination that arrived before the app could navigate to it. Only ever
  /// one: a second tapped notification supersedes the first.
  Map<String, dynamic>? _pending;
  Timer? _pendingTimer;
  Duration _pendingWaited = Duration.zero;

  /// How long a buffered destination is held before being dropped. A cold start
  /// spends ≥1.2s on Splash and then waits on Firebase restoring the session;
  /// past this the customer has moved on and an unexpected jump would be worse
  /// than doing nothing.
  static const _pendingTimeout = Duration(seconds: 30);
  static const _pendingPoll = Duration(milliseconds: 150);

  /// Routes that are NOT a destination — the auth flow replaces the whole stack
  /// when it finishes (`context.go` from Splash), so anything pushed on top of
  /// them is wiped out a second later.
  static const _authFlow = [
    Routes.splash,
    Routes.onboarding,
    Routes.signin,
    Routes.otp,
    Routes.createProfile,
  ];

  /// Call once from the app widget, with the router it builds.
  Future<void> start({
    required GoRouter router,
    required AuthProvider auth,
  }) async {
    if (_started) return;
    _started = true;
    _router = router;
    _auth = auth;

    await _initLocalNotifications();

    // 1. Foreground — surfaced by us, because Android suppresses the tray
    //    notification while the app is on screen.
    _subs.add(FirebaseMessaging.onMessage.listen(
      _showForeground,
      onError: (_) {/* a dropped message is not worth a crash */},
    ));

    // 2. Tapped while the app was backgrounded.
    _subs.add(FirebaseMessaging.onMessageOpenedApp.listen(
      (m) => _route(m.data),
      onError: (_) {},
    ));

    // 3. Tapped while the app was terminated — this is the launch reason.
    try {
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) _route(initial.data);
    } catch (_) {
      // No message, or messaging unavailable on this platform.
    }
  }

  Future<void> _initLocalNotifications() async {
    try {
      await _local.initialize(
        settings: const InitializationSettings(
          // The launcher icon: the app ships no dedicated white-on-transparent
          // notification asset, and a missing drawable makes every local
          // notification fail to post.
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        ),
        onDidReceiveNotificationResponse: _onLocalTap,
      );
      // Android 8+ refuses to post to a channel that does not exist. Creating
      // it here (rather than only in native code) also means the channel is in
      // place for the server-rendered notifications, which name it via the
      // manifest meta-data.
      await _local
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(_channel);
    } catch (e) {
      // Never let notification plumbing stop the app from starting.
      debugPrint('Local notifications unavailable: $e');
    }
  }

  /// Post a tray notification for a message that arrived while the app is on
  /// screen, carrying the routing payload so a tap behaves like any other.
  Future<void> _showForeground(RemoteMessage message) async {
    final n = message.notification;
    final title = n?.title ?? message.data['title'] as String?;
    final body = n?.body ?? message.data['body'] as String?;
    // A data-only message with nothing to display is a no-op, not an empty
    // notification.
    if ((title == null || title.isEmpty) && (body == null || body.isEmpty)) {
      return;
    }
    try {
      await _local.show(
        // Same notification id ⇒ the tray updates in place instead of stacking
        // duplicates when a status changes twice in a row.
        id: _notificationId(message),
        title: title,
        body: body,
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(
            _channel.id,
            _channel.name,
            channelDescription: _channel.description,
            importance: Importance.high,
            priority: Priority.high,
            icon: '@mipmap/ic_launcher',
          ),
        ),
        payload: jsonEncode(message.data),
      );
    } catch (e) {
      debugPrint('Could not show notification: $e');
    }
  }

  /// Stable per-notification id. `notificationId` is the inbox document id, so
  /// two pushes about the same thing collapse onto one tray entry.
  int _notificationId(RemoteMessage message) {
    final key = (message.data['notificationId'] as String?) ??
        message.messageId ??
        DateTime.now().microsecondsSinceEpoch.toString();
    // Android notification ids are 32-bit signed.
    return key.hashCode & 0x7fffffff;
  }

  void _onLocalTap(NotificationResponse response) {
    final payload = response.payload;
    if (payload == null || payload.isEmpty) return;
    try {
      final decoded = jsonDecode(payload);
      if (decoded is Map) _route(Map<String, dynamic>.from(decoded));
    } catch (_) {
      // Malformed payload — opening the app is still the right outcome.
    }
  }

  /// Navigate to the message's destination, or buffer it until the app can.
  void _route(Map<String, dynamic> data) {
    if (data.isEmpty) return;
    if (_navigate(data)) return;
    // Not ready: the process may have been started BY this tap, in which case
    // the router is still on Splash resolving the session.
    _pending = data;
    _startPendingTimer();
  }

  bool _navigate(Map<String, dynamic> data) {
    final router = _router;
    final auth = _auth;
    if (router == null || auth == null) return false;
    // Navigator not attached yet — nothing can be pushed onto it.
    if (rootNavigatorKey.currentState == null) return false;
    // A signed-out customer has no orders, wallet or inbox to be shown; the
    // router would bounce them to sign-in and the destination would be lost.
    if (!auth.ready || !auth.isAuthenticated) return false;
    final loc = router.routerDelegate.currentConfiguration.uri.path;
    if (_authFlow.any(loc.startsWith)) return false;
    return NotificationDeepLink.openData(router, data);
  }

  void _startPendingTimer() {
    if (_pendingTimer != null) return;
    _pendingWaited = Duration.zero;
    _pendingTimer = Timer.periodic(_pendingPoll, (t) {
      _pendingWaited += _pendingPoll;
      final data = _pending;
      if (data == null || _pendingWaited >= _pendingTimeout) {
        _clearPending();
        return;
      }
      // `_navigate` returning false for an unroutable destination would spin
      // here until the timeout, which is harmless — but a successful navigation
      // (or a message with no destination at all) must stop it.
      if (_navigate(data)) _clearPending();
    });
  }

  void _clearPending() {
    _pendingTimer?.cancel();
    _pendingTimer = null;
    _pending = null;
  }

  /// Only reachable from tests / a full teardown; the singleton lives for the
  /// life of the process.
  @visibleForTesting
  Future<void> dispose() async {
    for (final s in _subs) {
      await s.cancel();
    }
    _subs.clear();
    _clearPending();
    _router = null;
    _auth = null;
    _started = false;
  }
}
