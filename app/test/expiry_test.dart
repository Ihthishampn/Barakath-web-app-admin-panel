import 'package:barkath_app/core/utils/expiry.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  // Granted 14:32, expiring 7 calendar days later — the old hour-based maths
  // read "8 days" all morning and flipped to "7" mid-afternoon.
  final expiry = DateTime(2026, 7, 30, 14, 32);
  test('holds steady through the day', () {
    expect(daysUntilExpiry(expiry, now: DateTime(2026, 7, 23, 0, 1)), 7);
    expect(daysUntilExpiry(expiry, now: DateTime(2026, 7, 23, 9, 0)), 7);
    expect(daysUntilExpiry(expiry, now: DateTime(2026, 7, 23, 23, 59)), 7);
  });
  test('drops by exactly one at midnight', () {
    expect(daysUntilExpiry(expiry, now: DateTime(2026, 7, 24, 0, 1)), 6);
    expect(daysUntilExpiry(expiry, now: DateTime(2026, 7, 29, 0, 1)), 1);
    expect(daysUntilExpiry(expiry, now: DateTime(2026, 7, 30, 0, 1)), 0);
    expect(daysUntilExpiry(expiry, now: DateTime(2026, 7, 31, 0, 1)), -1);
  });
  test('labels', () {
    expect(expiryLabel(expiry, now: DateTime(2026, 7, 23)), 'Expires in 7 days');
    expect(expiryLabel(expiry, now: DateTime(2026, 7, 29)), 'Expires tomorrow');
    expect(expiryLabel(expiry, now: DateTime(2026, 7, 30, 23)), 'Expires today');
    expect(expiryLabel(expiry, now: DateTime(2026, 7, 31)), 'Expired');
    expect(expiryLabel(null), 'No expiry');
  });
}
