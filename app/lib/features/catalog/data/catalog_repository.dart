import 'package:cloud_firestore/cloud_firestore.dart';

import 'category.dart';
import 'product.dart';

/// Direct Firestore reads for the storefront catalogue (spec §16.5). All queries
/// are single-field `where` + in-memory sort/filter — no composite index needed.
class CatalogRepository {
  CatalogRepository({FirebaseFirestore? db})
      : _db = db ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;

  /// New arrivals window (mirrors web/admin — automatic, date-based).
  static const newArrivalDays = 3;

  /// Published, visible products, real-time. NOTE: unordered (an ordered query
  /// on a different field than the `status` filter would need a composite index
  /// not declared for the app), so the home rails (flash sale / new arrivals)
  /// are derived in memory from this sample — the `max` is generous so a
  /// qualifying product is very unlikely to fall outside the page.
  Stream<List<Product>> products({int max = 120}) {
    return _db
        .collection('products')
        .where('status', isEqualTo: 'published')
        .limit(max)
        .snapshots()
        .map((snap) => snap.docs
            .where((d) => d.data()['visibility'] != 'hidden')
            .map(Product.fromDoc)
            .toList());
  }

  /// One page of published products for the "See all" grid.
  ///
  /// Ordered by document id so the cursor is stable across pages. An equality
  /// filter plus `__name__` ordering is served by the automatic single-field
  /// index, so this still needs no composite index. `visibility` is filtered
  /// in memory (Firestore can't combine it without an index), which means a
  /// page can yield fewer than [pageSize] visible products — [ProductPage.hasMore]
  /// therefore reports on the raw document count, not the filtered one.
  Future<ProductPage> productsPage({
    DocumentSnapshot<Map<String, dynamic>>? startAfter,
    int pageSize = 30,
  }) async {
    Query<Map<String, dynamic>> q = _db
        .collection('products')
        .where('status', isEqualTo: 'published')
        .orderBy(FieldPath.documentId)
        .limit(pageSize);
    if (startAfter != null) q = q.startAfterDocument(startAfter);
    final snap = await q.get();
    return ProductPage(
      products: snap.docs
          .where((d) => d.data()['visibility'] != 'hidden')
          .map(Product.fromDoc)
          .toList(),
      lastDoc: snap.docs.isEmpty ? null : snap.docs.last,
      hasMore: snap.docs.length == pageSize,
    );
  }

  /// Live published-product counts per category slug. The stored
  /// `category.productCount` is never maintained by any Cloud Function (it's
  /// always 0), so — like the web — the app derives counts client-side.
  Stream<Map<String, int>> categoryCounts() {
    return _db
        .collection('products')
        .where('status', isEqualTo: 'published')
        .snapshots()
        .map((snap) {
      final counts = <String, int>{};
      for (final d in snap.docs) {
        final data = d.data();
        if (data['visibility'] == 'hidden') continue;
        final slug = (data['categorySlug'] as String?) ??
            (data['categoryId'] as String?);
        if (slug == null || slug.isEmpty) continue;
        counts[slug] = (counts[slug] ?? 0) + 1;
      }
      return counts;
    });
  }

  /// Visible categories, ordered.
  Stream<List<Category>> categories() {
    return _db.collection('categories').snapshots().map((snap) {
      final list = snap.docs
          .where((d) => d.data()['visibility'] != 'hidden')
          .map(Category.fromDoc)
          .toList()
        ..sort((a, b) => a.order.compareTo(b.order));
      return list;
    });
  }

  /// Live app hero banners (placement app, publishLive), ordered.
  Stream<List<Banner>> banners() {
    return _db
        .collection('banners')
        .where('placement', isEqualTo: 'app')
        .snapshots()
        .map((snap) {
      final list = snap.docs
          .map(Banner.fromDoc)
          .where((b) => b.publishLive && b.imageUrl.isNotEmpty)
          .toList()
        ..sort((a, b) => a.order.compareTo(b.order));
      return list;
    });
  }

  /// Live single product by id — powers the Product Details screen (and
  /// deep-links, where no product was passed in via navigation `extra`).
  Stream<Product?> productById(String id) {
    return _db.collection('products').doc(id).snapshots().map(
        (snap) => snap.exists ? Product.fromDoc(snap) : null);
  }

  /// Products in one category (optionally a sub-category), published + visible.
  ///
  /// `status` is filtered server-side (two equality clauses need no composite
  /// index) so unpublished drafts don't consume the `limit` and push published
  /// products out of the page.
  Stream<List<Product>> productsInCategory(String categorySlug,
      {String? subCategorySlug, int max = 120}) {
    return _db
        .collection('products')
        .where('categorySlug', isEqualTo: categorySlug)
        .where('status', isEqualTo: 'published')
        .limit(max)
        .snapshots()
        .map((snap) => snap.docs
            .where((d) {
              final data = d.data();
              if (data['visibility'] == 'hidden') return false;
              if (subCategorySlug != null &&
                  data['subCategorySlug'] != subCategorySlug &&
                  data['subCategoryId'] != subCategorySlug) {
                return false;
              }
              return true;
            })
            .map(Product.fromDoc)
            .toList());
  }

  /// Firestore-native search: tokenized `searchIndex array-contains-any`.
  Stream<List<Product>> search(String query) {
    final tokens = query
        .toLowerCase()
        .split(RegExp(r'\s+'))
        .where((t) => t.isNotEmpty)
        .take(10)
        .toList();
    if (tokens.isEmpty) return Stream.value(const []);
    return _db
        .collection('products')
        .where('searchIndex', arrayContainsAny: tokens)
        .limit(25)
        .snapshots()
        .map((snap) => snap.docs
            .where((d) => d.data()['status'] == 'published' &&
                d.data()['visibility'] != 'hidden')
            .map(Product.fromDoc)
            .toList());
  }
}

/// One page of a cursor-paginated product query. [lastDoc] is the cursor to
/// hand back as `startAfter` for the next page; [hasMore] is false once the
/// collection is exhausted.
class ProductPage {
  const ProductPage({
    required this.products,
    required this.lastDoc,
    required this.hasMore,
  });

  final List<Product> products;
  final DocumentSnapshot<Map<String, dynamic>>? lastDoc;
  final bool hasMore;
}

/// Client-side derivations shared by Home + listings.
extension ProductRails on List<Product> {
  /// Flash-sale rail — opt-in per product (matches web).
  List<Product> get flashSale => where((p) => p.isFlashSale).toList();

  /// New arrivals — published within the window, newest first, EXCLUDING any
  /// product currently on flash sale. The two rails are mutually exclusive: a
  /// product an admin flags for Flash Sale shows there, never also here, even
  /// while it is brand new. Mirrors web's `isNewArrival`.
  List<Product> newArrivals(int nowMillis) {
    final cutoff = nowMillis - CatalogRepository.newArrivalDays * 86400000;
    return where((p) => !p.isFlashSale && p.publishedAtMillis >= cutoff).toList()
      ..sort((a, b) => b.publishedAtMillis.compareTo(a.publishedAtMillis));
  }
}
