import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../features/catalog/data/product.dart';
import '../services/wishlist_provider.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';
import '../utils/money.dart';
import 'app_toast.dart';

/// Product card — matches the Figma home design (node 46:5383).
/// White card, radius 12, soft shadow; photo with category pill + wishlist
/// heart; name, sub-line, gold price + star rating, green quick-add `+`.
class ProductCard extends StatelessWidget {
  const ProductCard({
    super.key,
    required this.product,
    this.onTap,
  });

  final Product product;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = schemeForCategory(product.categorySlug);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(AppRadii.field),
          border: Border.all(color: AppColors.borderSubtle),
          boxShadow: const [
            BoxShadow(
                color: Color(0x0A1B1C1D), blurRadius: 4, offset: Offset(0, 2)),
            BoxShadow(
                color: Color(0x0A5F4A2E), blurRadius: 2, offset: Offset(0, 1)),
          ],
        ),
        padding: const EdgeInsets.all(11),
        // The card is placed in a fixed-height slot (rail SizedBox / grid tile).
        // The image flexes to fill whatever height is left after the text block,
        // so the card fits ANY height it's given — no overflow on any device.
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: _image(scheme)),
            const SizedBox(height: 9),
            Text(product.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppType.bodyMedium.copyWith(
                    fontWeight: FontWeight.w700,
                    height: 17.5 / 14,
                    color: AppColors.textPrimary)),
            if (product.subtitle.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(product.subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.bodySmall.copyWith(color: AppColors.textSecondary)),
            ],
            const SizedBox(height: 9),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Flexible(
                            child: Text(Money.fromPaise(product.sellingPaise),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: AppType.bodyLarge.copyWith(
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.brandGoldStrong)),
                          ),
                          // The struck-through MRP is intentionally NOT shown on
                          // the card — it stays on the product detail screen. The
                          // card keeps just the selling price for a cleaner tile.
                        ],
                      ),
                      // Rating is always shown — review-derived, 1.0 ★ · (0)
                      // baseline for a product with no reviews yet.
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          const Icon(Icons.star_rounded,
                              size: 11, color: AppColors.brandAmber),
                          const SizedBox(width: 3),
                          Text(product.rating.toStringAsFixed(1),
                              style: AppType.bodySmall.copyWith(
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.textSecondary)),
                          const SizedBox(width: 3),
                          Flexible(
                            child: Text('(${product.ratingCount})',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: AppType.bodySmall.copyWith(
                                    fontSize: 11,
                                    color: AppColors.textTertiary)),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                // No add-to-bag control on the card — adding happens on the
                // product page. The card shows only price + rating.
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _image(CategoryScheme scheme) {
    final tint = _hex(product.categoryTint) ?? scheme.bgTint;
    // Fills the flexible slot the card gives it (see Expanded in build()).
    return SizedBox.expand(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppRadii.control),
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (product.imageUrl != null && product.imageUrl!.isNotEmpty)
              Image.network(
                product.imageUrl!,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => ColoredBox(color: tint),
                loadingBuilder: (context, child, progress) =>
                    progress == null ? child : ColoredBox(color: tint),
              )
            else
              ColoredBox(color: tint),
            // Category tag (top-left)
            Positioned(
              left: 8,
              top: 8,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.9),
                  borderRadius: BorderRadius.circular(AppRadii.pill),
                ),
                child: Text(
                  product.categorySlug.toUpperCase(),
                  style: AppType.labelUppercase.copyWith(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.3,
                    color: scheme.tagText,
                  ),
                ),
              ),
            ),
            // Wishlist heart (top-right) — provider-driven, so it reflects and
            // toggles the shared wishlist everywhere the card appears.
            Positioned(
              right: 7,
              top: 7,
              child: _WishlistButton(product: product),
            ),
            // Sold-out marker (bottom-left) — a dimming scrim plus a compact
            // badge, so the state reads at a glance without hiding the photo.
            if (!product.inStock) ...[
              Positioned.fill(
                child: IgnorePointer(
                  child: ColoredBox(
                      color: Colors.white.withValues(alpha: 0.55)),
                ),
              ),
              Positioned(
                left: 8,
                bottom: 8,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.destructiveRed,
                    borderRadius: BorderRadius.circular(AppRadii.pill),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.remove_shopping_cart_outlined,
                          size: 10, color: Colors.white),
                      const SizedBox(width: 4),
                      Text('Out of stock',
                          style: AppType.labelUppercase.copyWith(
                            fontSize: 9,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.3,
                            color: Colors.white,
                          )),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  static Color? _hex(String? s) {
    if (s == null) return null;
    var h = s.replaceAll('#', '').trim();
    if (h.length == 6) h = 'FF$h';
    final v = int.tryParse(h, radix: 16);
    return v == null ? null : Color(v);
  }
}

/// Wishlist heart — reads membership from [WishlistProvider] and toggles it on
/// tap. `context.select` scopes rebuilds so only this heart repaints when THIS
/// product's wishlist membership changes.
class _WishlistButton extends StatelessWidget {
  const _WishlistButton({required this.product});
  final Product product;

  @override
  Widget build(BuildContext context) {
    final wished =
        context.select<WishlistProvider, bool>((w) => w.contains(product.id));
    return GestureDetector(
      onTap: () {
        final w = context.read<WishlistProvider>();
        final nowWished = !w.contains(product.id);
        w.toggle(product);
        AppToast.show(
          context,
          nowWished ? 'Added to wishlist' : 'Removed from wishlist',
          variant:
              nowWished ? AppToastVariant.success : AppToastVariant.neutral,
        );
      },
      child: Container(
        width: 30,
        height: 30,
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.9),
          shape: BoxShape.circle,
        ),
        child: Icon(
          wished ? Icons.favorite_rounded : Icons.favorite_border_rounded,
          size: 16,
          color: wished ? AppColors.destructiveRed : AppColors.textPrimary,
        ),
      ),
    );
  }
}

