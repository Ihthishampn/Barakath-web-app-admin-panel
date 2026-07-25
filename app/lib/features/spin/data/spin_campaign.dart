import 'package:cloud_firestore/cloud_firestore.dart';

int _int(dynamic v) => (v as num?)?.toInt() ?? 0;

/// One wheel segment (embedded array element on a [SpinCampaign] doc).
/// Mirrors the web/admin `SpinSlice` shape (packages/shared commerce types).
class SpinSlice {
  const SpinSlice({
    required this.id,
    required this.order,
    required this.prizeType,
    required this.discountValuePaise,
    required this.discountPercent,
    required this.discountMaxCapPaise,
    required this.minCartValuePaise,
    required this.validityDays,
    required this.weight,
    required this.displayLabel,
    required this.secondaryLabel,
  });

  final String id;
  final int order;

  /// 'flat_discount' | 'percent_discount' | 'cashback' | 'free_shipping' | 'better_luck'
  final String prizeType;
  final int discountValuePaise;
  final int discountPercent;
  final int discountMaxCapPaise;
  final int minCartValuePaise;
  final int validityDays;
  final int weight;
  final String displayLabel;
  final String secondaryLabel;

  bool get isCoupon =>
      prizeType == 'flat_discount' ||
      prizeType == 'percent_discount' ||
      prizeType == 'free_shipping';
  bool get isCashback => prizeType == 'cashback';
  bool get isBetterLuck => prizeType == 'better_luck';

  factory SpinSlice.fromMap(Map<String, dynamic> m) => SpinSlice(
        id: (m['id'] as String?) ?? '',
        order: _int(m['order']),
        prizeType: (m['prizeType'] as String?) ?? 'better_luck',
        discountValuePaise: _int(m['discountValuePaise']),
        discountPercent: _int(m['discountPercent']),
        discountMaxCapPaise: _int(m['discountMaxCapPaise']),
        minCartValuePaise: _int(m['minCartValuePaise']),
        validityDays: _int(m['validityDays']),
        weight: _int(m['weight']),
        displayLabel: (m['displayLabel'] as String?)?.trim() ?? '',
        secondaryLabel: (m['secondaryLabel'] as String?)?.trim() ?? '',
      );
}

/// An admin-configured Spin & Win campaign (`spinCampaigns/{id}`). The wheel is
/// the embedded [slices] array; [spinsPerDay] is the per-customer daily cap.
class SpinCampaign {
  const SpinCampaign({
    required this.id,
    required this.name,
    required this.status,
    required this.slices,
    required this.spinsPerDay,
    required this.rewardCouponExpiryDays,
  });

  final String id;
  final String name;
  final String status;
  final List<SpinSlice> slices;
  final int spinsPerDay;
  final int rewardCouponExpiryDays;

  factory SpinCampaign.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const <String, dynamic>{};
    final raw = (d['slices'] as List?) ?? const [];
    final slices = raw
        .whereType<Map<String, dynamic>>()
        .map(SpinSlice.fromMap)
        .toList()
      ..sort((a, b) => a.order.compareTo(b.order));
    return SpinCampaign(
      id: doc.id,
      name: (d['name'] as String?) ?? 'Spin & Win',
      status: (d['status'] as String?) ?? 'draft',
      slices: slices,
      spinsPerDay: (d['spinsPerDay'] as num?)?.toInt() ?? 1,
      rewardCouponExpiryDays:
          (d['rewardCouponExpiryDays'] as num?)?.toInt() ?? 3,
    );
  }
}

/// Result of `executeSpin` — the prize the server chose. The reward coupon (if
/// any) is already written to `customers/{uid}/coupons` by the function.
class SpinOutcome {
  const SpinOutcome({
    required this.sliceId,
    required this.label,
    required this.secondaryLabel,
    required this.couponCode,
    required this.prizeType,
  });

  final String sliceId;
  final String label;
  final String secondaryLabel;
  final String? couponCode;
  final String prizeType;

  factory SpinOutcome.fromData(Map<String, dynamic> d) => SpinOutcome(
        sliceId: (d['sliceId'] as String?) ?? '',
        label: (d['label'] as String?) ?? '',
        secondaryLabel: (d['secondaryLabel'] as String?) ?? '',
        couponCode: d['couponCode'] as String?,
        prizeType: (d['prizeType'] as String?) ?? 'better_luck',
      );
}
