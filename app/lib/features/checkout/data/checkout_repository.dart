import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../../cart/data/cart_line.dart';

/// Store settings that drive delivery pricing, tax and enabled payment methods.
class StoreSettings {
  const StoreSettings({
    this.freeDeliveryOverPaise = 0,
    this.standardFeePaise = 0,
    this.deliveryDaysMin = 3,
    this.deliveryDaysMax = 5,
    this.gstEnabled = false,
    this.pricesIncludeTax = true,
    this.gstRate = 0,
    // A missing / partial settings doc means "everything on" — the same
    // contract the web checkout uses, so both surfaces agree.
    this.walletEnabled = true,
    this.onlinePaymentEnabled = true,
    this.razorpayKeyId = '',
  });

  final int freeDeliveryOverPaise;
  final int standardFeePaise;
  final int deliveryDaysMin;
  final int deliveryDaysMax;
  final bool gstEnabled;
  final bool pricesIncludeTax;
  final double gstRate;
  final bool walletEnabled;
  final bool onlinePaymentEnabled;
  final String razorpayKeyId;
}

/// Line-item price breakdown, mirroring web `computeSummary`.
class CheckoutSummary {
  const CheckoutSummary({
    required this.subtotalPaise,
    required this.discountPaise,
    required this.deliveryPaise,
    required this.taxPaise,
    required this.totalPaise,
    required this.walletUsedPaise,
    required this.payablePaise,
    required this.freeDelivery,
  });

  final int subtotalPaise;
  final int discountPaise;
  final int deliveryPaise;
  final int taxPaise;
  final int totalPaise; // before wallet
  final int walletUsedPaise;
  final int payablePaise; // total − wallet
  final bool freeDelivery;
}

class AppliedCoupon {
  const AppliedCoupon(
      {required this.code,
      required this.discountPaise,
      required this.label,
      this.waiveDelivery = false});
  final String code;
  final int discountPaise;
  final String label;

  /// A `free_shipping` coupon discounts nothing — it waives the delivery fee
  /// instead (`summarise` in functions/src/orders/checkout.ts waives it, and
  /// `applyCoupon` returns the flag precisely so clients can mirror that).
  /// Without it the summary charges a delivery the server does not.
  final bool waiveDelivery;
}

/// A server-side hold on the stock for one checkout attempt (`stockReservations`).
class StockHold {
  const StockHold({required this.reservationId, required this.expiresAt});
  final String reservationId;
  final DateTime expiresAt;
}

/// Process-wide handle on the stock hold for the checkout in progress.
///
/// `reserveStock` takes the units the moment Checkout opens, so `placeOrder`
/// must be told which reservation to consume — otherwise it runs its own
/// validate-and-decrement and the same units come out of stock twice. Checkout
/// and Payment are separate routes with separate `State` objects (and an online
/// order is actually placed from Payment), so the id lives here rather than in
/// either screen. Checkout clears/releases it when it is abandoned; Payment
/// clears it the moment the server has consumed it.
abstract final class CheckoutHold {
  static String? reservationId;
  static void clear() => reservationId = null;
}

/// The idempotency key for the checkout attempt in progress.
///
/// `placeOrder` dedupes forever on an explicit `placementNonce`, which is the
/// only thing standing between a retry and a SECOND order (a second stock
/// decrement, a second wallet debit, a second shortId). It therefore has to
/// outlive the widget that sends it: the Payment screen is pushed anew on every
/// tap of the pay bar, so a nonce owned by its `State` was reborn each time and
/// a customer who backed out after a failed payment and paid again got two
/// orders. Web keeps its nonce for exactly this case (`nonceRef` on the
/// checkout page, retired only once an order completes).
///
/// Scope = one visit to the Checkout screen: minted on first use, cleared when
/// an order completes and when Checkout is disposed, so the NEXT order gets a
/// fresh key instead of replaying the last one.
abstract final class CheckoutAttempt {
  static String? _nonce;

  /// The nonce for this attempt, minted on first use.
  static String get nonce =>
      _nonce ??= 'app_${DateTime.now().microsecondsSinceEpoch}';

  static void clear() => _nonce = null;
}

/// Reads store settings and calls the customer-facing order Cloud Functions
/// (asia-south1) — the SAME functions the web uses (`applyCoupon`, `placeOrder`,
/// `createRazorpayOrder`, `verifyPayment`).
class CheckoutRepository {
  CheckoutRepository({FirebaseFirestore? db, FirebaseFunctions? functions})
      : _db = db ?? FirebaseFirestore.instance,
        _fn = functions ??
            FirebaseFunctions.instanceFor(region: 'asia-south1');

  final FirebaseFirestore _db;
  final FirebaseFunctions _fn;

  /// Live availability for every cart line, keyed by [CartLine.key] → units in
  /// stock. Mirrors the check `placeOrder` performs server-side, so the pay bar
  /// can block a doomed order instead of letting the callable reject it.
  ///
  /// Firestore caps `whereIn` at 30 ids, so the products are queried in chunks
  /// and the chunk snapshots merged; the stream emits only once every chunk has
  /// reported, so callers never see a half-built map.
  Stream<Map<String, int>> watchLineStock(List<CartLine> lines) {
    final ids = lines.map((l) => l.productId).toSet().toList();
    if (ids.isEmpty) return Stream.value(const {});

    final chunks = <List<String>>[];
    for (var i = 0; i < ids.length; i += 30) {
      chunks.add(ids.sublist(i, i + 30 > ids.length ? ids.length : i + 30));
    }

    final latest = <int, List<QueryDocumentSnapshot<Map<String, dynamic>>>>{};
    final subs = <StreamSubscription<void>>[];
    late StreamController<Map<String, int>> ctrl;
    ctrl = StreamController<Map<String, int>>(
      onListen: () {
        for (var c = 0; c < chunks.length; c++) {
          final index = c;
          subs.add(
            _db
                .collection('products')
                .where(FieldPath.documentId, whereIn: chunks[index])
                .snapshots()
                .listen((snap) {
              latest[index] = snap.docs;
              if (latest.length < chunks.length) return; // still filling
              ctrl.add(_stockByLine(
                  lines, latest.values.expand((d) => d).toList()));
            }, onError: ctrl.addError),
          );
        }
      },
      onCancel: () async {
        for (final s in subs) {
          await s.cancel();
        }
      },
    );
    return ctrl.stream;
  }

  /// Resolves each line to its sellable units. A product that no longer exists,
  /// is unpublished or hidden counts as zero — it can't be bought either way.
  Map<String, int> _stockByLine(List<CartLine> lines,
      List<QueryDocumentSnapshot<Map<String, dynamic>>> docs) {
    final byId = {for (final d in docs) d.id: d.data()};
    final out = <String, int>{};
    for (final l in lines) {
      final d = byId[l.productId];
      if (d == null ||
          d['status'] != 'published' ||
          d['visibility'] == 'hidden') {
        out[l.key] = 0;
        continue;
      }
      final variantId = l.variantId;
      if (variantId != null && variantId.isNotEmpty) {
        final v = ((d['variants'] as List?) ?? const [])
            .whereType<Map>()
            .where((m) => m['id'] == variantId)
            .firstOrNull;
        out[l.key] = v == null ? 0 : ((v['stock'] as num?)?.toInt() ?? 0);
      } else {
        out[l.key] = (d['stock'] as num?)?.toInt() ?? 0;
      }
    }
    return out;
  }

  Future<StoreSettings> fetchSettings() async {
    final results = await Future.wait([
      _db.doc('settings/delivery').get(),
      _db.doc('settings/tax').get(),
      _db.doc('settings/paymentGateway').get(),
    ]);
    final d = results[0].data() ?? const {};
    final t = results[1].data() ?? const {};
    final g = results[2].data() ?? const {};
    int i(Map m, String k) => (m[k] as num?)?.toInt() ?? 0;
    return StoreSettings(
      freeDeliveryOverPaise: i(d, 'freeDeliveryOverPaise'),
      standardFeePaise: i(d, 'standardFeePaise'),
      deliveryDaysMin: (d['deliveryDaysMin'] as num?)?.toInt() ?? 3,
      deliveryDaysMax: (d['deliveryDaysMax'] as num?)?.toInt() ?? 5,
      gstEnabled: (t['gstEnabled'] as bool?) ?? false,
      pricesIncludeTax: (t['pricesIncludeTax'] as bool?) ?? true,
      gstRate: (t['gstRate'] as num?)?.toDouble() ?? 0,
      // Absent flags fall back to enabled (web: `gateway?.walletEnabled ?? true`)
      // so a settings doc written before these toggles existed doesn't silently
      // hide the wallet / online payment in the app only.
      walletEnabled: (g['walletEnabled'] as bool?) ?? true,
      onlinePaymentEnabled: (g['onlinePaymentEnabled'] as bool?) ?? true,
      razorpayKeyId: (g['razorpayKeyId'] as String?) ?? '',
    );
  }

  /// Pure price math (matches web).
  CheckoutSummary computeSummary(
    int subtotalPaise,
    StoreSettings s, {
    AppliedCoupon? coupon,
    int? walletBalancePaise,
  }) {
    final discount =
        (coupon?.discountPaise ?? 0).clamp(0, subtotalPaise).toInt();
    final net = (subtotalPaise - discount).clamp(0, subtotalPaise).toInt();

    final threshold = s.freeDeliveryOverPaise;
    // Mirrors `summarise` in functions/src/orders/checkout.ts term-for-term:
    // `waiveDelivery || subtotalPaise <= 0 || (threshold > 0 && net >= threshold)`.
    // The waiveDelivery term was missing, so a free-delivery coupon showed a
    // delivery fee the server waives — the screen quoted more than was charged.
    final freeDelivery = (coupon?.waiveDelivery ?? false) ||
        subtotalPaise <= 0 ||
        (threshold > 0 && net >= threshold);
    final delivery = freeDelivery ? 0 : s.standardFeePaise;
    final tax = (s.gstEnabled && !s.pricesIncludeTax)
        ? (net * s.gstRate).round()
        : 0;
    final total = net + delivery + tax;

    final walletUsed = (walletBalancePaise != null && walletBalancePaise > 0)
        ? (walletBalancePaise < total ? walletBalancePaise : total)
        : 0;
    final payable = (total - walletUsed).clamp(0, total).toInt();

    return CheckoutSummary(
      subtotalPaise: subtotalPaise,
      discountPaise: discount,
      deliveryPaise: delivery,
      taxPaise: tax,
      totalPaise: total,
      walletUsedPaise: walletUsed,
      payablePaise: payable,
      freeDelivery: freeDelivery,
    );
  }

  List<Map<String, dynamic>> _payload(List<CartLine> lines) => lines
      .map((l) => {
            'productId': l.productId,
            'variantId': l.variantId,
            'qty': l.qty,
          })
      .toList();

  /// Validate a coupon code against the cart. Throws [FirebaseFunctionsException]
  /// with a user-facing message on invalid/expired codes.
  Future<AppliedCoupon> applyCoupon(String code, List<CartLine> lines) async {
    final res = await _fn.httpsCallable('applyCoupon').call<Map<String, dynamic>>({
      'code': code.trim().toUpperCase(),
      'lines': _payload(lines),
    });
    return AppliedCoupon(
      code: code.trim().toUpperCase(),
      discountPaise: (res.data['discountPaise'] as num?)?.toInt() ?? 0,
      label: (res.data['label'] as String?) ?? 'Coupon applied',
      // The callable returns this for exactly one reason: a free_shipping
      // coupon carries a ZERO discount, so dropping the flag left the summary
      // charging delivery while `placeOrder` waived it.
      waiveDelivery: (res.data['waiveDelivery'] as bool?) ?? false,
    );
  }

  /// Hold the stock for this bag for 15 minutes, so a slow checkout can't be
  /// beaten to the last unit. The units come out of `products` immediately, so
  /// callers must release the hold (or let it be consumed by [placeOrder]).
  ///
  /// Throws [FirebaseFunctionsException] `failed-precondition` with a
  /// user-facing `"<name> is out of stock."` when a line can't be met.
  Future<StockHold> reserveStock(List<CartLine> lines) async {
    final res = await _fn
        .httpsCallable(
          'reserveStock',
          // Same reasoning as placeOrder: an asia-south1 cold start plus a
          // multi-product transaction runs well past a snappy default.
          options: HttpsCallableOptions(timeout: const Duration(seconds: 60)),
        )
        .call<Map<String, dynamic>>({'lines': _payload(lines)});
    final millis = (res.data['expiresAtMillis'] as num?)?.toInt() ?? 0;
    return StockHold(
      reservationId: (res.data['reservationId'] as String?) ?? '',
      expiresAt: millis > 0
          ? DateTime.fromMillisecondsSinceEpoch(millis)
          : DateTime.now().add(const Duration(minutes: 15)),
    );
  }

  /// Give the held units back. Idempotent server-side (a consumed or already
  /// released reservation is a no-op), and best-effort here: this is called
  /// while a screen is being torn down, and the 5-minute sweep restores
  /// anything that slips through, so a failure is a delay and never a leak.
  Future<bool> releaseStock(String reservationId) async {
    if (reservationId.isEmpty) return false;
    try {
      final res = await _fn
          .httpsCallable('releaseStock')
          .call<Map<String, dynamic>>({'reservationId': reservationId});
      return (res.data['ok'] as bool?) ?? true;
    } catch (_) {
      return false;
    }
  }

  /// Record that the gateway leg failed, leaving the order itself (and its
  /// stock) intact so the customer can pay it from My orders. Idempotent, and a
  /// no-op once the payment is captured — so it is safe to call on a cancel, a
  /// gateway error or a failed verification. Best-effort: the screen tells the
  /// customer what happened either way.
  Future<bool> markPaymentFailed({
    required String orderId,
    String? reason,
  }) async {
    if (orderId.isEmpty) return false;
    try {
      await _fn.httpsCallable('markPaymentFailed').call<Map<String, dynamic>>({
        'orderId': orderId,
        'reason': reason,
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  /// `orders/{id}.paymentStatus` (owner-scoped read). Used to settle what
  /// actually happened when the gateway never reported back — e.g. the native
  /// checkout was killed while the app sat in the background. Null when the
  /// order or the read is unavailable, which the caller must treat as "unknown"
  /// rather than "failed".
  Future<String?> fetchPaymentStatus(String orderId) async {
    if (orderId.isEmpty) return null;
    try {
      final d = (await _db.doc('orders/$orderId').get()).data();
      if (d == null) return null;
      return (d['paymentStatus'] as String?) ?? '';
    } catch (_) {
      return null;
    }
  }

  /// Place the order atomically (stock↓, wallet↓, shortId). The order stays
  /// 'pending' until [verifyPayment], unless nothing is payable — in which case
  /// the server settles it outright and reports back 'wallet'.
  ///
  /// [walletOnly] picks the method: 'wallet' means "there is nothing left for a
  /// gateway to collect", and it is the only method the server still accepts
  /// while online payment is switched off (cash on delivery is gone). It is
  /// rejected outright if the server's own summary leaves anything payable, so
  /// only pass it when this client's summary says zero. Everything else goes as
  /// 'razorpay' — including a zero-payable order the server works out for
  /// itself, which it records as a settled wallet payment either way.
  ///
  /// [reservationId] names the hold taken by [reserveStock]: the server
  /// consumes it and skips the decrement, because those units are already out
  /// of stock. Passing null (or an expired/foreign hold) falls back to the
  /// validate-and-decrement path unchanged.
  ///
  /// [noCoupon] says the customer deliberately has NO coupon. It is NOT the
  /// same as `couponCode: null`: the server treats an absent code as "auto-apply
  /// the best offer for me" and only honours "no coupon" when this flag is set
  /// (`explicitlyNoCoupon`, functions/src/orders/checkout.ts). The app picks its
  /// own offer and shows the resulting total, so without this a coupon the
  /// customer REMOVED was silently re-applied — the order was charged
  /// differently from the screen and a one-time spin reward was burnt.
  Future<PlacedOrder> placeOrder({
    required List<CartLine> lines,
    required String addressId,
    String? couponCode,
    required bool noCoupon,
    bool useWallet = false,
    bool walletOnly = false,
    required String placementNonce,
    String? reservationId,
  }) async {
    final res = await _fn
        .httpsCallable(
          'placeOrder',
          // A cold start in asia-south1 plus the order transaction has been
          // observed at ~7s; the default 60s cuts it off on a slow connection
          // and leaves the customer unsure whether the order went through.
          options: HttpsCallableOptions(timeout: const Duration(seconds: 120)),
        )
        .call<Map<String, dynamic>>({
      'lines': _payload(lines),
      'addressId': addressId,
      // Cash on delivery is gone, so these are the only two the server takes.
      'paymentMethod': walletOnly ? 'wallet' : 'razorpay',
      'couponCode': couponCode,
      // Same payload the web sends (`noCoupon: !draft.coupon`, web checkout
      // page.tsx) — see the doc comment above.
      'noCoupon': noCoupon,
      'useWallet': useWallet,
      'placementNonce': placementNonce,
      'reservationId': reservationId,
    });
    return PlacedOrder(
      orderId: (res.data['orderId'] as String?) ?? '',
      shortId: (res.data['shortId'] as String?) ?? '',
      amountPaise: (res.data['amountPaise'] as num?)?.toInt() ?? 0,
      // The server's EFFECTIVE method ('wallet' when it covered everything),
      // which is what decides whether a gateway leg is still owed.
      paymentMethod: (res.data['paymentMethod'] as String?) ?? 'razorpay',
    );
  }

  /// Did an order for [placementNonce] actually land?
  ///
  /// `placeOrder` is idempotent on the nonce, but a timeout leaves the client
  /// blind: the transaction may well have committed after the deadline passed.
  /// Scanning the customer's recent orders (an existing index, and the same
  /// owner-scoped read the Orders tab uses) settles it before we tell someone
  /// their order failed — or let them place a second one.
  Future<PlacedOrder?> findOrderByNonce(String uid, String placementNonce) async {
    try {
      final snap = await _db
          .collection('orders')
          .where('customerId', isEqualTo: uid)
          .orderBy('createdAt', descending: true)
          .limit(5)
          .get();
      for (final d in snap.docs) {
        final data = d.data();
        if (data['placementNonce'] != placementNonce) continue;
        // The callable returns `summary.payablePaise` (total AFTER the wallet
        // debit) as amountPaise, but the order doc stores the pre-wallet
        // `totalPaise` — subtract the wallet so the confirmation screen doesn't
        // quote an amount that includes money already paid from the wallet.
        final total = (data['totalPaise'] as num?)?.toInt() ?? 0;
        final walletUsed = (data['walletUsedPaise'] as num?)?.toInt() ?? 0;
        return PlacedOrder(
          orderId: d.id,
          shortId: (data['shortId'] as String?) ?? '',
          amountPaise: (total - walletUsed).clamp(0, total).toInt(),
          // Whatever the doc says — this reads an order that already exists.
          paymentMethod: (data['paymentMethod'] as String?) ?? 'razorpay',
        );
      }
    } catch (_) {
      // Best-effort — the caller falls back to its "check your orders" message.
    }
    return null;
  }

  Future<RazorpayOrder> createRazorpayOrder(String orderId) async {
    final res = await _fn
        .httpsCallable('createRazorpayOrder')
        .call<Map<String, dynamic>>({'orderId': orderId});
    return RazorpayOrder(
      razorpayOrderId: (res.data['razorpayOrderId'] as String?) ?? '',
      amountPaise: (res.data['amountPaise'] as num?)?.toInt() ?? 0,
      keyId: (res.data['keyId'] as String?) ?? '',
    );
  }

  Future<bool> verifyPayment({
    required String orderId,
    required String razorpayOrderId,
    required String razorpayPaymentId,
    required String razorpaySignature,
  }) async {
    final res = await _fn.httpsCallable('verifyPayment').call<Map<String, dynamic>>({
      'orderId': orderId,
      'razorpayOrderId': razorpayOrderId,
      'razorpayPaymentId': razorpayPaymentId,
      'razorpaySignature': razorpaySignature,
    });
    return (res.data['verified'] as bool?) ?? false;
  }

  /// "Arrives by" copy from the delivery window, e.g. "Tue, 22 Jul".
  DateTime estimateArrival(StoreSettings s) {
    final days = s.deliveryDaysMax > 0 ? s.deliveryDaysMax : s.deliveryDaysMin;
    return DateTime.now().add(Duration(days: days > 0 ? days : 4));
  }
}

class PlacedOrder {
  const PlacedOrder({
    required this.orderId,
    required this.shortId,
    required this.amountPaise,
    required this.paymentMethod,
  });
  final String orderId;
  final String shortId;
  final int amountPaise;
  final String paymentMethod;
}

class RazorpayOrder {
  const RazorpayOrder(
      {required this.razorpayOrderId,
      required this.amountPaise,
      required this.keyId});
  final String razorpayOrderId;
  final int amountPaise;
  final String keyId;
}
