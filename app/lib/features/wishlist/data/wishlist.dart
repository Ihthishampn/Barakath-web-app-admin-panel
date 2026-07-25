import 'package:cloud_firestore/cloud_firestore.dart';

import '../../catalog/data/product.dart';

int _int(dynamic v) => (v as num?)?.toInt() ?? 0;
double _dbl(dynamic v) => (v as num?)?.toDouble() ?? 0;
String _str(dynamic v) => (v as String?) ?? '';

/// One wishlist entry (`customers/{uid}/wishlist/{productId}`). A denormalised
/// product snapshot in the shape the web writes (`web/src/lib/wishlist.ts`) plus
/// availability (see below), so the app and web share one wishlist per account.
/// Doc id == productId.
class WishlistItem {
  const WishlistItem({
    required this.productId,
    required this.name,
    required this.imageUrl,
    required this.categoryTint,
    required this.categorySlug,
    required this.subCategorySlug,
    required this.sellingPaise,
    required this.mrpPaise,
    required this.rating,
    required this.ratingCount,
    this.addedAt,
    this.stock = 0,
    this.hasVariants = false,
    this.variants = const [],
  });

  final String productId;
  final String name;
  final String? imageUrl;
  final String categoryTint;
  final String categorySlug;
  final String subCategorySlug;
  final int sellingPaise;
  final int mrpPaise;
  final double rating;
  final int ratingCount;
  final DateTime? addedAt;

  // Availability, so the card can render (and quick-add) the same way it does
  // everywhere else. Entries written before this — and any written by the web,
  // whose snapshot has no stock — keep stock 0 / no variants and still read as
  // out of stock; the web writer needs the same fields to close that gap.
  final int stock;
  final bool hasVariants;
  final List<ProductVariant> variants;

  factory WishlistItem.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    return WishlistItem(
      productId: (d['productId'] as String?) ?? doc.id,
      name: _str(d['name']),
      imageUrl: d['imageUrl'] as String?,
      categoryTint: (d['categoryTint'] as String?) ?? '#efeeea',
      categorySlug: _str(d['categorySlug']),
      subCategorySlug: _str(d['subCategorySlug']),
      sellingPaise: _int(d['sellingPaise']),
      mrpPaise: _int(d['mrpPaise']),
      rating: _dbl(d['rating']),
      ratingCount: _int(d['ratingCount']),
      addedAt: d['addedAt'] is Timestamp
          ? (d['addedAt'] as Timestamp).toDate()
          : null,
      stock: _int(d['stock']),
      hasVariants: (d['hasVariants'] as bool?) ?? false,
      variants: ((d['variants'] as List?) ?? const [])
          .whereType<Map>()
          .toList()
          .asMap()
          .entries
          .map((e) => ProductVariant.fromMap(e.value, e.key))
          .toList(),
    );
  }

  /// The write payload — the web `{ ...snapshotOf(product), addedAt }` shape
  /// (plain set, no merge) so both platforms agree, plus the availability fields
  /// below, which the web reader simply ignores.
  static Map<String, dynamic> writePayload(Product p) => {
        'id': p.id,
        'productId': p.id,
        'name': p.name,
        'imageUrl':
            (p.imageUrl != null && p.imageUrl!.isNotEmpty) ? p.imageUrl : null,
        'categoryTint': (p.categoryTint != null && p.categoryTint!.isNotEmpty)
            ? p.categoryTint
            : '#efeeea',
        'categorySlug': p.categorySlug,
        'subCategorySlug': p.subCategorySlug,
        'sellingPaise': p.sellingPaise,
        'mrpPaise': p.mrpPaise,
        'rating': p.rating,
        'ratingCount': p.ratingCount,
        // Availability rides along (the web's snapshot omits it, and extra
        // fields are ignored there): without it every wishlist card rebuilds
        // with stock 0 and renders as "Out of stock" with a dead quick-add.
        'stock': p.stock,
        'hasVariants': p.hasVariants,
        'variants': p.variants
            .map((v) => {
                  'id': v.id,
                  'label': v.label,
                  'mrpPaise': v.mrpPaise,
                  'offerPricePaise': v.offerPricePaise,
                  'stock': v.stock,
                })
            .toList(),
        'addedAt': FieldValue.serverTimestamp(),
      };

  /// A minimal [Product] rebuilt from the snapshot — enough to render a
  /// ProductCard and quick-add to the bag. Setting offerPrice = sellingPaise
  /// faithfully reproduces the card's price + strike-through discount.
  Product toProduct() => Product(
        id: productId,
        name: name,
        categorySlug: categorySlug,
        subCategorySlug: subCategorySlug,
        imageUrl: imageUrl,
        categoryTint: categoryTint,
        mrpPaise: mrpPaise,
        offerPricePaise: sellingPaise,
        rating: rating,
        ratingCount: ratingCount,
        specifications: const [],
        isFlashSale: false,
        publishedAtMillis: 0,
        stock: stock,
        hasVariants: hasVariants,
        variants: variants,
      );
}
