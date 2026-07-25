import '../../catalog/data/product.dart';

/// One line in the customer's bag. Shape mirrors the web (`CartLine` in
/// web/src/lib/cart.ts) so the two clients agree on the same `customers/{uid}.cart`
/// array documents.
class CartLine {
  const CartLine({
    required this.productId,
    required this.variantId,
    required this.name,
    required this.variantLabel,
    required this.imageUrl,
    required this.categoryTint,
    required this.pricePaise,
    required this.mrpPaise,
    required this.qty,
  });

  final String productId;
  final String? variantId;
  final String name;
  final String? variantLabel;
  final String? imageUrl;
  final String categoryTint;
  final int pricePaise;
  final int mrpPaise;
  final int qty;

  /// Identity of a line = product + variant (two sizes are two lines).
  String get key => '$productId|${variantId ?? ''}';
  int get linePaise => pricePaise * qty;

  CartLine copyWith({int? qty, int? pricePaise, int? mrpPaise}) => CartLine(
        productId: productId,
        variantId: variantId,
        name: name,
        variantLabel: variantLabel,
        imageUrl: imageUrl,
        categoryTint: categoryTint,
        pricePaise: pricePaise ?? this.pricePaise,
        mrpPaise: mrpPaise ?? this.mrpPaise,
        qty: qty ?? this.qty,
      );

  Map<String, dynamic> toMap() => {
        'productId': productId,
        'variantId': variantId,
        'name': name,
        'variantLabel': variantLabel,
        'imageUrl': imageUrl,
        'categoryTint': categoryTint,
        'pricePaise': pricePaise,
        'mrpPaise': mrpPaise,
        'qty': qty,
      };

  factory CartLine.fromMap(Map<dynamic, dynamic> m) => CartLine(
        productId: (m['productId'] as String?) ?? '',
        variantId: m['variantId'] as String?,
        name: (m['name'] as String?) ?? '',
        variantLabel: m['variantLabel'] as String?,
        imageUrl: m['imageUrl'] as String?,
        categoryTint: (m['categoryTint'] as String?) ?? '',
        pricePaise: (m['pricePaise'] as num?)?.toInt() ?? 0,
        mrpPaise: (m['mrpPaise'] as num?)?.toInt() ?? 0,
        qty: (m['qty'] as num?)?.toInt() ?? 1,
      );

  /// Build a line from a product (+ optional selected variant).
  factory CartLine.fromProduct(Product p, {ProductVariant? variant, int qty = 1}) =>
      CartLine(
        productId: p.id,
        variantId: variant?.id,
        name: p.name,
        variantLabel: variant?.label,
        imageUrl: p.imageUrl,
        categoryTint: p.categoryTint ?? '',
        pricePaise: variant?.sellingPaise ?? p.sellingPaise,
        mrpPaise: variant?.mrpPaise ?? p.mrpPaise,
        qty: qty,
      );
}
