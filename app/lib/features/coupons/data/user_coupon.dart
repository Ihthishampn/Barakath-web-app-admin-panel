import 'package:cloud_firestore/cloud_firestore.dart';

import '../../../core/utils/money.dart';

/// Coerce a stored numeric field to an int. Firestore hands back `double` for
/// anything written as a JS number, so a percent/paise value that round-trips as
/// e.g. 14.999999 must round — `toInt()` truncates and would silently under-
/// charge/over-discount. Matches the server, which uses `Math.round` throughout
/// (functions/src/orders/checkout.ts).
int _int(dynamic v) {
  if (v is int) return v;
  if (v is num) return v.isFinite ? v.round() : 0;
  return 0;
}

/// The three states a coupon can present in. NOTE: the backend never writes
/// `status:'expired'` (there is no sweep function) — an expired coupon keeps
/// `status:'active'` past its `expiresAt`. So expiry is computed on read here,
/// exactly as the checkout validator does server-side.
enum CouponState { active, used, expired }

/// A user-owned coupon instance (`customers/{uid}/coupons/{id}`). Mirrors the
/// web/admin `UserCoupon` shape. Spin rewards land here with `source == 'spin'`.
class UserCoupon {
  const UserCoupon({
    required this.id,
    required this.code,
    required this.title,
    required this.description,
    required this.discountType,
    required this.discountValuePaise,
    required this.discountPercent,
    required this.discountMaxCapPaise,
    required this.minCartValuePaise,
    required this.source,
    required this.status,
    required this.issuedAt,
    required this.expiresAt,
    required this.usedAt,
    this.usesCount = 0,
    this.maxUsesPerCoupon = 1,
  });

  final String id;
  final String code;
  final String title;
  final String description;

  /// 'flat' | 'percent' | 'free_shipping'
  final String discountType;
  final int discountValuePaise;
  final int discountPercent;
  final int discountMaxCapPaise;
  final int minCartValuePaise;

  /// 'spin' | 'welcome' | 'referral_bonus' | 'admin_grant' | 'promo'
  final String source;

  /// Raw stored status ('active' | 'used' | 'expired').
  final String status;
  final DateTime? issuedAt;
  final DateTime? expiresAt;
  final DateTime? usedAt;

  /// How many times THIS customer has redeemed this coupon.
  final int usesCount;

  /// The per-customer redemption limit. 0 means unlimited (only a
  /// promotional coupon can be — see [UserCoupon.fromPromo]; a personal
  /// spin/welcome coupon is never unlimited, so [fromDoc] floors it at 1).
  final int maxUsesPerCoupon;

  /// "0/2", "1/2" — how many of the per-customer allowance are spent, or null
  /// when this coupon has no such limit (an unlimited promotional coupon).
  String? get usageLabel =>
      maxUsesPerCoupon > 0 ? '$usesCount/$maxUsesPerCoupon' : null;

  /// The state to display — reconciles stored status with the expiry date.
  CouponState get state {
    if (status == 'used') return CouponState.used;
    final exp = expiresAt;
    if (exp != null && exp.isBefore(DateTime.now())) return CouponState.expired;
    if (status == 'expired') return CouponState.expired;
    return CouponState.active;
  }

  /// e.g. "₹10 off", "15% off", "Free delivery".
  String get headline {
    switch (discountType) {
      case 'flat':
        return '${Money.fromPaiseCompact(discountValuePaise)} off';
      case 'percent':
        return '$discountPercent% off';
      case 'free_shipping':
        return 'Free delivery';
      default:
        return title.isEmpty ? 'Reward' : title;
    }
  }

  /// e.g. "Spin reward · min ₹50".
  String get subtitle {
    final parts = <String>[
      switch (source) {
        'spin' => 'Spin reward',
        'welcome' => 'Welcome offer',
        'referral_bonus' => 'Referral bonus',
        'admin_grant' => 'Reward',
        _ => 'Coupon',
      },
      if (minCartValuePaise > 0) 'min ${Money.fromPaiseCompact(minCartValuePaise)}',
    ];
    return parts.join(' · ');
  }

  factory UserCoupon.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const <String, dynamic>{};
    DateTime? ts(dynamic v) => v is Timestamp ? v.toDate() : null;
    return UserCoupon(
      id: doc.id,
      code: (d['code'] as String?) ?? '',
      title: (d['title'] as String?) ?? '',
      description: (d['description'] as String?) ?? '',
      discountType: (d['discountType'] as String?) ?? 'flat',
      discountValuePaise: _int(d['discountValuePaise']),
      discountPercent: _int(d['discountPercent']),
      discountMaxCapPaise: _int(d['discountMaxCapPaise']),
      minCartValuePaise: _int(d['minCartValuePaise']),
      source: (d['source'] as String?) ?? 'spin',
      status: (d['status'] as String?) ?? 'active',
      issuedAt: ts(d['issuedAt']),
      expiresAt: ts(d['expiresAt']),
      usedAt: ts(d['usedAt']),
      usesCount: _int(d['usesCount']),
      // A personal coupon is never unlimited (evaluateUserCoupon /
      // _personalRedeemable both floor a stored 0 or absent value at 1), so an
      // unset/blank field must not be misread as "unlimited" here.
      maxUsesPerCoupon: () {
        final m = _int(d['maxUsesPerCoupon']);
        return m < 1 ? 1 : m;
      }(),
    );
  }

  /// Builds a "My Coupons" entry from a promotional (admin-created)
  /// `coupons/{id}` doc, viewed through this specific customer's personal
  /// state — [status] is pre-resolved (`promoPersonalStatus`,
  /// checkout/data/offers.dart) so this constructor doesn't duplicate that
  /// eligibility logic, only shapes the fields the ticket UI reads.
  ///
  /// [personalUses]/[maxUsesPerUser] are this customer's own redemption count
  /// and the admin's per-customer limit (`coupons/{id}.maxUsesPerUser` — 0
  /// means unlimited, unlike a personal coupon's [maxUsesPerCoupon]).
  factory UserCoupon.fromPromo(
    Map<String, dynamic> c, {
    required String status,
    required int personalUses,
    required int maxUsesPerUser,
    DateTime? lastUsedAt,
  }) {
    DateTime? ts(dynamic v) => v is Timestamp ? v.toDate() : null;
    return UserCoupon(
      id: (c['id'] as String?) ?? '',
      code: (c['code'] as String?) ?? '',
      title: (c['title'] as String?) ?? '',
      description: (c['description'] as String?) ?? '',
      discountType: (c['discountType'] as String?) ?? 'flat',
      discountValuePaise: _int(c['discountValuePaise']),
      discountPercent: _int(c['discountPercent']),
      discountMaxCapPaise: _int(c['discountMaxCapPaise']),
      minCartValuePaise: _int(c['minCartValuePaise']),
      source: 'promo',
      status: status,
      issuedAt: ts(c['validFrom']) ?? ts(c['createdAt']),
      expiresAt: ts(c['validUntil']),
      usedAt: lastUsedAt,
      usesCount: personalUses,
      maxUsesPerCoupon: maxUsesPerUser,
    );
  }
}
