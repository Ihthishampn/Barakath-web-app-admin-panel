import 'package:cloud_firestore/cloud_firestore.dart';

/// A customer's view of an `orderRequests` doc (a return). Read-only — the
/// customer creates it via the requestReturnOrReplacement CF and the admin
/// moderates it; this model powers the return status + timeline on the order
/// detail screen. Owner-readable per the security rules.
class ReturnRequest {
  const ReturnRequest({
    required this.id,
    required this.shortId,
    required this.orderId,
    required this.status,
    required this.reasonLabel,
    required this.note,
    required this.productName,
    required this.refundMethod,
    required this.refundAmountPaise,
    required this.rejectionReason,
    required this.refundedAt,
    required this.timeline,
    required this.createdAt,
  });

  final String id;
  final String shortId;
  final String orderId;
  final String status; // pending | under_review | approved | completed | rejected | cancelled
  final String reasonLabel;
  final String? note;
  final String productName;
  final String refundMethod; // wallet | gateway
  final int refundAmountPaise;
  final String? rejectionReason;
  final DateTime? refundedAt;
  final List<ReturnEvent> timeline;
  final DateTime? createdAt;

  bool get isApproved => status == 'approved' || status == 'completed';
  bool get isRejected => status == 'rejected' || status == 'cancelled';
  bool get isPending => !isApproved && !isRejected;

  /// True only when the money has actually moved into the wallet. Approval on
  /// its own is not enough: with the admin's "Auto-refund to wallet" off the
  /// server approves the return but records `refundMethod: 'gateway'` and
  /// leaves `refundedAt` null (functions/src/returns/decisions.ts) — the refund
  /// is owed and paid out by hand, so it must not be reported as credited.
  bool get isRefundedToWallet => refundedAt != null && refundMethod == 'wallet';

  factory ReturnRequest.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const <String, dynamic>{};
    final snap = (d['itemSnapshot'] as Map?) ?? const {};
    final history = ((d['statusHistory'] as List?) ?? const [])
        .whereType<Map>()
        .map(ReturnEvent.fromMap)
        .toList()
      ..sort((a, b) =>
          (a.at ?? DateTime(0)).compareTo(b.at ?? DateTime(0)));
    return ReturnRequest(
      id: doc.id,
      shortId: (d['shortId'] as String?) ?? '',
      orderId: (d['orderId'] as String?) ?? '',
      status: (d['status'] as String?) ?? 'pending',
      reasonLabel: (d['reasonLabel'] as String?) ?? 'Return',
      note: (d['note'] as String?)?.trim().isNotEmpty == true
          ? (d['note'] as String).trim()
          : null,
      productName: (snap['productName'] as String?) ?? 'Item',
      refundMethod: (d['refundMethod'] as String?) ?? 'wallet',
      refundAmountPaise: (d['refundAmountPaise'] as num?)?.toInt() ?? 0,
      rejectionReason: (d['rejectionReason'] as String?)?.trim().isNotEmpty == true
          ? (d['rejectionReason'] as String).trim()
          : null,
      refundedAt: (d['refundedAt'] as Timestamp?)?.toDate(),
      timeline: history,
      createdAt: (d['createdAt'] as Timestamp?)?.toDate(),
    );
  }
}

class ReturnEvent {
  const ReturnEvent({required this.status, required this.at, required this.note});
  final String status;
  final DateTime? at;
  final String? note;

  factory ReturnEvent.fromMap(Map<dynamic, dynamic> m) => ReturnEvent(
        status: (m['status'] as String?) ?? '',
        at: m['at'] is Timestamp
            ? (m['at'] as Timestamp).toDate()
            : (m['at'] is DateTime ? m['at'] as DateTime : null),
        note: (m['note'] as String?)?.trim().isNotEmpty == true
            ? (m['note'] as String).trim()
            : null,
      );
}
