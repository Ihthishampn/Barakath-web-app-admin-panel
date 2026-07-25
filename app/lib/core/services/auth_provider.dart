import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import 'push_token_service.dart';

/// App-wide auth state — spec §0.1 / §3.1. Wraps [FirebaseAuth] so the router
/// can guard routes and the shell can react to sign-in / sign-out.
///
/// The OTP screens (Part 1) drive the actual sign-in via the mock service that
/// mirrors the web (deterministic email/password → shared uid). This provider
/// only exposes the resulting session + custom claims.
class AuthProvider extends ChangeNotifier {
  AuthProvider() {
    _sub = FirebaseAuth.instance.authStateChanges().listen(_onAuthChanged);
  }

  User? _user = FirebaseAuth.instance.currentUser;
  bool _isAffiliate = false;
  bool _ready = false;
  StreamSubscription<User?>? _sub;

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  User? get user => _user;
  String? get uid => _user?.uid;
  bool get isAuthenticated => _user != null;

  /// Custom-claim `role == 'affiliate'` — gates the affiliate screens (§0.2).
  /// Confirmed against `customers/{uid}.affiliate.enabled` by the affiliate
  /// features themselves; this is the fast client-side gate.
  bool get isAffiliate => _isAffiliate;

  /// True once the first auth state + claims resolve (splash waits on this).
  bool get ready => _ready;

  Future<void> _onAuthChanged(User? user) async {
    _user = user;
    _isAffiliate = false;
    if (user != null) {
      try {
        final token = await user.getIdTokenResult();
        _isAffiliate = token.claims?['role'] == 'affiliate';
      } catch (_) {
        // Claims unavailable (offline) — default to non-affiliate.
      }
      // Push registration: `fcmTokens` is what the broadcast fan-out multicasts
      // to, and nothing wrote it, so no admin broadcast ever reached a device.
      // Fire-and-forget — sign-in must never wait on (or fail because of) it.
      PushTokenService.instance.registerFor(user.uid);
    }
    _ready = true;
    notifyListeners();
  }

  /// Force-refresh custom claims after an affiliate is allocated server-side.
  Future<void> refreshClaims() async {
    final user = _user;
    if (user == null) return;
    final token = await user.getIdTokenResult(true);
    _isAffiliate = token.claims?['role'] == 'affiliate';
    notifyListeners();
  }

  Future<void> signOut() async {
    // The token row may only be deleted by its owner, and only while that
    // session still exists — so it has to go BEFORE the sign-out, or a shared
    // phone keeps receiving the previous customer's broadcasts. Best-effort and
    // time-boxed inside the service; signing out never depends on it.
    await PushTokenService.instance.unregister();
    await FirebaseAuth.instance.signOut();
  }
}
