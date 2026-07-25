import 'package:cloud_firestore/cloud_firestore.dart' hide Order;
import 'package:cloud_functions/cloud_functions.dart';

import 'order.dart';
import 'return_request.dart';

/// Reads the customer's orders (owner-scoped direct Firestore reads) and calls
/// the customer order callables (`cancelOrder`, `requestReturnOrReplacement`) in
/// region asia-south1 — the SAME functions the web uses. Orders/items/timeline
/// and orderRequests are CF-only writes, so the app never mutates them directly.
class OrdersRepository {
  OrdersRepository({FirebaseFirestore? db, FirebaseFunctions? functions})
      : _db = db ?? FirebaseFirestore.instance,
        _fn = functions ??
            FirebaseFunctions.instanceFor(region: 'asia-south1');

  final FirebaseFirestore _db;
  final FirebaseFunctions _fn;

  /// The customer's orders, newest first. Uses the declared composite index
  /// (customerId ASC + createdAt DESC).
  Stream<List<Order>> watchOrders(String uid) => _db
      .collection('orders')
      .where('customerId', isEqualTo: uid)
      .orderBy('createdAt', descending: true)
      .snapshots()
      .map((s) => s.docs.map(Order.fromDoc).toList());

  Stream<Order?> watchOrder(String id) => _db
      .doc('orders/$id')
      .snapshots()
      .map((s) => s.exists ? Order.fromDoc(s) : null);

  /// One-shot order read (for share actions that fire outside a stream).
  Future<Order?> getOrder(String id) async {
    final s = await _db.doc('orders/$id').get();
    return s.exists ? Order.fromDoc(s) : null;
  }

  /// Invoice issuer details for the tax-invoice footer, from `settings/tax`
  /// (the admin's Delivery & Tax tab writes `legalName` + `gstin`). Returns
  /// empty strings when unset so the invoice degrades gracefully.
  Future<({String legalName, String gstin})> fetchIssuer() async {
    try {
      final d = (await _db.doc('settings/tax').get()).data() ?? const {};
      return (
        legalName: (d['legalName'] as String?)?.trim() ?? '',
        gstin: (d['gstin'] as String?)?.trim() ?? '',
      );
    } catch (_) {
      return (legalName: '', gstin: '');
    }
  }

  /// The admin-configured return window in days (`settings/returns.windowDays`,
  /// Settings ▸ Storefront). Falls back to the server's default so an install
  /// with no settings doc — or an unreadable one — behaves like the callable.
  Future<int> fetchReturnWindowDays() async {
    try {
      final d = (await _db.doc('settings/returns').get()).data() ?? const {};
      return (d['windowDays'] as num?)?.toInt() ??
          Order.defaultReturnWindowDays;
    } catch (_) {
      return Order.defaultReturnWindowDays;
    }
  }

  /// Live line items. New orders embed an `items` array on the order document;
  /// older orders keep them in the `orders/{id}/items` subcollection, so we fall
  /// back to that when the embedded array is absent.
  Stream<List<OrderItem>> watchItems(String orderId) => _db
      .doc('orders/$orderId')
      .snapshots()
      .asyncMap((orderSnap) async {
        final embedded = (orderSnap.data()?['items'] as List?) ?? const [];
        if (embedded.isNotEmpty) {
          return embedded.whereType<Map>().map(OrderItem.fromMap).toList();
        }
        final sub = await _db
            .collection('orders/$orderId/items')
            .orderBy('createdAt')
            .get();
        return sub.docs.map(OrderItem.fromDoc).toList();
      });

  Future<List<OrderItem>> getItems(String orderId) async {
    final orderSnap = await _db.doc('orders/$orderId').get();
    final embedded = (orderSnap.data()?['items'] as List?) ?? const [];
    if (embedded.isNotEmpty) {
      return embedded.whereType<Map>().map(OrderItem.fromMap).toList();
    }
    final s = await _db
        .collection('orders/$orderId/items')
        .orderBy('createdAt')
        .get();
    return s.docs.map(OrderItem.fromDoc).toList();
  }

  /// Return requests the customer raised for a given order, newest first. Query
  /// is by `customerId` only (single-field, rules-satisfying, no composite
  /// index) and filtered to the order client-side.
  Stream<List<ReturnRequest>> watchReturnsForOrder(String uid, String orderId) =>
      _db
          .collection('orderRequests')
          .where('customerId', isEqualTo: uid)
          .snapshots()
          .map((s) {
            final list = s.docs
                .map(ReturnRequest.fromDoc)
                .where((r) => r.orderId == orderId)
                .toList()
              ..sort((a, b) => (b.createdAt ?? DateTime(0))
                  .compareTo(a.createdAt ?? DateTime(0)));
            return list;
          });

  Stream<List<OrderTimelineEntry>> watchTimeline(String orderId) => _db
      .collection('orders/$orderId/timeline')
      .orderBy('at')
      .snapshots()
      .map((s) => s.docs.map(OrderTimelineEntry.fromDoc).toList());

  /// Cancel an order (owner, while status ∈ accepted/packing/packed). Restores
  /// stock + refunds to wallet server-side. Throws [FirebaseFunctionsException].
  Future<void> cancelOrder(String orderId) async {
    await _fn.httpsCallable('cancelOrder').call<Map<String, dynamic>>({
      'orderId': orderId,
    });
  }

  /// Request a return for one delivered item. `reasonKey` must be a valid
  /// RETURN_REASONS key. Returns the created request's shortId.
  Future<String> requestReturn({
    required String orderId,
    required String itemId,
    required String reasonKey,
    String? note,
  }) async {
    final res = await _fn
        .httpsCallable('requestReturnOrReplacement')
        .call<Map<String, dynamic>>({
      'orderId': orderId,
      'itemId': itemId,
      'reasonKey': reasonKey,
      'note': note,
    });
    return (res.data['shortId'] as String?) ?? '';
  }
}

/// Return reasons shown on the Request Return screen. Keys map to the shared
/// RETURN_REASONS enum the CF validates ("No longer needed" has no dedicated
/// backend key, so it maps to `other`).
class ReturnReason {
  const ReturnReason(this.key, this.label);
  final String key;
  final String label;
}

const returnReasons = <ReturnReason>[
  ReturnReason('damaged', 'Item damaged / defective'),
  ReturnReason('wrong_item', 'Wrong item delivered'),
  ReturnReason('other', 'No longer needed'),
];
