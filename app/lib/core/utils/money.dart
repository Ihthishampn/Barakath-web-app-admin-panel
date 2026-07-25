import 'package:intl/intl.dart';

/// INR formatting — spec §0.1. All money is stored in **paise** (integer) in
/// Firestore, matching the admin/web `*Paise` contract.
abstract final class Money {
  static final _rupees2 =
      NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 2);
  static final _rupees0 =
      NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);
  static final _count = NumberFormat('#,##,##0', 'en_IN');

  /// `₹1,240.00` from paise. Prices, wallet, invoice values.
  static String fromPaise(int paise) => _rupees2.format(paise / 100);

  /// `₹1,240` (no decimals) — filter bounds, quick chips.
  static String fromPaiseCompact(int paise) => _rupees0.format(paise / 100);

  /// Signed for ledgers: `+₹500.00` / `−₹24.00`.
  static String signedFromPaise(int paise, {required bool credit}) {
    final v = fromPaise(paise.abs());
    return credit ? '+$v' : '−$v';
  }

  /// Indian-grouped integer count (`1,24,500`).
  static String count(int n) => _count.format(n);
}
