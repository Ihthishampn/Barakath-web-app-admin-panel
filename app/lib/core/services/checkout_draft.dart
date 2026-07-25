import 'package:flutter/foundation.dart';

import '../../features/checkout/data/checkout_repository.dart';

/// Transient checkout selections carried across Bag → Coupon → Checkout →
/// Payment → Confirmation. Reset once an order is placed.
class CheckoutDraft extends ChangeNotifier {
  String? addressId;
  bool useWallet = false;
  AppliedCoupon? coupon;

  void setAddress(String? id) {
    if (addressId == id) return;
    addressId = id;
    notifyListeners();
  }

  void setUseWallet(bool value) {
    if (useWallet == value) return;
    useWallet = value;
    notifyListeners();
  }

  void setCoupon(AppliedCoupon? c) {
    coupon = c;
    notifyListeners();
  }

  void reset() {
    addressId = null;
    useWallet = false;
    coupon = null;
    notifyListeners();
  }
}
