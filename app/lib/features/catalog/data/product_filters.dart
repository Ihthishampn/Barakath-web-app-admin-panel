import 'product.dart';

/// Sort orders offered on the Category Products screen.
enum SortOption { featured, priceLowHigh, priceHighLow, topRated, newest }

extension SortOptionLabel on SortOption {
  String get label => switch (this) {
        SortOption.featured => 'Featured',
        SortOption.priceLowHigh => 'Price: Low to High',
        SortOption.priceHighLow => 'Price: High to Low',
        SortOption.topRated => 'Top rated',
        SortOption.newest => 'Newest',
      };
}

/// Immutable filter selection for a product listing. Prices are in **paise**.
class ProductFilters {
  const ProductFilters({
    this.minPricePaise,
    this.maxPricePaise,
    this.types = const {},
    this.minRating,
  });

  final int? minPricePaise;
  final int? maxPricePaise;

  /// Selected "Type" facet values (from product specifications).
  final Set<String> types;

  /// Minimum rating (e.g. 4.5, 4.0) or null for any.
  final double? minRating;

  static const empty = ProductFilters();

  ProductFilters copyWith({
    int? minPricePaise,
    int? maxPricePaise,
    Set<String>? types,
    double? minRating,
    bool clearRating = false,
  }) {
    return ProductFilters(
      minPricePaise: minPricePaise ?? this.minPricePaise,
      maxPricePaise: maxPricePaise ?? this.maxPricePaise,
      types: types ?? this.types,
      minRating: clearRating ? null : (minRating ?? this.minRating),
    );
  }

  /// Whether the price range has been narrowed from the category's full bounds.
  bool priceNarrowed(int boundsMin, int boundsMax) =>
      (minPricePaise != null && minPricePaise! > boundsMin) ||
      (maxPricePaise != null && maxPricePaise! < boundsMax);

  /// Count of active facet groups → the "Filter · N" badge.
  int activeCount(int boundsMin, int boundsMax) =>
      (priceNarrowed(boundsMin, boundsMax) ? 1 : 0) +
      (types.isNotEmpty ? 1 : 0) +
      (minRating != null ? 1 : 0);
}

/// Client-side catalogue math — keeps Firestore queries single-field and does
/// facet derivation + filtering + sorting in memory (no composite indexes).
extension ProductListing on List<Product> {
  /// Min/max selling price across the list, in paise. (0,0) when empty.
  (int, int) priceBoundsPaise() {
    if (isEmpty) return (0, 0);
    var lo = first.sellingPaise, hi = first.sellingPaise;
    for (final p in this) {
      if (p.sellingPaise < lo) lo = p.sellingPaise;
      if (p.sellingPaise > hi) hi = p.sellingPaise;
    }
    return (lo, hi);
  }

  /// Distinct non-size "Type" values drawn from product specifications
  /// (e.g. "Eau de Parfum", "Attar"). Size-like values ("50ml") are skipped.
  List<String> typeOptions() {
    final set = <String>{};
    for (final p in this) {
      for (final s in p.specifications) {
        final t = s.trim();
        if (t.isEmpty) continue;
        if (RegExp(r'^\d').hasMatch(t)) continue; // "50ml", "12 ml" → size, skip
        set.add(t);
      }
    }
    final list = set.toList()..sort();
    return list.take(12).toList();
  }

  /// Apply sub-category + filters, then sort. Pure; returns a new list.
  List<Product> applyListing({
    String? subCategorySlug,
    ProductFilters filters = ProductFilters.empty,
    SortOption sort = SortOption.featured,
  }) {
    Iterable<Product> out = this;
    if (subCategorySlug != null) {
      out = out.where((p) => p.subCategorySlug == subCategorySlug);
    }
    if (filters.minPricePaise != null) {
      out = out.where((p) => p.sellingPaise >= filters.minPricePaise!);
    }
    if (filters.maxPricePaise != null) {
      out = out.where((p) => p.sellingPaise <= filters.maxPricePaise!);
    }
    if (filters.minRating != null) {
      out = out.where((p) => p.rating >= filters.minRating!);
    }
    if (filters.types.isNotEmpty) {
      out = out.where((p) => p.specifications.any(filters.types.contains));
    }
    final list = out.toList();
    switch (sort) {
      case SortOption.featured:
        break; // keep Firestore/default order
      case SortOption.priceLowHigh:
        list.sort((a, b) => a.sellingPaise.compareTo(b.sellingPaise));
      case SortOption.priceHighLow:
        list.sort((a, b) => b.sellingPaise.compareTo(a.sellingPaise));
      case SortOption.topRated:
        list.sort((a, b) => b.rating.compareTo(a.rating));
      case SortOption.newest:
        list.sort((a, b) => b.publishedAtMillis.compareTo(a.publishedAtMillis));
    }
    return list;
  }
}
