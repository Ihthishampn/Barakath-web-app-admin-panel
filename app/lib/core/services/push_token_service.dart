import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Registers this device's FCM registration token so admin broadcasts can
/// actually reach it.
///
/// `adminSendBroadcastNotification` (functions/src/notifications/broadcast.ts)
/// multicasts to `fcmTokens` documents selected with
/// `where('customerId', 'in', [...uids])`, and uses **the document id as the
/// token**. Nothing in the repo ever wrote that collection, so every broadcast
/// pushed to zero devices while the in-app inbox filled up normally — the admin
/// saw an honest `reach` and no phone ever buzzed. This service is the writer.
///
/// Customer opt-outs are NOT re-implemented here: the callable already skips
/// customers whose `preferences.notificationsEnabled` / `notifyPromotions` are
/// false, so a registered token for an opted-out customer is simply never
/// selected. Registering unconditionally also means the moment they opt back in
/// their device is already reachable.
class PushTokenService {
  PushTokenService._();

  /// Single instance — [AuthProvider] drives it and `main()` starts it; there is
  /// no UI state here, so it is deliberately not a provider.
  static final PushTokenService instance = PushTokenService._();

  /// Device-local memory of the row we last wrote, so a rotated token can clean
  /// up after itself and an unchanged one costs no write at all.
  static const _prefToken = 'fcmToken';
  static const _prefUid = 'fcmTokenUid';

  /// Seconds a token write/delete may hold up the flow that triggered it.
  /// Firestore only completes a write future on server ack, so an offline
  /// sign-out would otherwise wait forever on the delete below.
  static const _ackTimeout = Duration(seconds: 4);

  CollectionReference<Map<String, dynamic>> get _col =>
      FirebaseFirestore.instance.collection('fcmTokens');

  bool _started = false;
  StreamSubscription<String>? _refreshSub;

  /// Serialises every mutation. `authStateChanges` can emit more than once per
  /// sign-in and a token refresh can land mid-registration; two concurrent runs
  /// would race on the "previous token" bookkeeping and orphan a row.
  Future<void> _chain = Future<void>.value();

  Future<void> _queue(Future<void> Function() task) {
    final next = _chain.then((_) => task()).catchError((_) {});
    _chain = next;
    return next;
  }

  String get _platform => kIsWeb ? 'web' : defaultTargetPlatform.name;

  /// Call once from `main()` after Firebase is initialised.
  void start() {
    if (_started) return;
    _started = true;

    // FCM rotates the registration token on its own schedule (reinstall, data
    // restore, cleared storage). Without this the stored row keeps a dead token
    // and every push to it is silently dropped.
    _refreshSub = FirebaseMessaging.instance.onTokenRefresh.listen(
      (token) {
        final uid = FirebaseAuth.instance.currentUser?.uid;
        if (uid == null) return; // signed out — nothing to attribute it to
        unawaited(_queue(() => _write(uid, token)));
      },
      onError: (_) {
        // Nothing to recover: the next sign-in re-reads the token from scratch.
      },
    );

    // iOS suppresses a notification while the app is foregrounded unless it is
    // told otherwise. No-op on Android.
    unawaited(
      FirebaseMessaging.instance
          .setForegroundNotificationPresentationOptions(
            alert: true,
            badge: true,
            sound: true,
          )
          .catchError((_) {}),
    );
  }

  /// Register the signed-in customer's device.
  ///
  /// Fire-and-forget by design: sign-in must never wait on — or fail because
  /// of — a push registration, so every failure here dies silently.
  void registerFor(String uid) {
    unawaited(_queue(() => _register(uid)));
  }

  Future<void> _register(String uid) async {
    final messaging = FirebaseMessaging.instance;

    // The OS prompt is the only permission UI: iOS/macOS refuse to hand out a
    // token until the customer has been asked, and Android 13+ needs the
    // POST_NOTIFICATIONS grant (declared by the firebase_messaging manifest and
    // merged into ours). Already-answered prompts return the stored decision
    // without showing anything again.
    final settings = await messaging.requestPermission();
    if (settings.authorizationStatus == AuthorizationStatus.denied) {
      // A token would be registered but nothing could ever be displayed from it.
      return;
    }

    final token = await messaging.getToken();
    if (token == null || token.isEmpty) return;
    await _write(uid, token);
  }

  /// Upsert `fcmTokens/{token}`.
  ///
  /// The document id IS the token, so re-registering the same device overwrites
  /// its own row rather than adding a second one — idempotent by key, no matter
  /// how many times sign-in replays.
  Future<void> _write(String uid, String token, {bool retryAfterReset = true}) async {
    final prefs = await SharedPreferences.getInstance();
    final prevToken = prefs.getString(_prefToken);
    final prevUid = prefs.getString(_prefUid);
    if (prevToken == token && prevUid == uid) return; // already current

    try {
      await _col.doc(token).set({
        'id': token,
        // The one field the broadcast fan-out filters on.
        'customerId': uid,
        'platform': _platform,
        'updatedAt': FieldValue.serverTimestamp(),
      }).timeout(_ackTimeout);
    } on FirebaseException catch (e) {
      // Someone else's row still owns this token — the previous customer on a
      // shared phone signed out without their delete landing, and the rules only
      // let a row's owner overwrite it. Burn the registration token and take a
      // fresh one; the orphan then points at a token FCM no longer routes.
      if (e.code == 'permission-denied' && retryAfterReset) {
        await FirebaseMessaging.instance.deleteToken();
        final fresh = await FirebaseMessaging.instance.getToken();
        if (fresh != null && fresh.isNotEmpty && fresh != token) {
          await _write(uid, fresh, retryAfterReset: false);
        }
      }
      return;
    }

    await prefs.setString(_prefToken, token);
    await prefs.setString(_prefUid, uid);

    // A rotated token leaves the old row pointing at a device that can no longer
    // be reached, so the collection would grow one row per token ever issued.
    if (prevToken != null && prevToken != token && prevUid == uid) {
      try {
        await _col.doc(prevToken).delete().timeout(_ackTimeout);
      } catch (_) {
        // Stale row only — it costs one dead multicast entry, nothing more.
      }
    }
  }

  /// Drop this device's row.
  ///
  /// MUST run while the customer is still signed in — the rules only let a row's
  /// owner delete it — so [AuthProvider.signOut] awaits this before ending the
  /// session. Otherwise the next customer on a shared phone keeps receiving the
  /// previous one's broadcasts.
  Future<void> unregister() => _queue(() async {
        final prefs = await SharedPreferences.getInstance();
        final token = prefs.getString(_prefToken);
        // Forget it locally first: even if the delete below never lands, this
        // device must not believe it still owns a row for the old account.
        await prefs.remove(_prefToken);
        await prefs.remove(_prefUid);
        if (token == null || token.isEmpty) return;
        try {
          await _col.doc(token).delete().timeout(_ackTimeout);
        } catch (_) {
          // Offline or already gone. The row is left orphaned, not mis-owned —
          // the next customer's registration recovers it (see _write).
        }
      });

  /// Only reachable from tests / a full teardown; the singleton lives for the
  /// life of the process.
  @visibleForTesting
  Future<void> dispose() async {
    await _refreshSub?.cancel();
    _refreshSub = null;
    _started = false;
  }
}
