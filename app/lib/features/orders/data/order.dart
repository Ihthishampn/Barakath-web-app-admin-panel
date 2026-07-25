import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';

/// Order lifecycle — mirrors the shared ORDER_STATUSES enum (pending_payment ·
/// accepted · packing · packed · shipped · out_for_delivery · delivered ·
/// cancelled). `pendingPayment` is an online order placed but not yet paid: it
/// only becomes `accepted` once the payment is confirmed (verifyPayment).
enum OrderStatus {
  pendingPayment,
  accepted,
  packing,
  packed,
  shipped,
  outForDelivery,
  delivered,
  cancelled,
  unknown;

  static OrderStatus parse(String? s) => switch (s) {
        'pending_payment' => pendingPayment,
        'accepted' => accepted,
        'packing' => packing,
        'packed' => packed,
        'shipped' => shipped,
        'out_for_delivery' => outForDelivery,
        'delivered' => delivered,
        'cancelled' => cancelled,
        _ => unknown,
      };

  String get label => switch (this) {
        pendingPayment => 'Payment pending',
        accepted => 'Accepted',
        packing => 'Packing',
        packed => 'Packed',
        shipped => 'Shipped',
        outForDelivery => 'Out for delivery',
        delivered => 'Delivered',
        cancelled => 'Cancelled',
        unknown => 'Processing',
      };

  /// Open = still active (not terminal). A pending-payment order is open (it
  /// shows in the active list with a "Payment pending" chip) but is NOT
  /// trackable or cancellable until the payment lands.
  bool get isOpen => switch (this) {
        pendingPayment ||
        accepted ||
        packing ||
        packed ||
        shipped ||
        outForDelivery =>
          true,
        _ => false,
      };

  /// Awaiting the first payment — nothing to track, no invoice yet, no
  /// customer-side cancel (the server sweeps it if the payment never comes).
  bool get isAwaitingPayment => this == pendingPayment;

  /// Includes [pendingPayment]: the owner can cancel an unpaid online order from
  /// the "Payment pending" screen (releases its held stock + coupon). Stops at
  /// 'packed' — past that the customer goes through returns.
  bool get isCancellable =>
      this == pendingPayment ||
      this == accepted ||
      this == packing ||
      this == packed;
  bool get isReturnable => this == delivered;

  /// Badge palette (bg, fg) — matches the Figma status chips.
  (Color, Color) get badgeColors => switch (this) {
        delivered => (AppColors.brandGreenSubtle, AppColors.brandGreen),
        cancelled => (AppColors.bgMuted, AppColors.textSecondary),
        shipped || outForDelivery => (AppColors.sky100, AppColors.sky700),
        _ => (AppColors.brandAmberLight, AppColors.brandGoldStrong),
      };
}

DateTime? _ts(dynamic v) => v is Timestamp ? v.toDate() : null;
int _int(dynamic v) => (v as num?)?.toInt() ?? 0;
String _str(dynamic v) => (v as String?) ?? '';

/// One of the (max 4) thumbnails on the order card / detail summary.
class OrderItemSummary {
  const OrderItemSummary(
      {required this.productName,
      required this.imageUrl,
      required this.categoryTint,
      required this.quantity});
  final String productName;
  final String imageUrl;
  final String categoryTint;
  final int quantity;

  factory OrderItemSummary.fromMap(Map m) => OrderItemSummary(
        productName: _str(m['productName']),
        imageUrl: _str(m['imageUrl']),
        categoryTint: _str(m['categoryTint']),
        quantity: _int(m['quantity']),
      );
}

/// A saved snapshot of the delivery address on the order.
class OrderAddress {
  const OrderAddress(
      {required this.label,
      required this.name,
      required this.phone,
      required this.line1,
      this.line2,
      required this.city,
      required this.state,
      required this.pincode});
  final String label;
  final String name;
  final String phone;
  final String line1;
  final String? line2;
  final String city;
  final String state;
  final String pincode;

  String get formatted {
    final head = [line1, line2, city]
        .where((s) => s != null && s.isNotEmpty)
        .join(', ');
    final region = [state, pincode].where((s) => s.isNotEmpty).join(' ');
    return [head, region].where((s) => s.isNotEmpty).join(', ');
  }

  static OrderAddress? fromMap(Map? m) => m == null
      ? null
      : OrderAddress(
          label: _str(m['label']),
          name: _str(m['name']),
          phone: _str(m['phone']),
          line1: _str(m['line1']),
          line2: m['line2'] as String?,
          city: _str(m['city']),
          state: _str(m['state']),
          pincode: _str(m['pincode']),
        );
}

/// A customer order (read model). Written CF-only; the app never mutates it.
class Order {
  const Order({
    required this.id,
    required this.shortId,
    required this.status,
    required this.itemsCount,
    required this.itemsSummary,
    required this.subtotalPaise,
    required this.discountPaise,
    required this.spinRewardPaise,
    required this.walletUsedPaise,
    required this.deliveryPaise,
    required this.codSurchargePaise,
    required this.taxPaise,
    required this.totalPaise,
    required this.amountPaidPaise,
    required this.refundedPaise,
    required this.paymentMethod,
    required this.paymentStatus,
    required this.couponCode,
    required this.address,
    required this.riderName,
    required this.expectedDeliveryDate,
    required this.shippedAt,
    required this.outForDeliveryAt,
    required this.deliveredAt,
    required this.cancelledAt,
    required this.cancellationReason,
    required this.invoiceUrl,
    required this.placedAt,
  });

  final String id;
  final String shortId;
  final OrderStatus status;
  final int itemsCount;
  final List<OrderItemSummary> itemsSummary;
  final int subtotalPaise;
  final int discountPaise;
  final int spinRewardPaise;
  final int walletUsedPaise;
  final int deliveryPaise;

  /// The surcharge a cash-on-delivery order was actually charged. COD can no
  /// longer be CHOSEN, but orders placed while it could be still carry this (it
  /// is part of their [totalPaise] / [amountPaidPaise]), so it stays on the
  /// read model — dropping it would misreport what those customers were billed.
  final int codSurchargePaise;
  final int taxPaise;
  final int totalPaise;
  final int amountPaidPaise;
  final int refundedPaise;

  /// razorpay | wallet — and 'cod' on orders placed before it was withdrawn,
  /// which must keep rendering as "Cash on delivery".
  final String paymentMethod;
  final String paymentStatus; // pending | captured | refunded | ...
  final String? couponCode;
  final OrderAddress? address;
  final String? riderName;
  final DateTime? expectedDeliveryDate;
  final DateTime? shippedAt;
  final DateTime? outForDeliveryAt;
  final DateTime? deliveredAt;
  final DateTime? cancelledAt;
  final String? cancellationReason;
  final String? invoiceUrl;
  final DateTime? placedAt;

  /// Combined price reductions (coupon discount + wallet) shown as a single
  /// "Discounts applied" line, matching the Figma order detail / invoice.
  ///
  /// `spinRewardPaise` is deliberately NOT added: placeOrder derives it FROM the
  /// same discount (`spinRewardPaise = discountPaise` when the coupon came from
  /// the wheel — functions/src/orders/checkout.ts), so it labels that money as a
  /// spin reward rather than adding a second reduction. Adding both double-
  /// counted the discount and stopped the invoice reconciling to Total paid.
  int get deductionPaise => discountPaise + walletUsedPaise;

  /// Price reductions excluding wallet spend — wallet is shown as its own
  /// "Wallet amount used" line (it's tender, not a discount), so the discount
  /// line on the order detail must not double-count it.
  int get discountsExWalletPaise => discountPaise;

  /// True when the applied coupon came from Spin & Win — a label hint only; the
  /// reward amount IS [discountPaise].
  bool get isSpinReward => spinRewardPaise > 0;

  /// The amount actually settled — captured amount if present, else order total.
  int get paidPaise => amountPaidPaise > 0 ? amountPaidPaise : totalPaise;

  bool get wasRefunded => refundedPaise > 0 || paymentStatus == 'refunded';

  /// Fallback return window (days) until an admin writes `settings/returns` —
  /// the same default the server applies in `requestReturnOrReplacement` (web:
  /// DEFAULT_RETURN_WINDOW_DAYS).
  static const defaultReturnWindowDays = 7;

  /// Whether a return can still be started: the order is delivered (the admin's
  /// terminal "completed" state) AND we're still inside the return window. The
  /// same window is enforced server-side in `requestReturnOrReplacement`, so
  /// this only governs whether the button shows.
  ///
  /// [windowDays] is admin-configurable (`settings/returns.windowDays`); it used
  /// to be hardcoded to 3 here, so the app hid the Return button on orders the
  /// server would happily accept. `<= 0` disables returns entirely, exactly as
  /// the server does. Measured from delivery, falling back to the placed date
  /// for older orders with no `deliveredAt` — matching the server and the web.
  bool canReturn({int windowDays = defaultReturnWindowDays}) {
    if (status != OrderStatus.delivered || windowDays <= 0) return false;
    final from = deliveredAt ?? placedAt;
    if (from == null) return false;
    return !DateTime.now().isAfter(from.add(Duration(days: windowDays)));
  }

  /// A delayed order: still open (not delivered, not cancelled) and its promised
  /// [expectedDeliveryDate] is already behind us. The stamp is never bumped
  /// after placement, so this is the only signal a shipment has run late.
  ///
  /// Compared at day granularity (midnight-truncated, local time) so an ETA of
  /// "today" is never prematurely flagged — a shipment is late only once its
  /// promised day has fully passed. Mirrors the web's `isDelayed`.
  bool get isDelayed {
    if (!status.isOpen) return false;
    final eta = expectedDeliveryDate;
    if (eta == null) return false;
    final now = DateTime.now();
    final etaDay = DateTime(eta.year, eta.month, eta.day);
    final today = DateTime(now.year, now.month, now.day);
    return etaDay.isBefore(today);
  }

  factory Order.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    return Order(
      id: doc.id,
      shortId: _str(d['shortId']),
      status: OrderStatus.parse(d['status'] as String?),
      itemsCount: _int(d['itemsCount']),
      itemsSummary: ((d['itemsSummary'] as List?) ?? const [])
          .whereType<Map>()
          .map(OrderItemSummary.fromMap)
          .toList(),
      subtotalPaise: _int(d['subtotalPaise']),
      discountPaise: _int(d['discountPaise']),
      spinRewardPaise: _int(d['spinRewardPaise']),
      walletUsedPaise: _int(d['walletUsedPaise']),
      deliveryPaise: _int(d['deliveryPaise']),
      codSurchargePaise: _int(d['codSurchargePaise']),
      taxPaise: _int(d['taxPaise']),
      totalPaise: _int(d['totalPaise']),
      amountPaidPaise: _int(d['amountPaidPaise']),
      refundedPaise: _int(d['refundedPaise']),
      paymentMethod: _str(d['paymentMethod']),
      paymentStatus: _str(d['paymentStatus']),
      couponCode: (d['appliedCoupon'] as Map?)?['code'] as String?,
      address: OrderAddress.fromMap(d['deliveryAddress'] as Map?),
      riderName: (d['rider'] as Map?)?['name'] as String?,
      expectedDeliveryDate: _ts(d['expectedDeliveryDate']),
      shippedAt: _ts(d['shippedAt']),
      outForDeliveryAt: _ts(d['outForDeliveryAt']),
      deliveredAt: _ts(d['deliveredAt']),
      cancelledAt: _ts(d['cancelledAt']),
      cancellationReason: d['cancellationReason'] as String?,
      invoiceUrl: d['invoiceUrl'] as String?,
      placedAt: _ts(d['placedAt']) ?? _ts(d['createdAt']),
    );
  }
}

/// One line item of an order (`orders/{id}/items`).
class OrderItem {
  const OrderItem({
    required this.id,
    required this.productId,
    required this.productName,
    required this.displayTitle,
    required this.imageUrl,
    required this.categoryTint,
    required this.category,
    required this.variantId,
    required this.variantLabel,
    required this.quantity,
    required this.mrpPaise,
    required this.offerPricePaise,
    required this.lineTotalPaise,
    required this.returnStatus,
    required this.returnRequestId,
  });

  final String id;
  final String productId;
  final String productName;
  final String displayTitle;
  final String imageUrl;
  final String categoryTint;
  final String category;
  final String? variantId;
  final String? variantLabel;
  final int quantity;
  final int mrpPaise;
  final int offerPricePaise;
  final int lineTotalPaise;
  final String returnStatus; // none | requested | approved | rejected | completed
  final String? returnRequestId;

  String get title => displayTitle.isNotEmpty ? displayTitle : productName;

  /// A return is in progress / done for this item → not re-eligible.
  bool get hasActiveReturn => const {
        'requested',
        'under_review',
        'approved',
        'completed',
      }.contains(returnStatus);

  /// From a subcollection doc (legacy orders).
  factory OrderItem.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) =>
      OrderItem._fromData(doc.id, doc.data() ?? const {});

  /// From an embedded `items` array element on the order document.
  factory OrderItem.fromMap(Map<dynamic, dynamic> m) =>
      OrderItem._fromData((m['id'] as String?) ?? '', m);

  static OrderItem _fromData(String id, Map<dynamic, dynamic> d) {
    return OrderItem(
      id: id,
      productId: _str(d['productId']),
      productName: _str(d['productName']),
      displayTitle: _str(d['productDisplayTitle']),
      imageUrl: _str(d['imageUrl']),
      categoryTint: _str(d['categoryTint']),
      category: _str(d['category']),
      variantId: d['variantId'] as String?,
      variantLabel: d['variantLabel'] as String?,
      quantity: _int(d['quantity']),
      mrpPaise: _int(d['mrpPaise']),
      offerPricePaise: _int(d['offerPricePaise']),
      lineTotalPaise: _int(d['lineTotalPaise']),
      returnStatus: _str(d['returnStatus']).isEmpty
          ? 'none'
          : _str(d['returnStatus']),
      returnRequestId: d['returnRequestId'] as String?,
    );
  }
}

/// A timeline entry (`orders/{id}/timeline`), ordered by `at` ascending.
class OrderTimelineEntry {
  const OrderTimelineEntry(
      {required this.status,
      required this.at,
      required this.note,
      required this.byName});
  final OrderStatus status;
  final DateTime? at;
  final String? note;
  final String? byName;

  factory OrderTimelineEntry.fromDoc(
      DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    return OrderTimelineEntry(
      status: OrderStatus.parse(d['status'] as String?),
      at: _ts(d['at']),
      note: d['note'] as String?,
      byName: d['byName'] as String?,
    );
  }
}
