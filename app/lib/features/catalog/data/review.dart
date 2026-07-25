import 'package:cloud_firestore/cloud_firestore.dart';

/// A product review. Mirrors the web/admin `reviews` collection shape exactly
/// (packages/shared Review) so app-written reviews flow through the same admin
/// moderation queue and appear on the web. Reads are owner/approved-gated by
/// the security rules.
class Review {
  const Review({
    required this.id,
    required this.productId,
    required this.customerId,
    required this.customerName,
    required this.rating,
    required this.title,
    required this.body,
    required this.photoUrls,
    required this.status,
    required this.createdAt,
  });

  final String id;
  final String productId;
  final String customerId;
  final String customerName;
  final double rating;
  final String? title;
  final String? body;
  final List<String> photoUrls;
  final String status; // pending | approved | rejected
  final DateTime? createdAt;

  bool get isApproved => status == 'approved';
  bool get isRejected => status == 'rejected';

  factory Review.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const <String, dynamic>{};
    return Review(
      id: doc.id,
      productId: (d['productId'] as String?) ?? '',
      customerId: (d['customerId'] as String?) ?? '',
      customerName: (d['customerName'] as String?)?.trim().isNotEmpty == true
          ? (d['customerName'] as String).trim()
          : 'Verified buyer',
      rating: (d['rating'] as num?)?.toDouble() ?? 0,
      title: (d['title'] as String?)?.trim().isNotEmpty == true
          ? (d['title'] as String).trim()
          : null,
      body: (d['body'] as String?)?.trim().isNotEmpty == true
          ? (d['body'] as String).trim()
          : null,
      photoUrls: ((d['photoUrls'] as List?) ?? const [])
          .whereType<String>()
          .toList(),
      status: (d['status'] as String?) ?? 'pending',
      createdAt: (d['createdAt'] as Timestamp?)?.toDate(),
    );
  }
}
