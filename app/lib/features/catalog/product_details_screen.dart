import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/constants/strings.dart';
import '../../core/router/app_router.dart';
import '../../core/services/cart_provider.dart';
import '../../core/services/wishlist_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_chip.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_state_views.dart';
import '../../core/widgets/app_toast.dart';
import '../../core/widgets/product_card.dart';
import 'data/catalog_repository.dart';
import 'data/product.dart';

/// Screen — Product Details (Figma node 46:6173). Reached by tapping any product
/// card. Renders live product data with an image gallery, variant (size) picker,
/// specs, rating summary, related products, and a sticky Add-to-bag bar.
///
/// Reviews are read-only from here — writing one is offered on a delivered
/// order (order detail), which is the only case the rules accept.
class ProductDetailsScreen extends StatefulWidget {
  const ProductDetailsScreen({super.key, required this.productId, this.product});

  final String productId;

  /// Passed via `extra` for an instant first paint; the screen still subscribes
  /// to the live doc so price/stock stay current (and to resolve deep-links).
  final Product? product;

  @override
  State<ProductDetailsScreen> createState() => _ProductDetailsScreenState();
}

class _ProductDetailsScreenState extends State<ProductDetailsScreen> {
  final _repo = CatalogRepository();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: StreamBuilder<Product?>(
          stream: _repo.productById(widget.productId),
          initialData: widget.product,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting &&
                widget.product == null) {
              return const Center(child: CircularProgressIndicator());
            }
            final product = snap.data;
            if (product == null) {
              return Column(
                children: [
                  _MiniTopBar(onBack: () => context.pop()),
                  const Expanded(
                    child: AppEmptyState(
                      icon: Icons.inventory_2_outlined,
                      title: 'Product unavailable',
                      subtitle: 'This product may have been removed.',
                    ),
                  ),
                ],
              );
            }
            return _Content(product: product, repo: _repo);
          },
        ),
      ),
    );
  }
}

class _MiniTopBar extends StatelessWidget {
  const _MiniTopBar({required this.onBack});
  final VoidCallback onBack;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x8),
      child: AppCircleIconButton(
        icon: Icons.arrow_back_rounded,
        iconColor: AppColors.textPrimary,
        onTap: onBack,
      ),
    );
  }
}

class _Content extends StatefulWidget {
  const _Content({required this.product, required this.repo});
  final Product product;
  final CatalogRepository repo;
  @override
  State<_Content> createState() => _ContentState();
}

class _ContentState extends State<_Content> {
  final _gallery = PageController();
  final _scroll = ScrollController();
  int _imageIndex = 0;
  late int _variantIndex = _firstInStockVariant();

  @override
  void initState() {
    super.initState();
    // Always open at the top. A product opened from "You may also like" at the
    // bottom of another product page would otherwise inherit that page's scroll
    // offset — Flutter's PageStorage restores it onto this same-typed route — and
    // land the customer near the bottom. Reset once, after the first layout.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(0);
    });
  }

  /// Default the size selection to the first in-stock variant so the Add button
  /// isn't disabled on first paint when variant[0] happens to be out of stock.
  int _firstInStockVariant() {
    if (!(widget.product.hasVariants && widget.product.variants.isNotEmpty)) {
      return 0;
    }
    final i = widget.product.variants.indexWhere((v) => v.inStock);
    return i >= 0 ? i : 0;
  }

  Product get p => widget.product;
  bool get _hasVariants => p.hasVariants && p.variants.isNotEmpty;
  ProductVariant? get _variant =>
      _hasVariants ? p.variants[_variantIndex.clamp(0, p.variants.length - 1)] : null;

  int get _sellingPaise => _variant?.sellingPaise ?? p.sellingPaise;
  int get _mrpPaise => _variant?.mrpPaise ?? p.mrpPaise;
  bool get _hasDiscount => _mrpPaise > _sellingPaise && _sellingPaise > 0;
  int get _discountPct =>
      _hasDiscount ? (((_mrpPaise - _sellingPaise) / _mrpPaise) * 100).round() : 0;
  bool get _inStock => _variant != null ? _variant!.inStock : p.inStock;

  @override
  void dispose() {
    _gallery.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = schemeForCategory(p.categorySlug);
    return Column(
      children: [
        _topBar(context, p),
        Expanded(
          child: ListView(
            controller: _scroll,
            padding: EdgeInsets.zero,
            children: [
              _galleryView(scheme),
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                    AppSpacing.x16, AppSpacing.x20, AppSpacing.x24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _tagAndRating(scheme),
                    const SizedBox(height: AppSpacing.x10),
                    Text(p.name,
                        style: AppType.headingLarge.copyWith(
                            fontSize: 22,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.44,
                            height: 1.2)),
                    const SizedBox(height: AppSpacing.x10),
                    _priceRow(),
                    const SizedBox(height: AppSpacing.x10),
                    _stockRow(),
                    const SizedBox(height: AppSpacing.x16),
                    _referralBanner(),
                    if (_hasVariants) ...[
                      const SizedBox(height: AppSpacing.x24),
                      _sizeSection(),
                    ],
                    if (p.description.isNotEmpty) ...[
                      const SizedBox(height: AppSpacing.x24),
                      _section('Description'),
                      const SizedBox(height: AppSpacing.x8),
                      Text(p.description,
                          style: AppType.bodyMedium.copyWith(
                              fontSize: 14,
                              height: 1.55,
                              color: AppColors.textSecondary)),
                    ],
                    if (p.specDetails.isNotEmpty) ...[
                      const SizedBox(height: AppSpacing.x24),
                      _section('Specifications'),
                      const SizedBox(height: AppSpacing.x8),
                      _specTable(),
                    ],
                    // Always shown — review-derived, 1.0 ★ · 0 ratings baseline.
                    const SizedBox(height: AppSpacing.x24),
                    _reviewsSummary(context),
                    const SizedBox(height: AppSpacing.x24),
                    _relatedSection(context),
                  ],
                ),
              ),
            ],
          ),
        ),
        _bottomBar(context, p),
      ],
    );
  }

  Future<void> _shareProduct(Product product) async {
    final pricePaise =
        product.offerPricePaise > 0 ? product.offerPricePaise : product.mrpPaise;
    final price = Money.fromPaise(pricePaise);
    await Share.share(
      '${product.name} — $price on Barakath\n'
      '${Strings.productLink(product.id)}',
      subject: product.name,
    );
  }

  // ── Top bar ────────────────────────────────────────────────────────
  Widget _topBar(BuildContext context, Product product) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x8),
      child: Row(
        children: [
          AppCircleIconButton(
            icon: Icons.arrow_back_rounded,
            iconColor: AppColors.textPrimary,
            onTap: () => context.pop(),
          ),
          const Spacer(),
          AppCircleIconButton(
            icon: Icons.ios_share_rounded,
            iconColor: AppColors.textPrimary,
            onTap: () => _shareProduct(product),
          ),
          const SizedBox(width: AppSpacing.x10),
          Consumer<WishlistProvider>(
            builder: (context, wl, _) {
              final wished = wl.contains(product.id);
              return AppCircleIconButton(
                icon: wished
                    ? Icons.favorite_rounded
                    : Icons.favorite_border_rounded,
                iconColor: AppColors.destructiveRed,
                onTap: () {
                  final nowWished = !wished;
                  wl.toggle(product);
                  AppToast.show(
                      context,
                      nowWished
                          ? 'Added to wishlist'
                          : 'Removed from wishlist',
                      variant: nowWished
                          ? AppToastVariant.success
                          : AppToastVariant.neutral);
                },
              );
            },
          ),
        ],
      ),
    );
  }

  // ── Gallery ────────────────────────────────────────────────────────
  Widget _galleryView(CategoryScheme scheme) {
    final tint = _hex(p.categoryTint) ?? scheme.bgTint;
    final imgs = p.images.isNotEmpty ? p.images : <String>[];
    return Column(
      children: [
        AspectRatio(
          aspectRatio: 1.05,
          child: imgs.isEmpty
              ? ColoredBox(color: tint)
              : PageView.builder(
                  controller: _gallery,
                  itemCount: imgs.length,
                  onPageChanged: (i) => setState(() => _imageIndex = i),
                  itemBuilder: (context, i) => Image.network(
                    imgs[i],
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => ColoredBox(color: tint),
                    loadingBuilder: (context, child, progress) =>
                        progress == null ? child : ColoredBox(color: tint),
                  ),
                ),
        ),
        if (imgs.length > 1) ...[
          const SizedBox(height: AppSpacing.x12),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var i = 0; i < imgs.length; i++) ...[
                if (i > 0) const SizedBox(width: 4),
                AnimatedContainer(
                  duration: const Duration(milliseconds: 250),
                  width: i == _imageIndex ? 22 : 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: i == _imageIndex
                        ? AppColors.brandGreen
                        : AppColors.borderSubtle,
                    borderRadius: BorderRadius.circular(AppRadii.pill),
                  ),
                ),
              ],
            ],
          ),
        ],
      ],
    );
  }

  // ── Tag + rating ───────────────────────────────────────────────────
  Widget _tagAndRating(CategoryScheme scheme) {
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: AppColors.brandGreenSubtle,
            borderRadius: BorderRadius.circular(AppRadii.pill),
          ),
          child: Text(p.categorySlug.toUpperCase(),
              style: AppType.labelUppercase.copyWith(
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.3,
                  color: scheme.tagText)),
        ),
        // Rating is always shown — review-derived, 1.0 ★ · 0 reviews baseline.
        const SizedBox(width: AppSpacing.x10),
        const Icon(Icons.star_rounded, size: 15, color: AppColors.brandAmber),
        const SizedBox(width: 3),
        Text(p.rating.toStringAsFixed(1),
            style: AppType.bodyMedium.copyWith(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary)),
        const SizedBox(width: 3),
        Text('(${Money.count(p.ratingCount)} reviews)',
            style: AppType.bodySmall.copyWith(color: AppColors.textSecondary)),
      ],
    );
  }

  // ── Price ──────────────────────────────────────────────────────────
  Widget _priceRow() {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Text(Money.fromPaise(_sellingPaise),
            style: AppType.headingLarge.copyWith(
                fontSize: 24,
                fontWeight: FontWeight.w800,
                color: AppColors.brandGoldStrong)),
        if (_hasDiscount) ...[
          const SizedBox(width: AppSpacing.x8),
          Text(Money.fromPaise(_mrpPaise),
              style: AppType.bodyMedium.copyWith(
                  fontSize: 14,
                  color: AppColors.textTertiary,
                  decoration: TextDecoration.lineThrough)),
          const SizedBox(width: AppSpacing.x8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
            decoration: BoxDecoration(
              color: AppColors.brandGreenSubtle,
              borderRadius: BorderRadius.circular(AppRadii.control),
            ),
            child: Text('-$_discountPct%',
                style: AppType.bodySmall.copyWith(
                    fontWeight: FontWeight.w800,
                    color: AppColors.brandGreen)),
          ),
        ],
      ],
    );
  }

  Widget _stockRow() {
    final ok = _inStock;
    return Row(
      children: [
        Icon(ok ? Icons.check_circle_rounded : Icons.remove_circle_rounded,
            size: 16,
            color: ok ? AppColors.brandGreen : AppColors.destructiveRed),
        const SizedBox(width: 6),
        Text(ok ? 'In stock' : 'Out of stock',
            style: AppType.bodyMedium.copyWith(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: ok ? AppColors.brandGreen : AppColors.destructiveRed)),
      ],
    );
  }

  Widget _referralBanner() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.brandAmberLight.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(AppRadii.field),
      ),
      child: Row(
        children: [
          const Icon(Icons.card_giftcard_rounded,
              size: 18, color: AppColors.brandGoldStrong),
          const SizedBox(width: AppSpacing.x10),
          Expanded(
            child: Text('Refer a friend — they get a discount on their first order.',
                style: AppType.bodySmall.copyWith(
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary)),
          ),
        ],
      ),
    );
  }

  // ── Size / variants ────────────────────────────────────────────────
  Widget _sizeSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _section('Size'),
        const SizedBox(height: AppSpacing.x10),
        Wrap(
          spacing: 9,
          runSpacing: 9,
          children: [
            for (var i = 0; i < p.variants.length; i++)
              AppChip(
                label: p.variants[i].label,
                selected: i == _variantIndex,
                variant: AppChipVariant.variant,
                enabled: p.variants[i].inStock,
                onTap: () => setState(() => _variantIndex = i),
              ),
          ],
        ),
      ],
    );
  }

  Widget _specTable() {
    return Column(
      children: [
        for (final row in p.specDetails)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 9),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(row.key,
                      style: AppType.bodyMedium.copyWith(
                          fontSize: 13, color: AppColors.textSecondary)),
                ),
                const SizedBox(width: AppSpacing.x16),
                Expanded(
                  child: Text(row.value,
                      textAlign: TextAlign.right,
                      style: AppType.bodyMedium.copyWith(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary)),
                ),
              ],
            ),
          ),
      ],
    );
  }

  // ── Reviews summary (read-only) ────────────────────────────────────
  // No write affordance here by design: a review may only be written from a
  // DELIVERED order, and the security rules reject anything else — so the link
  // only ever opens the read-only list.
  Widget _reviewsSummary(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: _section('Ratings & reviews')),
            GestureDetector(
              onTap: () => context.push('/product/${p.id}/reviews',
                  extra: {'rating': p.rating, 'ratingCount': p.ratingCount}),
              child: Text(
                  p.ratingCount > 0
                      ? 'See all ${Money.count(p.ratingCount)}'
                      : 'See reviews',
                  style: AppType.bodySmall.copyWith(
                      fontWeight: FontWeight.w700,
                      color: AppColors.brandGreen)),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.x12),
        Row(
          children: [
            Text(p.rating.toStringAsFixed(1),
                style: AppType.displayLarge.copyWith(
                    fontSize: 40,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary)),
            const SizedBox(width: AppSpacing.x12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    for (var i = 1; i <= 5; i++)
                      Icon(
                        i <= p.rating.round()
                            ? Icons.star_rounded
                            : Icons.star_outline_rounded,
                        size: 16,
                        color: AppColors.brandAmber,
                      ),
                  ],
                ),
                const SizedBox(height: 2),
                Text('${Money.count(p.ratingCount)} ratings',
                    style: AppType.bodySmall
                        .copyWith(color: AppColors.textSecondary)),
              ],
            ),
          ],
        ),
      ],
    );
  }

  // ── Related products ───────────────────────────────────────────────
  Widget _relatedSection(BuildContext context) {
    return StreamBuilder<List<Product>>(
      stream: widget.repo.productsInCategory(p.categorySlug, max: 12),
      builder: (context, snap) {
        final related =
            (snap.data ?? const <Product>[]).where((r) => r.id != p.id).toList();
        if (related.isEmpty) return const SizedBox.shrink();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _section('You may also like'),
            const SizedBox(height: AppSpacing.x12),
            SizedBox(
              height: 250,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: EdgeInsets.zero,
                itemCount: related.length,
                separatorBuilder: (_, _) =>
                    const SizedBox(width: AppSpacing.x12),
                itemBuilder: (context, i) => SizedBox(
                  width: 160,
                  child: ProductCard(
                    product: related[i],
                    onTap: () => context.push('/product/${related[i].id}',
                        extra: related[i]),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  // ── Sticky bottom: wishlist + add to bag ───────────────────────────
  Widget _bottomBar(BuildContext context, Product product) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x12, AppSpacing.x20, AppSpacing.x12),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: AppColors.borderSubtle)),
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            Consumer<WishlistProvider>(
              builder: (context, wl, _) {
                final wished = wl.contains(product.id);
                return GestureDetector(
                  onTap: () {
                    final nowWished = !wished;
                    wl.toggle(product);
                    AppToast.show(
                        context,
                        nowWished
                            ? 'Added to wishlist'
                            : 'Removed from wishlist',
                        variant: nowWished
                            ? AppToastVariant.success
                            : AppToastVariant.neutral);
                  },
                  child: Container(
                    width: 52,
                    height: 52,
                    decoration: BoxDecoration(
                      color: wished
                          ? AppColors.destructiveRed.withValues(alpha: 0.08)
                          : Colors.white,
                      borderRadius: BorderRadius.circular(AppRadii.control),
                      border: Border.all(
                          color: wished
                              ? AppColors.destructiveRed.withValues(alpha: 0.4)
                              : AppColors.borderSubtle),
                    ),
                    child: Icon(
                        wished
                            ? Icons.favorite_rounded
                            : Icons.favorite_border_rounded,
                        size: 22,
                        color: wished
                            ? AppColors.destructiveRed
                            : AppColors.textPrimary),
                  ),
                );
              },
            ),
            const SizedBox(width: AppSpacing.x12),
            Expanded(
              child: Builder(builder: (context) {
                // Membership is per selected variant (product+variant), so a
                // second size can still be added and "Remove" only pulls the
                // selected line — not every variant of the product.
                final key = _lineKey;
                final inCart = context
                    .select<CartProvider, bool>((c) => c.containsLine(key));
                // Already in the bag → tapping OPENS the bag (it does not
                // remove). First tap adds; after that the button is a Go-to-bag
                // shortcut, matching the product card and the web.
                if (inCart) {
                  return AppButton.outlined(
                    label: 'Go to bag',
                    onPressed: () => context.go(Routes.bag),
                  );
                }
                return AppButton.reward(
                  label: _inStock
                      ? 'Add to bag · ${Money.fromPaise(_sellingPaise)}'
                      : 'Out of stock',
                  onPressed: _inStock ? _addToBag : null,
                );
              }),
            ),
          ],
        ),
      ),
    );
  }

  /// Identity of the currently selected product+variant line (matches
  /// CartLine.key). Two sizes are two separate lines.
  String get _lineKey => '${p.id}|${_variant?.id ?? ''}';

  void _addToBag() {
    // Optimistic — the button flips to "Go to bag" instantly.
    // A cap (bag lines / units per item / units per order / order value) blocks
    // the add and explains itself; the server applies the same numbers.
    final limit = context.read<CartProvider>().addProduct(p, variant: _variant);
    AppToast.show(context, limit.message ?? 'Added to bag',
        variant:
            limit.blocked ? AppToastVariant.error : AppToastVariant.success);
  }

  Widget _section(String title) => Text(title,
      style: AppType.headingLarge
          .copyWith(fontSize: 16, fontWeight: FontWeight.w800));
}

Color? _hex(String? s) {
  if (s == null) return null;
  var h = s.replaceAll('#', '').trim();
  if (h.length == 6) h = 'FF$h';
  final v = int.tryParse(h, radix: 16);
  return v == null ? null : Color(v);
}
