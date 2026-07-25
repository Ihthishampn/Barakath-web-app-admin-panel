import 'package:cloud_firestore/cloud_firestore.dart';

import 'review.dart';

/// Reads/writes the shared `reviews` collection — the SAME collection the web
/// writes and the admin moderates. A new review is created `pending`; the admin
/// moderation queue approves/rejects it (and maintains the product's rating
/// aggregate). Writes match the web `ReviewForm` and the security-rules create
/// contract exactly (customerId == uid, status 'pending', rating 1..5,
/// moderatedBy null, helpfulCount 0) — plus the eligibility check: the rules
/// only accept a create when `customers/{uid}/purchases/{productId}` exists,
/// which the server writes when the order is marked delivered. That is why the
/// app offers "Write a review" from a delivered order, never from the product.
class ReviewsRepository {
  ReviewsRepository({FirebaseFirestore? db})
      : _db = db ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;

  /// Public approved reviews for a product, newest first. Two equality filters
  /// need no composite index; ordering is done client-side to avoid one.
  Stream<List<Review>> watchApproved(String productId) => _db
      .collection('reviews')
      .where('productId', isEqualTo: productId)
      .where('status', isEqualTo: 'approved')
      .snapshots()
      .map((s) => _sorted(s.docs.map(Review.fromDoc)));

  /// One page of approved reviews for [productId], newest first, walked by a
  /// `createdAt` cursor. Unlike [watchApproved] (which streams the whole set),
  /// the reviews screen loads a page at a time as the user scrolls, so a product
  /// with thousands of reviews never fetches them all at once. Ordering by
  /// `createdAt` needs the composite reviews index (productId, status,
  /// createdAt) declared in firebase/firestore.indexes.json.
  Future<ReviewPage> approvedPage(
    String productId, {
    DocumentSnapshot<Map<String, dynamic>>? startAfter,
    int pageSize = 10,
  }) async {
    Query<Map<String, dynamic>> q = _db
        .collection('reviews')
        .where('productId', isEqualTo: productId)
        .where('status', isEqualTo: 'approved')
        .orderBy('createdAt', descending: true)
        .limit(pageSize);
    if (startAfter != null) q = q.startAfterDocument(startAfter);
    final snap = await q.get();
    return ReviewPage(
      reviews: snap.docs.map(Review.fromDoc).toList(),
      lastDoc: snap.docs.isEmpty ? null : snap.docs.last,
      hasMore: snap.docs.length == pageSize,
    );
  }

  /// The signed-in customer's OWN reviews for a product, ANY status — so a
  /// freshly submitted (pending) review is visible to its author immediately.
  Stream<List<Review>> watchMine(String productId, String uid) => _db
      .collection('reviews')
      .where('productId', isEqualTo: productId)
      .where('customerId', isEqualTo: uid)
      .snapshots()
      .map((s) => _sorted(s.docs.map(Review.fromDoc)));

  /// EVERY review the signed-in customer has written, any status. The order
  /// detail screen needs, per line item, "have I already reviewed this?" — one
  /// customer-scoped query answers it for the whole order instead of one query
  /// per item. Own-review reads are allowed by the rules (isOwner).
  Stream<List<Review>> watchAllMine(String uid) => _db
      .collection('reviews')
      .where('customerId', isEqualTo: uid)
      .snapshots()
      .map((s) => _sorted(s.docs.map(Review.fromDoc)));

  List<Review> _sorted(Iterable<Review> reviews) {
    final list = reviews.toList()
      ..sort((a, b) => (b.createdAt ?? DateTime(0))
          .compareTo(a.createdAt ?? DateTime(0)));
    return list;
  }

  /// Submit a new review for [productId], bought on [orderId]. Reads the
  /// customer's display name for attribution (matches the web). Throws on
  /// failure — including the rules' permission-denied when the customer has no
  /// `customers/{uid}/purchases/{productId}` delivery record.
  Future<void> submit({
    required String productId,
    required String orderId,
    required String uid,
    required int rating,
    String? title,
    required String body,
  }) async {
    String customerName = 'Barakath customer';
    try {
      final cust = await _db.doc('customers/$uid').get();
      final n = (cust.data()?['name'] as String?)?.trim();
      if (n != null && n.isNotEmpty) customerName = n;
    } catch (_) {
      // Fall back to the default attribution.
    }

    // Deterministic id — one review per customer per product. Purchase proof is
    // an exists() check on a doc that is never consumed, so with auto-ids a
    // single purchase let the same customer post unlimited reviews for one
    // product, each moving the rating aggregate on approval. Mirrors the web
    // (`web/src/components/reviews/ReviewForm.tsx`) and the rules.
    final ref = _db.collection('reviews').doc('${uid}_$productId');
    await ref.set({
      'id': ref.id,
      'productId': productId,
      'customerId': uid,
      'customerName': customerName,
      // Reviews are written from a delivered order, so the source order is
      // always known — the web writes the same field for its own review form.
      'orderId': orderId,
      'rating': rating,
      'title': (title?.trim().isNotEmpty ?? false) ? title!.trim() : null,
      'body': body.trim(),
      'photoUrls': <String>[],
      'status': 'pending',
      'moderatedBy': null,
      'moderatedAt': null,
      'helpfulCount': 0,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }
}

/// One cursor-paged slice of approved reviews. Mirrors ProductPage.
class ReviewPage {
  const ReviewPage({
    required this.reviews,
    required this.lastDoc,
    required this.hasMore,
  });
  final List<Review> reviews;
  final DocumentSnapshot<Map<String, dynamic>>? lastDoc;
  final bool hasMore;
}
