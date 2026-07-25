import '../utils/money.dart';

/// Hard caps on a bag / order.
///
/// These are the CLIENT mirror of the server's authoritative numbers
/// (`placeOrder`, functions/src/orders/checkout.ts) — the same values, so the
/// app refuses an over-sized bag with an explanation instead of letting the
/// customer build it, walk all the way to the pay bar and have the callable
/// reject the whole order. The 50-line cap is additionally enforced by the
/// Firestore rules on `customers/{uid}.cart`, so exceeding it does not even
/// persist.
abstract final class OrderLimits {
  /// Distinct product+variant lines in the bag.
  static const maxCartLines = 50;

  /// Units of any ONE line.
  static const maxQtyPerLine = 10;

  /// Total units across the whole bag.
  static const maxUnitsPerOrder = 100;

  /// ₹2,00,000 — the largest order total the server will accept.
  static const maxOrderTotalPaise = 20000000;
}

/// Which cap (if any) a bag mutation would break. [CartLimit.none] means the
/// mutation was applied.
enum CartLimit {
  none,
  lines,
  qtyPerLine,
  unitsPerOrder,
  orderTotal;

  bool get blocked => this != CartLimit.none;

  /// Customer-facing reason, shown with the app's existing error toast. Null
  /// for [CartLimit.none] — there is nothing to explain.
  String? get message => switch (this) {
        CartLimit.none => null,
        CartLimit.lines =>
          'Your bag is full — up to ${OrderLimits.maxCartLines} different items.',
        CartLimit.qtyPerLine =>
          'You can add up to ${OrderLimits.maxQtyPerLine} of one item.',
        CartLimit.unitsPerOrder =>
          'An order can have up to ${OrderLimits.maxUnitsPerOrder} items in total.',
        CartLimit.orderTotal =>
          'Orders are limited to ${Money.fromPaiseCompact(OrderLimits.maxOrderTotalPaise)}. '
              'Please remove some items or order separately.',
      };
}
