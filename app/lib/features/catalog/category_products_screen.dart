import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import '../../core/widgets/product_card.dart';
import 'data/catalog_repository.dart';
import 'data/category.dart';
import 'data/product.dart';
import 'data/product_filters.dart';
import 'filter_sheet.dart';
import 'sort_sheet.dart';

/// Screen — Category Products (Figma node 50:8507). Products in one category,
/// with sub-category chips, sort, and a filter sheet. Reached from the
/// Categories grid; tapping a product opens its detail.
class CategoryProductsScreen extends StatefulWidget {
  const CategoryProductsScreen({
    super.key,
    required this.slug,
    this.category,
  });

  final String slug;

  /// Passed via `extra` when navigating from the Categories grid (gives the
  /// name + sub-categories immediately). Null on deep-link → resolved live.
  final Category? category;

  @override
  State<CategoryProductsScreen> createState() => _CategoryProductsScreenState();
}

class _CategoryProductsScreenState extends State<CategoryProductsScreen> {
  final _repo = CatalogRepository();

  String? _sub; // null = "All"
  SortOption _sort = SortOption.featured;
  ProductFilters _filters = ProductFilters.empty;

  String get _title => widget.category?.name ?? _titleCase(widget.slug);

  /// Only the sub-categories the admin left visible — hiding one in the admin
  /// must remove its chip here, exactly as the web filters the facet list.
  List<SubCategory> get _subs =>
      (widget.category?.subCategories ?? const <SubCategory>[])
          .where((s) => s.isVisible)
          .toList();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _header(context),
            if (_subs.isNotEmpty) _subCategoryBar(),
          Expanded(
            child: StreamBuilder<List<Product>>(
              stream: _repo.productsInCategory(widget.slug, max: 100),
              builder: (context, snap) {
                if (snap.hasError) {
                  return const AppErrorState(
                      message: "Couldn't load products. Please try again.");
                }
                if (!snap.hasData) return const _GridSkeleton();
                final base = snap.data!;
                final visible = base.applyListing(
                    subCategorySlug: _sub, filters: _filters, sort: _sort);
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _toolbar(context, base, visible.length),
                    Expanded(child: _grid(context, visible)),
                  ],
                );
              },
            ),
          ),
        ],
        ),
      ),
    );
  }

  // ── Header: back + name + wishlist ─────────────────────────────────
  Widget _header(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x10),
      child: Row(
        children: [
          AppCircleIconButton(
            icon: Icons.arrow_back_rounded,
            iconColor: AppColors.textPrimary,
            onTap: () => context.pop(),
          ),
          const SizedBox(width: AppSpacing.x12),
          Expanded(
            child: Text(_title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppType.headingLarge.copyWith(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.4)),
          ),
          const SizedBox(width: AppSpacing.x12),
          GestureDetector(
            onTap: () => context.push(Routes.wishlist),
            child: const Icon(Icons.favorite_border_rounded,
                size: 22, color: AppColors.textPrimary),
          ),
        ],
      ),
    );
  }

  // ── Sub-category chips ─────────────────────────────────────────────
  Widget _subCategoryBar() {
    final items = [null, ..._subs.map((s) => s.slug)];
    return SizedBox(
      height: 44,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x8),
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.x8),
        itemBuilder: (context, i) {
          final slug = items[i];
          final selected = _sub == slug;
          final label = slug == null
              ? 'All'
              : _subs.firstWhere((s) => s.slug == slug).name;
          return _SubChip(
            label: label,
            selected: selected,
            onTap: () => setState(() => _sub = slug),
          );
        },
      ),
    );
  }

  // ── Toolbar: count + sort + filter ─────────────────────────────────
  Widget _toolbar(BuildContext context, List<Product> base, int count) {
    final scoped = base.applyListing(subCategorySlug: _sub);
    final (loP, hiP) = scoped.priceBoundsPaise();
    final active = _filters.activeCount(loP, hiP);
    return Container(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x12),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.borderSubtle)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text.rich(
              TextSpan(
                text: '$count',
                style: AppType.bodyMedium.copyWith(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary),
                children: [
                  TextSpan(
                    text: ' item${count == 1 ? '' : 's'}',
                    style: AppType.bodyMedium.copyWith(
                        fontSize: 13,
                        fontWeight: FontWeight.w400,
                        color: AppColors.textSecondary),
                  ),
                ],
              ),
            ),
          ),
          _ToolButton(
            icon: Icons.swap_vert_rounded,
            label: 'Sort',
            onTap: () => _openSort(context),
          ),
          const SizedBox(width: 8),
          _ToolButton(
            icon: Icons.tune_rounded,
            label: active > 0 ? 'Filter · $active' : 'Filter',
            active: active > 0,
            onTap: () => _openFilter(context, scoped, loP, hiP),
          ),
        ],
      ),
    );
  }

  Widget _grid(BuildContext context, List<Product> products) {
    if (products.isEmpty) {
      return const AppEmptyState(
        icon: Icons.inventory_2_outlined,
        title: 'No products',
        subtitle: 'Try a different sub-category or clear your filters.',
      );
    }
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x16, AppSpacing.x20, AppSpacing.x20),
      itemCount: products.length,
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 210,
        crossAxisSpacing: AppSpacing.x14,
        mainAxisSpacing: AppSpacing.x14,
        mainAxisExtent: 252,
      ),
      itemBuilder: (context, i) {
        final p = products[i];
        return ProductCard(
          product: p,
          onTap: () => context.push('${Routes.product}/${p.id}', extra: p),
        );
      },
    );
  }

  Future<void> _openFilter(BuildContext context, List<Product> scoped,
      int loP, int hiP) async {
    final result = await showFilterSheet(
      context,
      products: scoped,
      boundsMinPaise: loP,
      boundsMaxPaise: hiP,
      typeOptions: scoped.typeOptions(),
      current: _filters,
    );
    if (result != null && mounted) setState(() => _filters = result);
  }

  Future<void> _openSort(BuildContext context) async {
    final result = await showSortSheet(context, current: _sort);
    if (result != null && mounted) setState(() => _sort = result);
  }
}

// ── Sub-category chip ────────────────────────────────────────────────
class _SubChip extends StatelessWidget {
  const _SubChip(
      {required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        alignment: Alignment.center,
        padding: const EdgeInsets.symmetric(horizontal: 13),
        decoration: BoxDecoration(
          color: selected ? AppColors.brandGreen : Colors.white,
          borderRadius: BorderRadius.circular(AppRadii.pill),
          border: Border.all(
              color: selected ? AppColors.brandGreen : AppColors.borderSubtle),
        ),
        child: Text(label,
            style: AppType.bodyMedium.copyWith(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: selected ? Colors.white : AppColors.textPrimary)),
      ),
    );
  }
}

// ── Sort / Filter tool button ────────────────────────────────────────
class _ToolButton extends StatelessWidget {
  const _ToolButton(
      {required this.icon,
      required this.label,
      required this.onTap,
      this.active = false});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final fg = active ? AppColors.brandGreen : AppColors.textPrimary;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 9),
        decoration: BoxDecoration(
          color: active ? AppColors.brandGreenSubtle : Colors.white,
          borderRadius: BorderRadius.circular(AppRadii.pill),
          border: Border.all(
              color: active ? AppColors.brandGreen : AppColors.borderSubtle),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: fg),
            const SizedBox(width: 6),
            Text(label,
                style: AppType.bodyMedium.copyWith(
                    fontSize: 13, fontWeight: FontWeight.w700, color: fg)),
          ],
        ),
      ),
    );
  }
}

class _GridSkeleton extends StatelessWidget {
  const _GridSkeleton();
  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x16, AppSpacing.x20, AppSpacing.x20),
      itemCount: 6,
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 210,
        crossAxisSpacing: AppSpacing.x14,
        mainAxisSpacing: AppSpacing.x14,
        mainAxisExtent: 252,
      ),
      itemBuilder: (_, _) =>
          const AppShimmer(height: 252, radius: AppRadii.field),
    );
  }
}

String _titleCase(String slug) => slug
    .split('-')
    .where((w) => w.isNotEmpty)
    .map((w) => '${w[0].toUpperCase()}${w.substring(1)}')
    .join(' ');
