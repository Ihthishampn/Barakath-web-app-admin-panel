import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';

/// Email format check — identical to the web (`EMAIL_RE` in authActions.ts) so
/// both clients accept/reject the same addresses.
final emailRe = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

/// ┌─ THE ONE LINE THAT SWITCHES SIGN-IN ────────────────────────────────────┐
/// │ `false` → real MSG91 SMS through the deployed sendOtp/resendOtp/        │
/// │           verifyOtp callables (asia-south1).                            │
/// │ `true`  → the old on-device mock: no SMS, no callables, the code is     │
/// │           always [AuthRepository.mockCode].                             │
/// └─────────────────────────────────────────────────────────────────────────┘
/// The mock is kept on disk because MSG91 currently rejects our server with
/// "Web requests are not allowed for this widget." until the account owner
/// enables server/API requests on the widget in the MSG91 dashboard. Until then
/// this flag is the only way to get past sign-in on a device.
const bool kUseMockOtp = false;

/// Why a referral code could not be applied, one per rejection `linkReferral`
/// makes. Sign-up is now the ONLY place a customer can ever be attributed, so
/// the screen has to tell these apart: some are fixed by typing a different
/// code, one can never be fixed at all.
enum ReferralLinkError {
  /// `not-found` — no affiliate owns that code (a typo, most likely).
  unknownCode,

  /// `failed-precondition` — the affiliate exists but is switched off.
  notActive,

  /// `failed-precondition` — it is the customer's own code.
  ownCode,

  /// `failed-precondition` — this account already has a referrer. Nothing the
  /// customer types can change that; the link is decided once and for all.
  alreadyLinked,

  /// `invalid-argument` — empty or over-long code; the server never saw a
  /// candidate to look up.
  malformed,

  /// Network, cold start, a blocked account, or anything unrecognised. Worth
  /// one more press of the button.
  unavailable,
}

/// Outcome of applying a referral code, surfaced to the UI as a toast (and,
/// when it can still be corrected, as an inline flag on the field).
class ReferralResult {
  const ReferralResult({required this.ok, this.message, this.error});
  final bool ok;
  final String? message;

  /// Null when the code applied — or when there was no code to apply.
  final ReferralLinkError? error;

  /// Can a corrected code still succeed? Everything except [alreadyLinked] is
  /// worth another try, so the screen keeps the customer on the field for
  /// those and lets the account through for that one.
  bool get isFixable =>
      error != null && error != ReferralLinkError.alreadyLinked;
}

/// A live OTP session — the server owns the code, we only hold its id and the
/// timings the UI needs (resend countdown, resends budget).
class OtpSession {
  const OtpSession({
    required this.sessionId,
    required this.expiresInSec,
    required this.resendAfterSec,
    required this.maxResends,
  });

  final String sessionId;
  final int expiresInSec;
  final int resendAfterSec;
  final int maxResends;
}

/// What is left of the resend budget after a successful `resendOtp`.
class OtpResendResult {
  const OtpResendResult({required this.resendsLeft, required this.resendAfterSec});
  final int resendsLeft;
  final int resendAfterSec;
}

/// A verified sign-in. The uid is the **server's** decision, not ours.
class OtpResult {
  const OtpResult({required this.uid, required this.isNewUser});
  final String uid;
  final bool isNewUser;
}

/// Every way an OTP call can fail, one per callable error code. The screens
/// branch on this to decide inline-red-text vs toast, and whether the session
/// can still be used.
enum OtpErrorKind {
  /// `invalid-argument` — wrong code, or a number the server won't accept.
  invalidCode,

  /// `deadline-exceeded` — the code (and with it the session) timed out.
  expired,

  /// `resource-exhausted` — too many attempts / resends / codes for this number.
  exhausted,

  /// `failed-precondition` — resend cooldown not elapsed, or code already used.
  notAllowed,

  /// `not-found` — the session is gone; sign-in must start again.
  sessionExpired,

  /// `unavailable` — network down, or MSG91 refused the send. Retryable.
  network,

  /// `permission-denied` — the account is blocked.
  blocked,

  /// Anything else (including a token we could not redeem).
  unknown,
}

/// A failed OTP call carrying a message that is safe to show as-is.
class OtpException implements Exception {
  const OtpException(this.kind, this.message);

  /// The server writes a human sentence into `e.message` for every one of these
  /// codes, so prefer it and only fall back when it is missing.
  factory OtpException.from(FirebaseFunctionsException e) {
    final kind = switch (e.code) {
      'invalid-argument' => OtpErrorKind.invalidCode,
      'deadline-exceeded' => OtpErrorKind.expired,
      'resource-exhausted' => OtpErrorKind.exhausted,
      'failed-precondition' => OtpErrorKind.notAllowed,
      'not-found' => OtpErrorKind.sessionExpired,
      'unavailable' => OtpErrorKind.network,
      'permission-denied' => OtpErrorKind.blocked,
      _ => OtpErrorKind.unknown,
    };
    final msg = e.message?.trim();
    return OtpException(kind, msg == null || msg.isEmpty ? _fallback(kind) : msg);
  }

  final OtpErrorKind kind;
  final String message;

  /// True when this session can never succeed again, so the screen must start a
  /// fresh one instead of resending against it. `notAllowed` is deliberately
  /// absent: on a resend it only means "cooldown", which passes.
  bool get isSessionDead =>
      kind == OtpErrorKind.expired ||
      kind == OtpErrorKind.exhausted ||
      kind == OtpErrorKind.sessionExpired ||
      kind == OtpErrorKind.blocked;

  static String _fallback(OtpErrorKind kind) => switch (kind) {
        OtpErrorKind.invalidCode => 'That code is incorrect.',
        OtpErrorKind.expired => 'That code has expired. Request a new one.',
        OtpErrorKind.exhausted =>
          'Too many attempts. Please try again in a little while.',
        OtpErrorKind.notAllowed => 'Please wait before requesting another code.',
        OtpErrorKind.sessionExpired =>
          'This sign-in has expired. Request a new code.',
        OtpErrorKind.network =>
          "Couldn't reach the SMS service. Please try again.",
        OtpErrorKind.blocked =>
          'Your account has been blocked. Please contact support.',
        OtpErrorKind.unknown => "Couldn't verify the code. Please try again.",
      };

  @override
  String toString() => message;
}

/// Auth flow — real MSG91 OTP over three callables in `asia-south1`
/// (`sendOtp` / `resendOtp` / `verifyOtp`, see functions/src/auth/otp.ts).
///
/// The client deliberately does **no** identity work: the widget token, the
/// abuse rules and — critically — the uid all live server-side. `verifyOtp`
/// returns a Firebase CUSTOM TOKEN for a uid the server resolved by reusing the
/// legacy `otp_<digits>@mock.barakath.app` account, so a customer's orders,
/// wallet, wishlist and affiliate records survive the switch. Our only job here
/// is [FirebaseAuth.signInWithCustomToken]; we never create users any more.
///
/// The customer doc + phone→uid directory writes below stay on the client
/// (the callables don't touch them) and are unchanged.
class AuthRepository {
  AuthRepository({
    FirebaseAuth? auth,
    FirebaseFirestore? db,
    FirebaseFunctions? functions,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _db = db ?? FirebaseFirestore.instance,
        _fn = functions ?? FirebaseFunctions.instanceFor(region: 'asia-south1');

  final FirebaseAuth _auth;
  final FirebaseFirestore _db;
  final FirebaseFunctions _fn;

  /// The only code the mock path accepts (there is no SMS and, since the dev
  /// snackbar is gone, nothing to read it from — so it has to be fixed).
  static const mockCode = '123456';

  // MUST match web/src/lib/otp/mockOtpService.ts for cross-client shared uids —
  // and it is the same address the server reuses when resolving the uid.
  static const _mockPassword = 'barakath-mock-otp-2026';
  static String _mockEmail(String e164) =>
      'otp_${_digits(e164)}@mock.barakath.app';

  static String _digits(String s) => s.replaceAll(RegExp(r'\D'), '');

  /// E.164 for India from a 10-digit local number.
  static String toE164(String local) => '+91${_digits(local)}';

  /// Is this phone already registered? (public single-doc read, pre-auth.)
  Future<bool> userExists(String e164) async {
    final snap = await _db.doc('users/${_digits(e164)}').get();
    return snap.exists;
  }

  /// Send an OTP and open a session. MSG91 wants E.164 **without** the `+`, so
  /// the stored `+91…` is reduced to digits on the way out.
  Future<OtpSession> sendOtp(String e164) async {
    if (kUseMockOtp) {
      await Future<void>.delayed(const Duration(milliseconds: 500));
      // The digits are carried in the id so the mock verify can rebuild the
      // legacy credential without changing the real path's signatures.
      return OtpSession(
        sessionId: '$_mockSessionPrefix${_digits(e164)}',
        expiresInSec: 600,
        resendAfterSec: 30,
        maxResends: 3,
      );
    }
    final data = await _call('sendOtp', {'phone': _digits(e164)});
    return OtpSession(
      sessionId: (data['sessionId'] as String?) ?? '',
      expiresInSec: (data['expiresInSec'] as num?)?.toInt() ?? 600,
      resendAfterSec: (data['resendAfterSec'] as num?)?.toInt() ?? 30,
      maxResends: (data['maxResends'] as num?)?.toInt() ?? 3,
    );
  }

  /// Re-send the code for an existing session. Only ever called from an explicit
  /// user tap — the server enforces the same cooldown and cap regardless.
  Future<OtpResendResult> resendOtp(String sessionId) async {
    if (kUseMockOtp) {
      await Future<void>.delayed(const Duration(milliseconds: 500));
      return const OtpResendResult(resendsLeft: 3, resendAfterSec: 30);
    }
    final data = await _call('resendOtp', {'sessionId': sessionId});
    return OtpResendResult(
      resendsLeft: (data['resendsLeft'] as num?)?.toInt() ?? 0,
      resendAfterSec: (data['resendAfterSec'] as num?)?.toInt() ?? 30,
    );
  }

  /// Verify the code and establish the Firebase session.
  ///
  /// Throws [OtpException] for every failure — including a wrong code, so the
  /// screen can show the server's own wording instead of guessing.
  Future<OtpResult> verifyOtp({
    required String sessionId,
    required String code,
  }) async {
    if (kUseMockOtp) return _mockVerify(sessionId, code);

    final data = await _call('verifyOtp', {'sessionId': sessionId, 'code': code});
    final token = (data['token'] as String?) ?? '';
    if (token.isEmpty) {
      throw const OtpException(
          OtpErrorKind.unknown, "Couldn't complete sign-in. Please try again.");
    }
    try {
      // The whole point of the server flow: the uid is already decided, we just
      // redeem it. No createUser / signInWithEmailAndPassword on the client.
      await _auth.signInWithCustomToken(token);
    } on FirebaseAuthException catch (e) {
      throw OtpException(OtpErrorKind.unknown,
          e.message ?? "Couldn't complete sign-in. Please try again.");
    }
    return OtpResult(
      uid: (data['uid'] as String?) ?? _auth.currentUser?.uid ?? '',
      isNewUser: (data['isNewUser'] as bool?) ?? false,
    );
  }

  /// One place where callable failures become [OtpException]s: a
  /// `FirebaseFunctionsException` carries the server's sentence, anything else
  /// (no connectivity, platform channel blow-up) is a retryable network fault.
  Future<Map<String, dynamic>> _call(
      String name, Map<String, dynamic> payload) async {
    try {
      final res = await _fn.httpsCallable(name).call<Map<String, dynamic>>(payload);
      return res.data;
    } on FirebaseFunctionsException catch (e) {
      throw OtpException.from(e);
    } catch (_) {
      throw const OtpException(OtpErrorKind.network,
          "Couldn't reach the server. Check your connection and try again.");
    }
  }

  static const _mockSessionPrefix = 'mock:';

  /// Mock verification — the pre-MSG91 behaviour, kept intact behind
  /// [kUseMockOtp]: a deterministic Email/Password credential derived from the
  /// phone, so one phone always maps to one uid (the same one the server now
  /// reuses).
  Future<OtpResult> _mockVerify(String sessionId, String code) async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    if (!sessionId.startsWith(_mockSessionPrefix)) {
      throw const OtpException(
          OtpErrorKind.sessionExpired, 'This sign-in has expired. Request a new code.');
    }
    if (code != mockCode) {
      throw const OtpException(OtpErrorKind.invalidCode, 'That code is incorrect.');
    }
    final email = _mockEmail(sessionId.substring(_mockSessionPrefix.length));
    var isNew = false;
    try {
      await _auth.signInWithEmailAndPassword(
          email: email, password: _mockPassword);
    } on FirebaseAuthException {
      await _auth.createUserWithEmailAndPassword(
          email: email, password: _mockPassword);
      isNew = true;
    }
    return OtpResult(uid: _auth.currentUser?.uid ?? '', isNewUser: isNew);
  }

  /// Ensure the customer doc exists (idempotent). Returns whether the profile
  /// is already complete (drives post-login routing).
  Future<bool> ensureCustomerDoc(String e164) async {
    final user = _auth.currentUser;
    if (user == null) return false;
    final ref = _db.doc('customers/${user.uid}');
    final snap = await ref.get();
    if (snap.exists) {
      return (snap.data()?['profileComplete'] as bool?) ?? false;
    }
    await ref.set(_defaultCustomer(user.uid, e164));
    return false;
  }

  /// Whether the signed-in customer has completed their profile (name set).
  /// Drives splash routing (→ Create Profile vs Home).
  Future<bool> isProfileComplete() async {
    final user = _auth.currentUser;
    if (user == null) return false;
    final snap = await _db.doc('customers/${user.uid}').get();
    if (!snap.exists) return false;
    final data = snap.data();
    final complete = data?['profileComplete'] as bool?;
    if (complete != null) return complete;
    final name = data?['name'] as String?;
    return name != null && name.isNotEmpty;
  }

  /// Record a newly-registered phone → uid in the pre-auth directory.
  /// Create the phone → uid directory entry, first time only.
  ///
  /// The `users/{phoneKey}` rule allows `create` but explicitly denies `update`,
  /// so a merge-write against an existing entry fails with permission-denied.
  /// That fired on EVERY returning login and, because the caller awaited it
  /// before navigating, left existing customers stranded on the OTP screen.
  /// The directory is a lookup convenience, never a login gate — so this checks
  /// first and swallows failures rather than blocking sign-in.
  Future<void> registerUser(String e164) async {
    final user = _auth.currentUser;
    if (user == null) return;
    final ref = _db.doc('users/${_digits(e164)}');
    try {
      if ((await ref.get()).exists) return;
      await ref.set({
        'phone': e164,
        'uid': user.uid,
        'createdAt': FieldValue.serverTimestamp(),
      });
    } catch (_) {
      // Non-critical: sign-in has already succeeded.
    }
  }

  /// Persist name/email and mark the profile complete. (Referral is applied
  /// separately via [linkReferral] — a Cloud Function — once this doc exists.)
  Future<void> completeProfile({
    required String name,
    String? email,
    String? avatarUrl,
  }) async {
    final user = _auth.currentUser;
    if (user == null) throw StateError('Not signed in.');
    final ref = _db.doc('customers/${user.uid}');
    final phone = (await ref.get()).data()?['phone'] as String?;
    await ref.update({
      'name': name.trim(),
      'email': email?.trim().isEmpty ?? true ? null : email!.trim(),
      if (avatarUrl != null && avatarUrl.isNotEmpty) 'avatarUrl': avatarUrl,
      'profileComplete': true,
      'searchIndex': _searchIndex([
        name.trim(),
        if (email != null && email.trim().isNotEmpty) email.trim(),
        if (phone != null) ..._phoneTokens(phone),
      ]),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Attach the signed-in customer to an affiliate via their referral code, by
  /// calling the **`linkReferral` Cloud Function** (asia-south1) — the SAME one
  /// the web uses. The CF validates the code against a live affiliate
  /// (`customers.affiliate.referralCode`), rejects self-referral / already-linked
  /// / disabled codes, and writes `customers/{uid}.referredBy` server-side (a
  /// client can't write another user's doc, so this must be a callable).
  ///
  /// Deliberately best-effort and never throws: by the time this runs the
  /// account already exists, so a mistyped code must not strand the user. An
  /// empty code is a no-op (the field is optional). Mirrors web/authActions.ts
  /// `linkReferral`.
  ///
  /// The failure is classified into a [ReferralLinkError] so the caller can act
  /// on it — a toast alone is not enough now that sign-up is the only chance a
  /// customer gets to be attributed to an affiliate.
  Future<ReferralResult> linkReferral(String rawCode) async {
    // Light client-side validation, exactly as the callable normalises it:
    // trim, upper-case, and treat empty as "no code" rather than an error. What
    // makes a code VALID is the server's to decide.
    final code = rawCode.trim().toUpperCase();
    if (code.isEmpty) return const ReferralResult(ok: true);
    try {
      final fn = FirebaseFunctions.instanceFor(region: 'asia-south1')
          .httpsCallable('linkReferral');
      final res = await fn.call<Map<String, dynamic>>({'code': code});
      final name = res.data['affiliateName'] as String?;
      return ReferralResult(
        ok: true,
        message: name != null && name.isNotEmpty
            ? 'Referral applied — thanks to $name!'
            : 'Referral code applied.',
      );
    } on FirebaseFunctionsException catch (e) {
      final error = _referralError(e);
      final message = e.message?.trim();
      return ReferralResult(
        ok: false,
        // The callable writes a human sentence for every rejection it makes, so
        // prefer it; the fallback only covers a transport-level failure that
        // arrives with none.
        message: message == null || message.isEmpty
            ? _referralFallback(error)
            : message,
        error: error,
      );
    } catch (_) {
      return ReferralResult(
        ok: false,
        message: _referralFallback(ReferralLinkError.unavailable),
        error: ReferralLinkError.unavailable,
      );
    }
  }

  /// `linkReferral` reuses `failed-precondition` for three unrelated verdicts,
  /// so the code alone can't separate them — only one of them (already linked)
  /// is final, and treating it as retryable would leave the customer editing a
  /// field that can never be accepted. Each message is matched on a phrase the
  /// server owns (functions/src/affiliate/referral.ts); an unrecognised one
  /// falls back to "retryable", which is the safe direction.
  static ReferralLinkError _referralError(FirebaseFunctionsException e) {
    final msg = (e.message ?? '').toLowerCase();
    return switch (e.code) {
      'not-found' => ReferralLinkError.unknownCode,
      'invalid-argument' => ReferralLinkError.malformed,
      'failed-precondition' when msg.contains('already linked') =>
        ReferralLinkError.alreadyLinked,
      'failed-precondition' when msg.contains('your own') =>
        ReferralLinkError.ownCode,
      'failed-precondition' when msg.contains('no longer active') =>
        ReferralLinkError.notActive,
      _ => ReferralLinkError.unavailable,
    };
  }

  static String _referralFallback(ReferralLinkError error) => switch (error) {
        ReferralLinkError.unknownCode => 'That referral code is not valid.',
        ReferralLinkError.notActive => 'That referral code is no longer active.',
        ReferralLinkError.ownCode => 'You cannot use your own referral code.',
        ReferralLinkError.alreadyLinked =>
          'Your account is already linked to a referrer.',
        ReferralLinkError.malformed => 'Check the referral code and try again.',
        ReferralLinkError.unavailable =>
          "Couldn't apply that referral code. Please try again.",
      };

  static List<String> _phoneTokens(String e164) =>
      [e164, e164.replaceFirst(RegExp(r'^\+?91'), '')];

  /// Lowercase prefix n-gram tokens — matches admin search (buildSearchIndex).
  static List<String> _searchIndex(List<String> sources) {
    final out = <String>{};
    for (final s in sources) {
      final t = s.toLowerCase().trim();
      if (t.isEmpty) continue;
      out.add(t);
      for (var i = 1; i <= t.length && i <= 20; i++) {
        out.add(t.substring(0, i));
      }
    }
    return out.toList();
  }

  Map<String, dynamic> _defaultCustomer(String uid, String e164) => {
        'id': uid,
        'uid': uid,
        'phone': e164,
        'phoneVerified': true,
        'name': '',
        'email': null,
        'emailVerified': false,
        'gstin': null,
        'avatarUrl': null,
        'profileComplete': false,
        'profileSkipped': false,
        'role': 'customer',
        'isBlocked': false,
        'blockReason': null,
        'blockedAt': null,
        'blockedByUid': null,
        'wallet': {
          'balancePaise': 0,
          'breakdown': {
            'refundsPaise': 0,
            'rewardsPaise': 0,
            'cashbackPaise': 0,
            'topupPaise': 0,
          },
          'lifetimeCreditsPaise': 0,
          'lifetimeDebitsPaise': 0,
          'lastTransactionAt': null,
        },
        'spinsRemaining': 0,
        'affiliate': null,
        'referredBy': null,
        'preferences': {
          'notificationsEnabled': true,
          'notifyOrderUpdates': true,
          'notifyPromotions': true,
          'notifyAffiliateEarnings': true,
          'notifyWalletActivity': true,
        },
        'stats': {
          'ordersCount': 0,
          'ordersDelivered': 0,
          'ordersCancelled': 0,
          'ordersReturned': 0,
          'totalSpentPaise': 0,
          'firstOrderAt': null,
          'lastOrderAt': null,
          'reviewsCount': 0,
          'wishlistCount': 0,
          'unreadNotifications': 0,
        },
        'cart': [],
        'addresses': [],
        'bankAccounts': [],
        'lastLoginAt': FieldValue.serverTimestamp(),
        'lastActiveAt': FieldValue.serverTimestamp(),
        'searchIndex': _searchIndex(_phoneTokens(e164)),
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      };
}
