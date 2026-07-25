import 'package:cloud_firestore/cloud_firestore.dart';

class SubCategory {
  const SubCategory(
      {required this.slug, required this.name, required this.visibility});
  final String slug;
  final String name;
  final String visibility; // visible | hidden

  /// The admin's per-sub-category Hide/Show. Missing means visible, so docs
  /// written before the toggle existed keep showing (web: `visibility ===
  /// 'visible'` over a field that defaults to 'visible').
  bool get isVisible => visibility != 'hidden';
}

/// Storefront category — reads shared `categories/{id}`.
class Category {
  const Category({
    required this.id,
    required this.slug,
    required this.name,
    required this.tint,
    required this.productCount,
    required this.order,
    required this.subCategories,
  });

  final String id;
  final String slug;
  final String name;
  final String? tint;
  final int productCount;
  final int order;
  final List<SubCategory> subCategories;

  factory Category.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    final subs = ((d['subCategories'] as List?) ?? const [])
        .whereType<Map>()
        .map((s) => SubCategory(
              slug: (s['slug'] as String?) ?? (s['id'] as String?) ?? '',
              name: (s['name'] as String?) ?? '',
              visibility: (s['visibility'] as String?) ?? 'visible',
            ))
        .toList();
    return Category(
      id: (d['id'] as String?) ?? doc.id,
      slug: (d['slug'] as String?) ?? doc.id,
      name: (d['name'] as String?) ?? '',
      tint: d['categoryTint'] as String?,
      productCount: (d['productCount'] as num?)?.toInt() ?? 0,
      order: (d['order'] as num?)?.toInt() ?? 0,
      subCategories: subs,
    );
  }
}

/// App hero banner — reads shared `banners/{id}` (placement app, publishLive).
class Banner {
  const Banner({
    required this.id,
    required this.imageUrl,
    required this.order,
    required this.publishLive,
    this.linkProductId,
  });
  final String id;
  final String imageUrl;
  final int order;
  final bool publishLive;
  final String? linkProductId;

  factory Banner.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    return Banner(
      id: (d['id'] as String?) ?? doc.id,
      imageUrl: (d['imageUrl'] as String?) ?? '',
      order: (d['order'] as num?)?.toInt() ?? 0,
      publishLive: (d['publishLive'] as bool?) ?? false,
      linkProductId: d['attachedProductId'] as String?,
    );
  }
}
