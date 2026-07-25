import 'package:flutter_test/flutter_test.dart';

import 'package:barkath_app/features/coupons/data/user_coupon.dart';

/// `usageLabel` — "0/2", "1/2" — the per-customer redemption counter shown on
/// the My Coupons ticket, and only when the coupon actually has a limit.
void main() {
  UserCoupon base({int usesCount = 0, int maxUsesPerCoupon = 1}) => UserCoupon(
        id: 'c1',
        code: 'SAVE10',
        title: '',
        description: '',
        discountType: 'flat',
        discountValuePaise: 1000,
        discountPercent: 0,
        discountMaxCapPaise: 0,
        minCartValuePaise: 0,
        source: 'promo',
        status: 'active',
        issuedAt: null,
        expiresAt: null,
        usedAt: null,
        usesCount: usesCount,
        maxUsesPerCoupon: maxUsesPerCoupon,
      );

  test('a fresh limited coupon reads 0/2', () {
    expect(base(usesCount: 0, maxUsesPerCoupon: 2).usageLabel, '0/2');
  });

  test('a once-used limited coupon reads 1/2', () {
    expect(base(usesCount: 1, maxUsesPerCoupon: 2).usageLabel, '1/2');
  });

  test('a fully-used single-use coupon reads 1/1', () {
    expect(base(usesCount: 1, maxUsesPerCoupon: 1).usageLabel, '1/1');
  });

  test('an unlimited coupon (maxUsesPerCoupon: 0) has no usage label', () {
    expect(base(usesCount: 5, maxUsesPerCoupon: 0).usageLabel, isNull);
  });

  test('fromPromo keeps maxUsesPerUser: 0 as unlimited (no label)', () {
    final c = UserCoupon.fromPromo(
      {'code': 'ADMIN10'},
      status: 'active',
      personalUses: 3,
      maxUsesPerUser: 0,
    );
    expect(c.usageLabel, isNull);
  });

  test('fromPromo surfaces the real per-customer count and limit', () {
    final c = UserCoupon.fromPromo(
      {'code': 'ADMIN10'},
      status: 'active',
      personalUses: 1,
      maxUsesPerUser: 2,
    );
    expect(c.usageLabel, '1/2');
  });
}
