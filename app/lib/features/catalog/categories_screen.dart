import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import 'data/catalog_repository.dart';
import 'data/category.dart';

/// Screen — Categories (tab 2, Figma node 50:8421). Fetches all categories from
/// Firebase and shows them as gradient cards; tapping one opens its products.
class CategoriesScreen extends StatefulWidget {
  const CategoriesScreen({super.key});

  @override
  State<CategoriesScreen> createState() => _CategoriesScreenState();
}

class _CategoriesScreenState extends State<CategoriesScreen> {
  final _repo = CatalogRepository();
  final _controller = TextEditingController();
  final _focus = FocusNode();

  // Created ONCE per State, not per build(): typing in the search box calls
  // setState on every keystroke, and a stream built inside build() would make
  // both StreamBuilders tear down and re-listen each time — re-reading the whole
  // categories collection AND every published product (categoryCounts is an
  // unbounded listener) just to filter a list that is already in memory.
  late final Stream<List<Category>> _categoriesStream = _repo.categories();
  late final Stream<Map<String, int>> _countsStream = _repo.categoryCounts();

  bool _searching = false;
  String _query = '';

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _openSearch() {
    setState(() => _searching = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus.requestFocus();
    });
  }

  void _closeSearch() {
    _controller.clear();
    setState(() {
      _searching = false;
      _query = '';
    });
  }

  /// Case-insensitive match on the category name or slug.
  List<Category> _filter(List<Category> all) {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return all;
    return all
        .where((c) =>
            c.name.toLowerCase().contains(q) ||
            c.slug.toLowerCase().contains(q))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _header(context),
          Expanded(
            child: StreamBuilder<List<Category>>(
              stream: _categoriesStream,
              builder: (context, snap) {
                if (snap.hasError) {
                  return const AppErrorState(
                      message: "Couldn't load categories. Please try again.");
                }
                if (!snap.hasData) return const _CategoriesSkeleton();
                final all = snap.data!;
                if (all.isEmpty) {
                  return const AppEmptyState(
                    icon: Icons.grid_view_rounded,
                    title: 'No categories yet',
                    subtitle: 'Categories will appear here once added.',
                  );
                }
                final categories = _filter(all);
                if (categories.isEmpty) {
                  return AppEmptyState(
                    icon: Icons.search_off_rounded,
                    title: 'No categories found',
                    subtitle: 'Nothing matches "${_query.trim()}".',
                  );
                }
                return StreamBuilder<Map<String, int>>(
                  stream: _countsStream,
                  builder: (context, countSnap) {
                    final counts = countSnap.data ?? const <String, int>{};
                    return GridView.builder(
                      padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                          AppSpacing.x4, AppSpacing.x20, AppSpacing.x20),
                      itemCount: categories.length,
                      gridDelegate:
                          const SliverGridDelegateWithMaxCrossAxisExtent(
                        maxCrossAxisExtent: 220,
                        crossAxisSpacing: AppSpacing.x14,
                        mainAxisSpacing: AppSpacing.x14,
                        mainAxisExtent: 182,
                      ),
                      itemBuilder: (context, i) => _CategoryCard(
                        category: categories[i],
                        count: counts[categories[i].slug],
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _header(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x12),
      child: _searching
          ? _searchField()
          : Row(
              children: [
                Expanded(
                  child: Text('Categories',
                      style: AppType.headingLarge.copyWith(
                          fontSize: 24,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.48)),
                ),
                GestureDetector(
                  onTap: _openSearch,
                  child: Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                      border: Border.all(color: AppColors.borderSubtle),
                    ),
                    child: const Icon(Icons.search_rounded,
                        size: 20, color: AppColors.textPrimary),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _searchField() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
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
              onChanged: (v) => setState(() => _query = v),
              style: AppType.bodyMedium
                  .copyWith(fontSize: 14, color: AppColors.textPrimary),
              decoration: InputDecoration(
                isCollapsed: true,
                border: InputBorder.none,
                hintText: 'Search categories…',
                hintStyle: AppType.bodyMedium
                    .copyWith(fontSize: 14, color: AppColors.textTertiary),
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.x8),
          GestureDetector(
            onTap: _closeSearch,
            behavior: HitTestBehavior.opaque,
            child: const Icon(Icons.close_rounded,
                size: 18, color: AppColors.textTertiary),
          ),
        ],
      ),
    );
  }
}

class _CategoryCard extends StatelessWidget {
  const _CategoryCard({required this.category, this.count});
  final Category category;
  final int? count;

  @override
  Widget build(BuildContext context) {
    final scheme = schemeForCategory(category.slug);
    final tint = _hex(category.tint) ?? scheme.bgTint;
    // Live count (derived from published products); fall back to the stored
    // field only until the count stream resolves.
    final n = count ?? category.productCount;
    return GestureDetector(
      onTap: () => context.push('${Routes.category}/${category.slug}',
          extra: category),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.x16),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppRadii.field),
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color.lerp(tint, Colors.white, 0.55)!, tint],
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.7),
                borderRadius: BorderRadius.circular(AppRadii.control),
              ),
              child: Icon(iconForCategory(category.slug),
                  size: 22, color: scheme.iconColor),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(category.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppType.headingLarge.copyWith(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary)),
                const SizedBox(height: 2),
                Text('$n product${n == 1 ? '' : 's'}',
                    style: AppType.bodyMedium.copyWith(
                        fontSize: 12, color: AppColors.textSecondary)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Per-category glyph — mirrors the Figma category icons, with a safe fallback
/// for any new category the admin adds.
IconData iconForCategory(String slug) {
  switch (slug.toLowerCase()) {
    case 'perfumes':
      return Icons.card_giftcard_rounded;
    case 'books':
      return Icons.menu_book_rounded;
    case 'clothing':
      return Icons.checkroom_rounded;
    case 'islamic':
      return Icons.mosque_rounded;
    case 'back-to-school':
      return Icons.school_rounded;
    default:
      return Icons.category_rounded;
  }
}

Color? _hex(String? s) {
  if (s == null) return null;
  var h = s.replaceAll('#', '').trim();
  if (h.length == 6) h = 'FF$h';
  final v = int.tryParse(h, radix: 16);
  return v == null ? null : Color(v);
}

class _CategoriesSkeleton extends StatelessWidget {
  const _CategoriesSkeleton();
  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x20),
      itemCount: 4,
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 220,
        crossAxisSpacing: AppSpacing.x14,
        mainAxisSpacing: AppSpacing.x14,
        mainAxisExtent: 182,
      ),
      itemBuilder: (_, _) =>
          const AppShimmer(height: 182, radius: AppRadii.field),
    );
  }
}
