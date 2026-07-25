import 'package:cloud_firestore/cloud_firestore.dart';

import 'cart_line.dart';

/// Reads/writes the customer's bag (`customers/{uid}.cart`). Writes are a single
/// `update` of the whole array — no transaction round-trip — because the
/// [CartProvider] owns the authoritative in-memory state and applies changes
/// optimistically; the snapshot stream then keeps other devices in sync.
class CartRepository {
  CartRepository({FirebaseFirestore? db})
      : _db = db ?? FirebaseFirestore.instance;

  final FirebaseFirestore _db;

  DocumentReference<Map<String, dynamic>> _doc(String uid) =>
      _db.doc('customers/$uid');

  List<CartLine> _parse(Map<String, dynamic>? data) {
    final raw = (data?['cart'] as List?) ?? const [];
    return raw.whereType<Map>().map(CartLine.fromMap).toList();
  }

  /// Live bag for [uid] (real-time; syncs across the user's devices).
  Stream<List<CartLine>> watch(String uid) =>
      _doc(uid).snapshots().map((s) => _parse(s.data()));

  /// One-shot read — used to reconcile after a failed optimistic write.
  Future<List<CartLine>> getOnce(String uid) async =>
      _parse((await _doc(uid).get()).data());

  /// Replace the whole bag with [lines] in a single write (no read).
  ///
  /// Uses `set(merge:true)` rather than `update()` so the write is create-safe:
  /// if `customers/{uid}` doesn't exist yet (e.g. the first cart edit races the
  /// lazy profile-doc creation) `update()` would throw NOT_FOUND and the
  /// optimistic item would be reverted away. Merge only touches `cart` +
  /// `updatedAt`, so it stays within the fields the security rules allow.
  Future<void> replace(String uid, List<CartLine> lines) => _doc(uid).set({
        'cart': lines.map((l) => l.toMap()).toList(),
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));

  /// Re-price [lines] from the LIVE `products/{id}` documents, or null when
  /// nothing moved.
  ///
  /// A cart line snapshots the price at "Add to bag" and can then sit in the
  /// bag for days — or, after a Reorder, carry a price from an order placed
  /// months ago. `placeOrder` always prices from the product document
  /// (`priceLines`, functions/src/orders/checkout.ts), so without this the bag,
  /// the checkout summary, the free-delivery threshold, every coupon minimum
  /// and the amount on the pay button are all computed from a price the server
  /// will not charge. The web does exactly this (`refreshPrices`,
  /// web/src/lib/cart.ts); the app did not.
  ///
  /// A line whose product (or selected variant) has vanished is left untouched:
  /// that is not a price change, and `placeOrder` reports it properly.
  /// Firestore caps `whereIn` at 30 ids, so the products are read in chunks.
  Future<List<CartLine>?> repriceLines(List<CartLine> lines) async {
    if (lines.isEmpty) return null;
    final ids = lines.map((l) => l.productId).toSet().toList();
    final byId = <String, Map<String, dynamic>>{};
    for (var i = 0; i < ids.length; i += 30) {
      final end = i + 30 > ids.length ? ids.length : i + 30;
      final snap = await _db
          .collection('products')
          .where(FieldPath.documentId, whereIn: ids.sublist(i, end))
          .get();
      for (final d in snap.docs) {
        byId[d.id] = d.data();
      }
    }

    var changed = false;
    final next = <CartLine>[];
    for (final l in lines) {
      final p = byId[l.productId];
      final live = p == null ? null : _livePrice(p, l);
      if (live == null ||
          (live.pricePaise == l.pricePaise && live.mrpPaise == l.mrpPaise)) {
        next.add(l);
        continue;
      }
      changed = true;
      next.add(l.copyWith(
          pricePaise: live.pricePaise, mrpPaise: live.mrpPaise));
    }
    return changed ? next : null;
  }

  /// The price [line] would be charged at right now — the same resolution
  /// `priceLines` performs server-side (variant overrides the product, and an
  /// absent/zero `offerPricePaise` means the MRP is the selling price).
  ({int pricePaise, int mrpPaise})? _livePrice(
      Map<String, dynamic> p, CartLine line) {
    var mrp = (p['mrpPaise'] as num?)?.toInt() ?? line.mrpPaise;
    var offer = (p['offerPricePaise'] as num?)?.toInt() ?? mrp;
    final variantId = line.variantId;
    if (variantId != null && variantId.isNotEmpty) {
      final v = ((p['variants'] as List?) ?? const [])
          .whereType<Map>()
          .where((m) => m['id'] == variantId)
          .firstOrNull;
      // Variant gone — leave the line alone; placeOrder reports it properly.
      if (v == null) return null;
      mrp = (v['mrpPaise'] as num?)?.toInt() ?? mrp;
      offer = (v['offerPricePaise'] as num?)?.toInt() ?? offer;
    }
    final price = offer > 0 ? offer : mrp;
    // A product priced at zero is a malformed document, not a free item.
    if (price <= 0) return null;
    return (pricePaise: price, mrpPaise: mrp < 0 ? 0 : mrp);
  }
}
