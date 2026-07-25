import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import 'spin_campaign.dart';

/// Reads the active Spin & Win campaign, computes the customer's remaining
/// daily spins, and calls the server-authoritative `executeSpin` callable
/// (asia-south1) — the SAME function the web uses. All prize writes (coupon,
/// wallet cashback, spinHistory) happen inside that function; the client never
/// writes them directly.
class SpinRepository {
  SpinRepository({FirebaseFirestore? db, FirebaseFunctions? functions})
      : _db = db ?? FirebaseFirestore.instance,
        _fn = functions ??
            FirebaseFunctions.instanceFor(region: 'asia-south1');

  final FirebaseFirestore _db;
  final FirebaseFunctions _fn;

  /// The single active campaign (admin sets `status == 'active'`). Null if none.
  ///
  /// `status` alone is not enough: nothing ever flips it when the campaign's
  /// window opens/closes, while `executeSpin` rejects any spin outside
  /// startsAt…endsAt with `failed-precondition`. Filtering the window here keeps
  /// a scheduled/ended campaign from rendering a wheel that can only fail.
  Stream<SpinCampaign?> activeCampaign() => _db
      .collection('spinCampaigns')
      .where('status', isEqualTo: 'active')
      .snapshots()
      .map((s) {
        final now = DateTime.now();
        for (final d in s.docs) {
          if (_isLive(d.data(), now)) return SpinCampaign.fromDoc(d);
        }
        return null;
      });

  /// Whether `now` falls inside the campaign's configured window. Missing bounds
  /// mean "unbounded on that side", mirroring the backend check.
  static bool _isLive(Map<String, dynamic> d, DateTime now) {
    final startsAt = d['startsAt'];
    final endsAt = d['endsAt'];
    if (startsAt is Timestamp && now.isBefore(startsAt.toDate())) return false;
    if (endsAt is Timestamp && now.isAfter(endsAt.toDate())) return false;
    return true;
  }

  /// The customer's own spin history (source of truth for the daily cap).
  Stream<List<Map<String, dynamic>>> _history(String uid) => _db
      .collection('spinHistory')
      .where('customerId', isEqualTo: uid)
      .snapshots()
      .map((s) => s.docs.map((d) => d.data()).toList());

  /// The customer's admin-granted bonus spins (`customers/{uid}.spinsRemaining`,
  /// written by the adminGrantSpins callable).
  Stream<int> _grantedSpins(String uid) => _db
      .doc('customers/$uid')
      .snapshots()
      .map((s) => (s.data()?['spinsRemaining'] as num?)?.toInt() ?? 0);

  /// Spins the customer has left today for [campaign] — the real gate, matching
  /// the backend: `spinsPerDay − (spins since IST midnight for this campaign)`,
  /// PLUS any admin-granted spins.
  ///
  /// `spinsRemaining` is a bonus balance `executeSpin` spends once the daily cap
  /// is exhausted (`exhaustedDaily && remaining <= 0` is the only rejection).
  /// Counting only the daily allowance made every grant unspendable: the Spin
  /// button is disabled at 0, so the admin's "Grant spins" did nothing the
  /// customer could use. The web computes the same sum.
  Stream<int> spinsLeftToday(String uid, SpinCampaign campaign) {
    final perDay = campaign.spinsPerDay < 1 ? 1 : campaign.spinsPerDay;
    return _combineLatest<List<Map<String, dynamic>>, int, int>(
      _history(uid),
      _grantedSpins(uid),
      (rows, granted) {
        final since = _istMidnightMillis();
        final usedToday = rows.where((r) {
          if ((r['campaignId'] as String?) != campaign.id) return false;
          final ts = r['createdAt'];
          final ms = ts is Timestamp ? ts.millisecondsSinceEpoch : 0;
          return ms >= since;
        }).length;
        final left = perDay - usedToday;
        return (left < 0 ? 0 : left) + (granted < 0 ? 0 : granted);
      },
    );
  }

  /// Minimal two-source combineLatest (the app has no rxdart): emits once both
  /// streams have produced a value, then on every later change of either.
  static Stream<R> _combineLatest<A, B, R>(
      Stream<A> a, Stream<B> b, R Function(A, B) combine) {
    A? lastA;
    B? lastB;
    var hasA = false;
    var hasB = false;
    StreamSubscription<A>? subA;
    StreamSubscription<B>? subB;
    late StreamController<R> ctrl;
    void emit() {
      if (hasA && hasB) ctrl.add(combine(lastA as A, lastB as B));
    }

    ctrl = StreamController<R>(
      onListen: () {
        subA = a.listen((v) {
          lastA = v;
          hasA = true;
          emit();
        }, onError: ctrl.addError);
        subB = b.listen((v) {
          lastB = v;
          hasB = true;
          emit();
        }, onError: ctrl.addError);
      },
      onCancel: () async {
        await subA?.cancel();
        await subB?.cancel();
      },
    );
    return ctrl.stream;
  }

  /// Epoch millis of the most recent IST (UTC+5:30) midnight — same math the
  /// backend `executeSpin` uses to bound "today".
  static int _istMidnightMillis() {
    const istOffset = 5.5 * 3600 * 1000;
    final now = DateTime.now().millisecondsSinceEpoch;
    final dayMs = 86400000;
    final istDayStart = ((now + istOffset) / dayMs).floor() * dayMs;
    return (istDayStart - istOffset).round();
  }

  /// Perform one spin. Returns the prize the server chose. Throws
  /// [FirebaseFunctionsException] (`resource-exhausted` when no spins remain,
  /// `failed-precondition` when the campaign is closed).
  Future<SpinOutcome> executeSpin(String campaignId) async {
    final res = await _fn
        .httpsCallable('executeSpin')
        .call<Map<String, dynamic>>({'campaignId': campaignId});
    return SpinOutcome.fromData(res.data);
  }
}
