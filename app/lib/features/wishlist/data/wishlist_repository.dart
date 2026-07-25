import 'package:cloud_firestore/cloud_firestore.dart';

import '../../catalog/data/product.dart';
import 'wishlist.dart';

/// Reads + writes the customer's wishlist — direct owner-scoped Firestore
/// (no Cloud Function), the SAME `customers/{uid}/wishlist/{productId}` docs the
/// web reads/writes, so the two platforms stay in real-time sync.
class WishlistRepository {
  WishlistRepository({FirebaseFirestore? db})
      : _db = db ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;

  CollectionReference<Map<String, dynamic>> _col(String uid) =>
      _db.collection('customers/$uid/wishlist');

  /// Live wishlist, newest first. Sorted in memory (a just-added item has a
  /// still-pending `addedAt`, so ordering client-side keeps it visible instantly
  /// and avoids dropping it from a server `orderBy` while the timestamp resolves).
  Stream<List<WishlistItem>> watch(String uid) =>
      _col(uid).snapshots().map((s) {
        final list = s.docs.map(WishlistItem.fromDoc).toList();
        list.sort((a, b) => (b.addedAt ?? DateTime.now())
            .compareTo(a.addedAt ?? DateTime.now()));
        return list;
      });

  /// Add (or refresh) a wishlist entry — plain set, matching the web.
  Future<void> add(String uid, Product p) =>
      _col(uid).doc(p.id).set(WishlistItem.writePayload(p));

  Future<void> remove(String uid, String productId) =>
      _col(uid).doc(productId).delete();
}
