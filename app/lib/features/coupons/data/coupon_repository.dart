import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../../checkout/data/offers.dart';
import 'user_coupon.dart';

/// Streams the customer's full "My Coupons" list: their personal coupons
/// (`customers/{uid}/coupons` — spin/welcome rewards) merged with every
/// admin-created promotional coupon (`coupons`) they can currently redeem or
/// have already redeemed.
///
/// Checkout already merges these two sources ([OffersRepository]); before
/// this, "My Coupons" read only the personal collection, so an admin coupon
/// applied fine at checkout but could never be seen — or shown as Used —
/// here.
class CouponRepository {
  CouponRepository({FirebaseFirestore? db, OffersRepository? offers})
      : _db = db ?? FirebaseFirestore.instance,
        _offers = offers ?? OffersRepository(db: db);
  final FirebaseFirestore _db;
  final OffersRepository _offers;

  Stream<List<UserCoupon>> _personalCoupons(String uid) => _db
      .collection('customers/$uid/coupons')
      .orderBy('issuedAt', descending: true)
      .snapshots()
      .map((s) => s.docs.map(UserCoupon.fromDoc).toList());

  Stream<List<UserCoupon>> myCoupons(String uid) => _combineLatest3(
        _personalCoupons(uid),
        _offers.allPromoCoupons(),
        _offers.customerFacts(uid),
        (personal, promos, facts) {
          final now = DateTime.now().millisecondsSinceEpoch;
          final visiblePromos = promos
              .where((c) => promoVisibleToCustomer(c, facts, now))
              .map((c) {
                final id = (c['id'] as String?) ?? '';
                final maxUsesPerUser = (c['maxUsesPerUser'] as num?)?.toInt() ?? 0;
                return UserCoupon.fromPromo(
                  c,
                  status: promoPersonalStatus(c, facts, now),
                  personalUses: facts.usesOfPromo(id),
                  maxUsesPerUser: maxUsesPerUser < 0 ? 0 : maxUsesPerUser,
                  lastUsedAt: facts.lastUsedOfPromo(id),
                );
              })
              .toList();
          final merged = [...personal, ...visiblePromos]
            ..sort((a, b) => _sortMillis(b).compareTo(_sortMillis(a)));
          return merged;
        },
      );

  /// Newest-first key: issuance date, falling back to the expiry date so a
  /// promo coupon with no personal `issuedAt` still sorts sensibly among
  /// spin/welcome rewards instead of always landing last.
  static int _sortMillis(UserCoupon c) =>
      (c.issuedAt ?? c.expiresAt ?? DateTime.fromMillisecondsSinceEpoch(0))
          .millisecondsSinceEpoch;

  /// Three-source combineLatest (the app has no rxdart) — same hand-rolled
  /// shape as `SpinRepository._combineLatest`
  /// (app/lib/features/spin/data/spin_repository.dart), extended to three
  /// inputs: emits once all three streams have produced a value, then again
  /// on every later change of any one of them.
  static Stream<R> _combineLatest3<A, B, C, R>(
    Stream<A> a,
    Stream<B> b,
    Stream<C> c,
    R Function(A, B, C) combine,
  ) {
    A? lastA;
    B? lastB;
    C? lastC;
    var hasA = false;
    var hasB = false;
    var hasC = false;
    StreamSubscription<A>? subA;
    StreamSubscription<B>? subB;
    StreamSubscription<C>? subC;
    late StreamController<R> ctrl;
    void emit() {
      if (hasA && hasB && hasC) {
        ctrl.add(combine(lastA as A, lastB as B, lastC as C));
      }
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
        subC = c.listen((v) {
          lastC = v;
          hasC = true;
          emit();
        }, onError: ctrl.addError);
      },
      onCancel: () async {
        await subA?.cancel();
        await subB?.cancel();
        await subC?.cancel();
      },
    );
    return ctrl.stream;
  }
}
