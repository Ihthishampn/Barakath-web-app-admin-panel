import 'package:cloud_firestore/cloud_firestore.dart';
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
import 'data/product.dart';

const _gridDelegate = SliverGridDelegateWithMaxCrossAxisExtent(
  maxCrossAxisExtent: 210,
  crossAxisSpacing: AppSpacing.x14,
  mainAxisSpacing: AppSpacing.x14,
  mainAxisExtent: 252,
);

const _gridPadding = EdgeInsets.fromLTRB(
    AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x24);

/// A full-grid "See all" listing.
///
/// [source] selects the slice: `'all'` walks the whole catalogue with cursor
/// pagination (30 at a time, more as you scroll), while `'flash'` / `'arrivals'`
/// keep the live stream + the same in-memory derivation the home rails use —
/// those sets are small and benefit from staying real-time.
class ProductListScreen extends StatefulWidget {
  const ProductListScreen({super.key, required this.title, required this.source});

  final String title;
  final String source; // 'all' | 'flash' | 'arrivals'

  @override
  State<ProductListScreen> createState() => _ProductListScreenState();
}

class _ProductListScreenState extends State<ProductListScreen> {
  static final _repo = CatalogRepository();

  final _scroll = ScrollController();
  final _items = <Product>[];
  DocumentSnapshot<Map<String, dynamic>>? _cursor;
  bool _loading = false;
  bool _hasMore = true;
  bool _failed = false;

  /// Bumped by [_refresh]. A page load captures the cursor BEFORE the refresh
  /// resets it, so a load started under an older generation must be discarded —
  /// appending it would repopulate the emptied grid from mid-catalogue and leave
  /// the cursor there, permanently hiding the first pages.
  int _gen = 0;

  /// Only the full catalogue paginates; the derived rails stay streamed.
  bool get _paged => widget.source == 'all';

  @override
  void initState() {
    super.initState();
    if (_paged) {
      _scroll.addListener(_onScroll);
      _loadMore();
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  /// Prefetch a screen ahead of the fold so the grid never visibly stalls.
  void _onScroll() {
    if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 600) {
      _loadMore();
    }
  }

  Future<void> _loadMore() async {
    if (_loading || !_hasMore) return;
    final gen = _gen;
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      // A page can be entirely hidden products, which would grow nothing and
      // leave the scroll listener with no new extent to trigger on — so keep
      // pulling until we actually gain something or the collection runs out.
      final gained = <Product>[];
      var cursor = _cursor;
      var more = true;
      while (gained.isEmpty && more) {
        final page = await _repo.productsPage(startAfter: cursor);
        gained.addAll(page.products);
        cursor = page.lastDoc ?? cursor;
        more = page.hasMore;
      }
      if (!mounted || gen != _gen) return; // superseded by a pull-to-refresh
      setState(() {
        _items.addAll(gained);
        _cursor = cursor;
        _hasMore = more;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || gen != _gen) return;
      setState(() {
        _loading = false;
        _failed = true;
      });
    }
  }

  Future<void> _refresh() async {
    setState(() {
      _gen++;
      _items.clear();
      _cursor = null;
      _hasMore = true;
      _failed = false;
      // Any page still in flight now belongs to the previous generation and
      // will be discarded, so it no longer owns the grid — clearing this lets
      // the reload below start immediately instead of silently bailing out.
      _loading = false;
    });
    await _loadMore();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surfaceBackground,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _header(context),
            Expanded(child: _paged ? _pagedGrid() : _streamedGrid()),
          ],
        ),
      ),
    );
  }

  // ── Full catalogue — cursor pagination ──────────────────────────────
  Widget _pagedGrid() {
    if (_items.isEmpty) {
      if (_loading) return const _GridSkeleton();
      if (_failed) {
        return AppErrorState(
            message: "Couldn't load products.", onRetry: _loadMore);
      }
      return const AppEmptyState(
        icon: Icons.storefront_outlined,
        title: 'Nothing here yet',
        subtitle: 'Check back a little later.',
      );
    }
    return RefreshIndicator(
      onRefresh: _refresh,
      color: AppColors.brandGreen,
      child: CustomScrollView(
        controller: _scroll,
        slivers: [
          SliverPadding(
            padding: _gridPadding.copyWith(bottom: AppSpacing.x12),
            sliver: SliverGrid.builder(
              gridDelegate: _gridDelegate,
              itemCount: _items.length,
              itemBuilder: (context, i) => _card(_items[i]),
            ),
          ),
          SliverToBoxAdapter(child: _footer()),
        ],
      ),
    );
  }

  /// Bottom-of-list affordance: spinner while a page is in flight, a retry when
  /// one failed, and a quiet end-marker once everything is loaded.
  Widget _footer() {
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.only(bottom: AppSpacing.x24),
        child: Center(
          child: SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(
                strokeWidth: 2.2, color: AppColors.brandGreen),
          ),
        ),
      );
    }
    if (_failed) {
      return Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.x24),
        child: Center(
          child: TextButton(
            onPressed: _loadMore,
            child: Text('Couldn’t load more · Retry',
                style: AppType.bodyMedium.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.brandGreen)),
          ),
        ),
      );
    }
    if (!_hasMore && _items.length > 8) {
      return Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.x24),
        child: Center(
          child: Text("That's everything",
              style: AppType.bodySmall.copyWith(color: AppColors.textTertiary)),
        ),
      );
    }
    return const SizedBox(height: AppSpacing.x24);
  }

  // ── Derived rails — live stream, no pagination needed ───────────────
  Widget _streamedGrid() {
    return StreamBuilder<List<Product>>(
      stream: _repo.products(),
      builder: (context, snap) {
        if (snap.hasError) {
          return const AppErrorState(message: "Couldn't load products.");
        }
        if (!snap.hasData) return const _GridSkeleton();
        final all = snap.data!;
        final products = widget.source == 'flash'
            ? all.flashSale
            : all.newArrivals(DateTime.now().millisecondsSinceEpoch);
        if (products.isEmpty) {
          return const AppEmptyState(
            icon: Icons.storefront_outlined,
            title: 'Nothing here yet',
            subtitle: 'Check back a little later.',
          );
        }
        return GridView.builder(
          padding: _gridPadding,
          itemCount: products.length,
          gridDelegate: _gridDelegate,
          itemBuilder: (context, i) => _card(products[i]),
        );
      },
    );
  }

  Widget _card(Product p) => ProductCard(
        product: p,
        onTap: () => context.push('${Routes.product}/${p.id}', extra: p),
      );

  Widget _header(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x12),
      child: Row(
        children: [
          AppCircleIconButton(
            icon: Icons.arrow_back_rounded,
            iconColor: AppColors.textPrimary,
            onTap: () => context.pop(),
          ),
          const SizedBox(width: AppSpacing.x14),
          Text(widget.title,
              style: AppType.headingLarge.copyWith(
                  fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
        ],
      ),
    );
  }
}

class _GridSkeleton extends StatelessWidget {
  const _GridSkeleton();
  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      padding: _gridPadding,
      itemCount: 6,
      gridDelegate: _gridDelegate,
      itemBuilder: (_, _) => const AppShimmer(height: 252, radius: AppRadii.card),
    );
  }
}
