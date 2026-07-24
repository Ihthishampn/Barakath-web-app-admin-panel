import 'package:flutter_test/flutter_test.dart';

import 'package:barkath_app/core/utils/money.dart';

void main() {
  test('Money.fromPaise formats INR with 2 decimals', () {
    expect(Money.fromPaise(124000), '₹1,240.00');
    expect(Money.fromPaise(8900), '₹89.00');
  });

  test('Money.signedFromPaise signs credits and debits', () {
    expect(Money.signedFromPaise(50000, credit: true), '+₹500.00');
    expect(Money.signedFromPaise(2400, credit: false), '−₹24.00');
  });
}
