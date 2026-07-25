import 'package:cloud_firestore/cloud_firestore.dart';

/// One selectable variant (e.g. a size) of a product.
class ProductVariant {
  const ProductVariant({
    required this.id,
    required this.label,
    required this.mrpPaise,
    required this.offerPricePaise,
    required this.stock,
  });

  final String id;
  final String label;
  final int mrpPaise;
  final int offerPricePaise;
  final int stock;

  int get sellingPaise => offerPricePaise > 0 ? offerPricePaise : mrpPaise;
  bool get inStock => stock > 0;

  factory ProductVariant.fromMap(Map v, int i) => ProductVariant(
        id: (v['id'] as String?) ?? 'v$i',
        label: (v['label'] as String?) ?? '',
        mrpPaise: (v['mrpPaise'] as num?)?.toInt() ?? 0,
        offerPricePaise: (v['offerPricePaise'] as num?)?.toInt() ?? 0,
        stock: (v['stock'] as num?)?.toInt() ?? 0,
      );
}

/// A key/value spec row (e.g. "Longevity" → "8–10 hours").
typedef SpecRow = ({String key, String value});

/// Storefront product model — reads the shared `products/{id}` doc (paise money,
/// `id`-invariant, same schema as admin/web).
class Product {
  const Product({
    required this.id,
    required this.name,
    required this.categorySlug,
    required this.subCategorySlug,
    required this.imageUrl,
    required this.categoryTint,
    required this.mrpPaise,
    required this.offerPricePaise,
    required this.rating,
    required this.ratingCount,
    required this.specifications,
    required this.isFlashSale,
    required this.publishedAtMillis,
    this.description = '',
    this.images = const [],
    this.variants = const [],
    this.hasVariants = false,
    this.stock = 0,
    this.specDetails = const [],
  });

  final String id;
  final String name;
  final String categorySlug;
  final String subCategorySlug;
  final String? imageUrl;
  final String? categoryTint;
  final int mrpPaise;
  final int offerPricePaise;
  final double rating;
  final int ratingCount;
  final List<String> specifications; // spec values, for the card sub-line
  final bool isFlashSale;
  final int publishedAtMillis;

  // ── Detail-page fields ──
  final String description;
  final List<String> images; // all gallery image urls
  final List<ProductVariant> variants;
  final bool hasVariants;
  final int stock; // used only when hasVariants == false
  final List<SpecRow> specDetails; // key/value spec table

  int get sellingPaise => offerPricePaise > 0 ? offerPricePaise : mrpPaise;
  bool get hasDiscount => offerPricePaise > 0 && offerPricePaise < mrpPaise;
  int get discountPct =>
      hasDiscount ? (((mrpPaise - offerPricePaise) / mrpPaise) * 100).round() : 0;

  /// Whether anything is buyable (any variant in stock, or simple stock > 0).
  bool get inStock => hasVariants ? variants.any((v) => v.inStock) : stock > 0;

  /// "50ml · Eau de Parfum" — first two spec values joined.
  String get subtitle => specifications.take(2).join(' · ');

  factory Product.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    final imagesRaw = (d['images'] as List?) ?? const [];
    final imageUrls = imagesRaw
        .map((f) => f is Map ? f['url'] as String? : f as String?)
        .whereType<String>()
        .where((u) => u.isNotEmpty)
        .toList();
    final specRaw = (d['specifications'] as List?) ?? const [];
    final specValues = specRaw
        .map((s) => s is Map ? (s['value']?.toString() ?? '') : s.toString())
        .where((v) => v.isNotEmpty)
        .toList();
    final specRows = specRaw
        .whereType<Map>()
        .map((s) => (
              key: (s['key']?.toString() ?? '').trim(),
              value: (s['value']?.toString() ?? '').trim(),
            ))
        .where((r) => r.key.isNotEmpty && r.value.isNotEmpty)
        .toList();
    final variants = ((d['variants'] as List?) ?? const [])
        .whereType<Map>()
        .toList()
        .asMap()
        .entries
        .map((e) => ProductVariant.fromMap(e.value, e.key))
        .toList();
    // Fall back to createdAt when publishedAt is null (imported/duplicated
    // products have no publishedAt) — mirrors the web so recent such products
    // still surface in New Arrivals.
    final published = d['publishedAt'] is Timestamp
        ? d['publishedAt']
        : d['createdAt'];
    return Product(
      id: (d['id'] as String?) ?? doc.id,
      name: (d['name'] as String?) ?? '',
      categorySlug:
          (d['categorySlug'] as String?) ?? (d['categoryId'] as String?) ?? '',
      subCategorySlug: (d['subCategorySlug'] as String?) ??
          (d['subCategoryId'] as String?) ??
          '',
      imageUrl: imageUrls.isNotEmpty ? imageUrls.first : null,
      categoryTint: d['categoryTint'] as String?,
      mrpPaise: (d['mrpPaise'] as num?)?.toInt() ?? 0,
      offerPricePaise: (d['offerPricePaise'] as num?)?.toInt() ?? 0,
      rating: (d['rating'] as num?)?.toDouble() ?? 0,
      ratingCount: (d['ratingCount'] as num?)?.toInt() ?? 0,
      specifications: specValues,
      isFlashSale: (d['isFlashSale'] as bool?) ?? false,
      publishedAtMillis:
          published is Timestamp ? published.millisecondsSinceEpoch : 0,
      description: (d['description'] as String?) ?? '',
      images: imageUrls,
      variants: variants,
      hasVariants: (d['hasVariants'] as bool?) ?? variants.isNotEmpty,
      stock: (d['stock'] as num?)?.toInt() ?? 0,
      specDetails: specRows,
    );
  }
}
