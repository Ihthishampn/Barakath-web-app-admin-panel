import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/services/app_prefs.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import '../../core/widgets/product_card.dart';
import '../catalog/data/catalog_repository.dart';
import '../catalog/data/category.dart';
import '../catalog/data/product.dart';

/// Screen — Search (Figma node 46:5582). Opened from the Home search bar.
///
/// Two states share one screen:
///  • **Idle** (empty query) → RECENT searches as tappable chips.
///  • **Results** (query typed) → live, real-time filtering of the published
///    catalog: matching CATEGORY chips + a 2-column product grid. Matching is
///    client-side (case-insensitive substring on product name and category
///    name/slug), so partial input and single letters work. Search history is
///    device-local (SharedPreferences).
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key, this.initialQuery = ''});

  final String initialQuery;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _repo = CatalogRepository();
  final _controller = TextEditingController();
  final _focus = FocusNode();

  /// Debounced query that actually drives the in-memory filter.
  String _query = '';
  Timer? _debounce;
  List<String> _recent = const [];

  // Live catalog streams, subscribed once and filtered in-memory as the user
  // types — cheap for this catalog size and gives instant partial matching.
  late final Stream<List<Product>> _productsStream = _repo.products(max: 200);
  late final Stream<List<Category>> _categoriesStream = _repo.categories();

  @override
  void initState() {
    super.initState();
    _controller.text = widget.initialQuery;
    _query = widget.initialQuery.trim();
    _loadRecent();
    // Autofocus the field so the keyboard is up immediately, like the design.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _query.isEmpty) _focus.requestFocus();
    });
  }

  Future<void> _loadRecent() async {
    final r = await AppPrefs.recentSearches();
    if (mounted) setState(() => _recent = r);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (mounted) setState(() => _query = value.trim());
    });
  }

  /// Commit a query to history (on keyboard "search" or chip tap).
  Future<void> _commit(String value) async {
    final q = value.trim();
    if (q.isEmpty) return;
    _controller.text = q;
    _controller.selection =
        TextSelection.collapsed(offset: q.length);
    setState(() => _query = q);
    final updated = await AppPrefs.addRecentSearch(q);
    if (mounted) setState(() => _recent = updated);
  }

  void _clearField() {
    _controller.clear();
    setState(() => _query = '');
    _focus.requestFocus();
  }

  Future<void> _removeRecent(String q) async {
    final updated = await AppPrefs.removeRecentSearch(q);
    if (mounted) setState(() => _recent = updated);
  }

  Future<void> _clearAllRecent() async {
    await AppPrefs.clearRecentSearches();
    if (mounted) setState(() => _recent = const []);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _searchBar(),
            Expanded(
              child: _query.isEmpty ? _recentView() : _resultsView(),
            ),
          ],
        ),
      ),
    );
  }

  // ── Header: back button + search field ─────────────────────────────
  Widget _searchBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x10, AppSpacing.x20, AppSpacing.x12),
      child: Row(
        children: [
          AppCircleIconButton(
            icon: Icons.arrow_back_rounded,
            iconColor: AppColors.textPrimary,
            onTap: () => context.pop(),
          ),
          const SizedBox(width: AppSpacing.x12),
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(AppRadii.pill),
                border: Border.all(color: AppColors.brandGreen),
              ),
              child: Row(
                children: [
                  const Icon(Icons.search_rounded,
                      size: 18, color: AppColors.brandGreen),
                  const SizedBox(width: AppSpacing.x10),
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      focusNode: _focus,
                      textInputAction: TextInputAction.search,
                      onChanged: _onChanged,
                      onSubmitted: _commit,
                      style: AppType.bodyMedium.copyWith(
                          fontSize: 14, color: AppColors.textPrimary),
                      decoration: InputDecoration(
                        isCollapsed: true,
                        border: InputBorder.none,
                        hintText: 'Search perfumes, books, clothing…',
                        hintStyle: AppType.bodyMedium.copyWith(
                            fontSize: 14, color: AppColors.textTertiary),
                      ),
                    ),
                  ),
                  if (_controller.text.isNotEmpty) ...[
                    const SizedBox(width: AppSpacing.x8),
                    GestureDetector(
                      onTap: _clearField,
                      behavior: HitTestBehavior.opaque,
                      child: const Icon(Icons.close_rounded,
                          size: 18, color: AppColors.textTertiary),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Idle state: recent searches ────────────────────────────────────
  Widget _recentView() {
    if (_recent.isEmpty) {
      return const AppEmptyState(
        icon: Icons.search_rounded,
        title: 'Search the store',
        subtitle: 'Find perfumes, books, clothing and more.',
      );
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x20),
      children: [
        Row(
          children: [
            Expanded(
              child: Text('RECENT',
                  style: AppType.labelUppercase.copyWith(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.6,
                      color: AppColors.textTertiary)),
            ),
            GestureDetector(
              onTap: _clearAllRecent,
              child: Text('Clear',
                  style: AppType.bodySmall.copyWith(
                      fontWeight: FontWeight.w700,
                      color: AppColors.brandGreen)),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.x10),
        Wrap(
          spacing: 9,
          runSpacing: 9,
          children: [
            for (final term in _recent) _recentChip(term),
          ],
        ),
      ],
    );
  }

  Widget _recentChip(String term) {
    return GestureDetector(
      onTap: () => _commit(term),
      onLongPress: () => _removeRecent(term),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 19, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(AppRadii.pill),
          border: Border.all(color: AppColors.borderSubtle),
        ),
        child: Text(term,
            style: AppType.bodyMedium.copyWith(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                height: 21 / 14,
                color: AppColors.textPrimary)),
      ),
    );
  }

  // ── Results state: live in-memory filtering ────────────────────────
  Widget _resultsView() {
    return StreamBuilder<List<Category>>(
      stream: _categoriesStream,
      builder: (context, catSnap) {
        final categories = catSnap.data ?? const <Category>[];
        final slugToName = {for (final c in categories) c.slug: c.name};
        return StreamBuilder<List<Product>>(
          stream: _productsStream,
          builder: (context, prodSnap) {
            if (prodSnap.hasError) {
              return const AppErrorState(
                  message: "Couldn't run the search. Please try again.");
            }
            if (!prodSnap.hasData) return _resultsSkeleton();

            final q = _query.toLowerCase().trim();
            // Products matched by name OR their category's name/slug.
            final products = prodSnap.data!.where((p) {
              final catName =
                  (slugToName[p.categorySlug] ?? p.categorySlug).toLowerCase();
              return p.name.toLowerCase().contains(q) ||
                  catName.contains(q) ||
                  p.categorySlug.toLowerCase().contains(q);
            }).toList();
            // Categories matched by name or slug.
            final matchedCats = categories
                .where((c) =>
                    c.name.toLowerCase().contains(q) ||
                    c.slug.toLowerCase().contains(q))
                .toList();

            if (products.isEmpty && matchedCats.isEmpty) {
              return AppEmptyState(
                icon: Icons.search_off_rounded,
                title: 'No results',
                subtitle: 'We couldn\'t find anything for "$_query".',
              );
            }

            return ListView(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x20),
              children: [
                if (matchedCats.isNotEmpty) ...[
                  _sectionLabel('CATEGORIES'),
                  const SizedBox(height: AppSpacing.x10),
                  Wrap(
                    spacing: 9,
                    runSpacing: 9,
                    children: [for (final c in matchedCats) _categoryChip(c)],
                  ),
                  const SizedBox(height: AppSpacing.x20),
                ],
                if (products.isNotEmpty) ...[
                  _resultsCount(products.length),
                  const SizedBox(height: AppSpacing.x14),
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: products.length,
                    gridDelegate:
                        const SliverGridDelegateWithMaxCrossAxisExtent(
                      maxCrossAxisExtent: 210,
                      crossAxisSpacing: AppSpacing.x14,
                      mainAxisSpacing: AppSpacing.x14,
                      mainAxisExtent: 252,
                    ),
                    itemBuilder: (context, i) => ProductCard(
                      product: products[i],
                      onTap: () => context.push(
                          '${Routes.product}/${products[i].id}',
                          extra: products[i]),
                    ),
                  ),
                ],
              ],
            );
          },
        );
      },
    );
  }

  Widget _sectionLabel(String text) {
    return Text(text,
        style: AppType.labelUppercase.copyWith(
            fontSize: 12,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.6,
            color: AppColors.textTertiary));
  }

  Widget _categoryChip(Category c) {
    return GestureDetector(
      onTap: () =>
          context.push('${Routes.category}/${c.slug}', extra: c),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.brandGreenSubtle,
          borderRadius: BorderRadius.circular(AppRadii.pill),
          border: Border.all(color: AppColors.brandGreen.withValues(alpha: 0.3)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.category_rounded,
                size: 16, color: AppColors.brandGreen),
            const SizedBox(width: 6),
            Text(c.name,
                style: AppType.bodyMedium.copyWith(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.brandGreen)),
          ],
        ),
      ),
    );
  }

  Widget _resultsCount(int n) {
    return Text.rich(
      TextSpan(
        text: '$n result${n == 1 ? '' : 's'}',
        style: AppType.bodyMedium.copyWith(
            fontSize: 13,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary),
        children: [
          TextSpan(
            text: ' for "$_query"',
            style: AppType.bodyMedium.copyWith(
                fontSize: 13,
                fontWeight: FontWeight.w400,
                color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _resultsSkeleton() {
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x12, AppSpacing.x20, AppSpacing.x20),
      itemCount: 4,
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
