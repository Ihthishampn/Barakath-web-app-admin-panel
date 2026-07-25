/// Calendar-day countdown for coupon expiry.
///
/// Counting whole elapsed hours makes the number depend on the *time of day* a
/// coupon was granted: one issued at 14:32 reads "8 days" all morning and flips
/// to "7 days" mid-afternoon. Customers read this as calendar days, so both
/// instants are floored to local midnight first — the number then holds steady
/// through the day and drops by exactly one each midnight.
library;

/// Whole days from today until [expiresAt]: 0 = expires today, 1 = tomorrow,
/// negative = already past. Uses local midnight boundaries on both sides.
int daysUntilExpiry(DateTime expiresAt, {DateTime? now}) {
  final n = now ?? DateTime.now();
  // Compare the two calendar dates as UTC midnights: a UTC day is always 24h,
  // so no DST shift can turn a day into 23 or 25 hours and skew the count.
  final today = DateTime.utc(n.year, n.month, n.day);
  final end = DateTime.utc(expiresAt.year, expiresAt.month, expiresAt.day);
  return end.difference(today).inDays;
}

/// "Expires today / tomorrow / in N days" for an active coupon.
String expiryLabel(DateTime? expiresAt, {DateTime? now}) {
  if (expiresAt == null) return 'No expiry';
  final d = daysUntilExpiry(expiresAt, now: now);
  if (d < 0) return 'Expired';
  if (d == 0) return 'Expires today';
  if (d == 1) return 'Expires tomorrow';
  return 'Expires in $d days';
}

/// Lower-case variant used in the checkout offer list ("expires in 3 days").
String expiryLabelShort(DateTime? expiresAt, {DateTime? now}) {
  if (expiresAt == null) return 'No expiry';
  final d = daysUntilExpiry(expiresAt, now: now);
  if (d < 0) return 'expired';
  if (d == 0) return 'expires today';
  if (d == 1) return 'expires tomorrow';
  return 'expires in $d days';
}
