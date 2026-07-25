import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/router/app_router.dart';
import '../../core/services/auth_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import '../../core/widgets/product_card.dart';
import '../catalog/data/catalog_repository.dart';
import '../catalog/data/category.dart' as cat;
import '../catalog/data/product.dart';
import '../notifications/data/notifications_repository.dart';

/// Screen 08 — Home (spec §4.1, reconciled to the Figma design).
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _repo = CatalogRepository();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Column(
        children: [
          _TopBar(),
          Expanded(
            child: StreamBuilder<List<Product>>(
              stream: _repo.products(),
              builder: (context, snap) {
                if (snap.hasError) {
                  return const AppErrorState(
                      message: "Couldn't load the store. Please try again.");
                }
                final loading = !snap.hasData;
                final products = snap.data ?? const <Product>[];
                final flash = products.flashSale;
                // New arrivals — flash-sale items are excluded (they live in the
                // Flash sale rail), so the two rails never share a product. Sort
                // is a Category/listing feature; the Home search bar no longer
                // carries it.
                final now = DateTime.now().millisecondsSinceEpoch;
                final arrivals = products.newArrivals(now);
                const gridTitle = 'New arrivals';
                return ListView(
                  padding: const EdgeInsets.only(bottom: AppSpacing.x24),
                  children: [
                    const SizedBox(height: AppSpacing.x4),
                    const _SearchBar(),
                    const SizedBox(height: AppSpacing.x16),
                    _Banners(repo: _repo),
                    const SizedBox(height: AppSpacing.x24),
                    if (loading)
                      const _RailSkeleton()
                    else ...[
                      if (flash.isNotEmpty)
                        _Rail(
                            title: 'Flash sale',
                            products: flash,
                            // "See all" stays flash-sale only, mirroring the
                            // rail it's attached to.
                            source: 'flash',
                            // Countdown in the heading: admin sale end time when
                            // one is scheduled (same for everyone), else a demo
                            // 2h30m loop — see _CountdownPill.
                            badge: StreamBuilder<DateTime?>(
                              stream: _repo.activeFlashSaleEndsAt(),
                              builder: (context, s) =>
                                  _CountdownPill(endsAt: s.data),
                            )),
                      const SizedBox(height: AppSpacing.x24),
                      // Always shown, mirroring the web home page: the header
                      // and "See all" (→ the full catalogue) never disappear,
                      // only the grid area swaps for an empty message.
                      _Grid(
                          title: gridTitle,
                          products: arrivals,
                          source: 'all',
                          listTitle: 'All products'),
                    ],
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

// ── Top bar (greeting + bell + avatar) ──────────────────────────────
class _TopBar extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final uid = context.watch<AuthProvider>().uid;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x12),
      child: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        stream: uid == null
            ? null
            : FirebaseFirestore.instance.doc('customers/$uid').snapshots(),
        builder: (context, snap) {
          final name = (snap.data?.data()?['name'] as String?)?.trim() ?? '';
          final first = name.isEmpty ? 'there' : name.split(' ').first;
          final initial = name.isEmpty ? 'B' : name[0].toUpperCase();
          return Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('ASSALAMU ALAIKUM',
                        style: AppType.labelUppercase.copyWith(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.44,
                            color: AppColors.textTertiary)),
                    const SizedBox(height: 1),
                    Text('Hi $first',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppType.headingLarge.copyWith(
                            fontSize: 19,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.38)),
                  ],
                ),
              ),
              _BellButton(),
              const SizedBox(width: AppSpacing.x12),
              GestureDetector(
                onTap: () => context.go(Routes.profile),
                child: Container(
                  width: 42,
                  height: 42,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [AppColors.brandGreen, AppColors.brandGreenDark],
                    ),
                  ),
                  alignment: Alignment.center,
                  child: Text(initial,
                      style: AppType.bodyLarge.copyWith(
                          color: Colors.white, fontWeight: FontWeight.w800)),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _BellButton extends StatelessWidget {
  static final _notifications = NotificationsRepository();

  @override
  Widget build(BuildContext context) {
    final uid = context.watch<AuthProvider>().uid;
    return GestureDetector(
      // Opens the same inbox as Profile → Notifications. Viewing it marks the
      // rows read (NotificationsRepository.markAllRead on leave), which clears
      // the yellow dot below.
      onTap: () => context.push(Routes.notifications),
      child: SizedBox(
        width: 44,
        height: 44,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.borderSubtle),
              ),
              child: const Icon(Icons.notifications_none_rounded,
                  size: 20, color: AppColors.textPrimary),
            ),
            // Yellow unread dot — live from Firestore. Shown while the customer
            // has any unread notification (admin broadcasts, order/wallet, …).
            if (uid != null)
              Positioned(
                right: 9,
                top: 9,
                child: StreamBuilder<int>(
                  stream: _notifications.unreadCount(uid),
                  builder: (context, snap) {
                    final unread = snap.data ?? 0;
                    if (unread == 0) return const SizedBox.shrink();
                    return Container(
                      width: 11,
                      height: 11,
                      decoration: BoxDecoration(
                        color: AppColors.brandAmber,
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 2),
                      ),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ── Search bar (navigates to Search) ────────────────────────────────
class _SearchBar extends StatelessWidget {
  const _SearchBar();
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.x20),
      child: GestureDetector(
        onTap: () => context.push(Routes.search),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 17, vertical: 14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppRadii.pill),
            border: Border.all(color: AppColors.borderSubtle),
          ),
          child: Row(
            children: [
              const Icon(Icons.search_rounded, size: 19, color: AppColors.brandGreen),
              const SizedBox(width: AppSpacing.x10),
              Expanded(
                child: Text('Search perfumes, books, clothing…',
                    style: AppType.bodyMedium
                        .copyWith(color: AppColors.textTertiary)),
              ),
              // Sort icon removed from Home — sorting lives on the Category /
              // listing screens, which have a full grid to reorder.
            ],
          ),
        ),
      ),
    );
  }
}

// ── Banner carousel ─────────────────────────────────────────────────
class _Banners extends StatefulWidget {
  const _Banners({required this.repo});
  final CatalogRepository repo;
  @override
  State<_Banners> createState() => _BannersState();
}

class _BannersState extends State<_Banners> {
  final _controller = PageController();
  int _index = 0;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _autoScroll(int count) {
    _timer?.cancel();
    if (count < 2) return;
    _timer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (!_controller.hasClients) return;
      _controller.animateToPage((_index + 1) % count,
          duration: const Duration(milliseconds: 400), curve: Curves.easeOut);
    });
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<cat.Banner>>(
      stream: widget.repo.banners(),
      builder: (context, snap) {
        final banners = snap.data ?? const <cat.Banner>[];
        if (banners.isEmpty) return const SizedBox.shrink();
        _autoScroll(banners.length);
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.x20),
              child: AspectRatio(
                aspectRatio: 1672 / 941,
                child: PageView.builder(
                  controller: _controller,
                  itemCount: banners.length,
                  onPageChanged: (i) => setState(() => _index = i),
                  itemBuilder: (context, i) => ClipRRect(
                    borderRadius: BorderRadius.circular(AppRadii.hero),
                    child: Image.network(banners[i].imageUrl,
                        fit: BoxFit.cover,
                        errorBuilder: (_, _, _) =>
                            const ColoredBox(color: AppColors.bgMuted)),
                  ),
                ),
              ),
            ),
            if (banners.length > 1) ...[
              const SizedBox(height: AppSpacing.x12),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (var i = 0; i < banners.length; i++) ...[
                    if (i > 0) const SizedBox(width: 2),
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 250),
                      width: i == _index ? 22 : 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: i == _index
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
      },
    );
  }
}

// ── Section header ──────────────────────────────────────────────────
class _SectionHeader extends StatelessWidget {
  const _SectionHeader(
      {required this.title, required this.source, this.listTitle, this.badge});
  final String title;
  final String source; // 'all' | 'flash' | 'arrivals'

  /// Title for the pushed listing when it differs from the rail's own heading
  /// (Flash sale's "See all" opens the whole catalogue, not just the rail).
  final String? listTitle;

  /// Optional pill shown right after the title (the Flash sale countdown).
  final Widget? badge;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.x20),
      child: Row(
        children: [
          Flexible(
            child: Text(title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppType.headingLarge
                    .copyWith(fontSize: 18, fontWeight: FontWeight.w800)),
          ),
          if (badge != null) ...[
            const SizedBox(width: AppSpacing.x10),
            badge!,
          ],
          const Spacer(),
          const SizedBox(width: AppSpacing.x12),
          GestureDetector(
            onTap: () => context.push(Routes.productList,
                extra: {'title': listTitle ?? title, 'source': source}),
            child: Text('See all',
                style: AppType.bodyMedium.copyWith(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.brandGreen)),
          ),
        ],
      ),
    );
  }
}

// ── Horizontal rail (Flash sale) ────────────────────────────────────
class _Rail extends StatelessWidget {
  const _Rail(
      {required this.title,
      required this.products,
      required this.source,
      this.badge});
  final String title;
  final List<Product> products;
  final String source;
  final Widget? badge;
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionHeader(title: title, source: source, badge: badge),
        const SizedBox(height: AppSpacing.x12),
        SizedBox(
          height: 250,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.x20),
            itemCount: products.length,
            separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.x12),
            itemBuilder: (context, i) => SizedBox(
              width: 160,
              child: ProductCard(
                product: products[i],
                onTap: () => context.push('${Routes.product}/${products[i].id}',
                    extra: products[i]),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

// ── 2-column grid (New arrivals) ────────────────────────────────────
class _Grid extends StatelessWidget {
  const _Grid(
      {required this.title,
      required this.products,
      required this.source,
      this.listTitle});
  final String title;
  final List<Product> products;
  final String source;
  final String? listTitle;
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionHeader(title: title, source: source, listTitle: listTitle),
        const SizedBox(height: AppSpacing.x12),
        if (products.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.x20),
            child: AppEmptyState(
              icon: Icons.storefront_outlined,
              title: 'No new arrivals',
              subtitle: 'Nothing new in the last few days — browse the full collection instead.',
            ),
          )
        else
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.x20),
            child: GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: products.length,
              // Responsive: columns adapt to width (2 on phones, 3–4 on tablets)
              // and each tile has a fixed height the card fills — no overflow.
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                maxCrossAxisExtent: 210,
                crossAxisSpacing: AppSpacing.x14,
                mainAxisSpacing: AppSpacing.x14,
                mainAxisExtent: 252,
              ),
              itemBuilder: (context, i) => ProductCard(
                product: products[i],
                onTap: () => context.push('${Routes.product}/${products[i].id}',
                    extra: products[i]),
              ),
            ),
          ),
      ],
    );
  }
}

// ── Flash sale countdown pill ───────────────────────────────────────
/// The `02 : 14 : 09` pill in the Flash sale heading.
///
/// PRODUCTION: pass the admin sale's [endsAt] — every device counts down to the
/// same instant, and at 00:00:00 the sale is over (the rail clears once the
/// products lose their flash flag / the sale ends).
///
/// DEMO ([endsAt] null — no admin schedule yet): start from 2h30m, and whenever
/// it reaches zero reset back to 2h30m and keep going, so the heading always has
/// a live timer. Restarts from 2h30m every time the screen is (re)built, i.e.
/// on reopening the app. A stand-in until flash sales are admin-scheduled.
class _CountdownPill extends StatefulWidget {
  const _CountdownPill({this.endsAt});
  final DateTime? endsAt;

  @override
  State<_CountdownPill> createState() => _CountdownPillState();
}

class _CountdownPillState extends State<_CountdownPill> {
  static const _demoWindow = Duration(hours: 2, minutes: 30);
  Timer? _timer;
  late DateTime _target;
  late Duration _remaining;

  bool get _demo => widget.endsAt == null;

  @override
  void initState() {
    super.initState();
    _resetTarget();
    _remaining = _computeRemaining();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  @override
  void didUpdateWidget(covariant _CountdownPill old) {
    super.didUpdateWidget(old);
    // The admin sale end time arrived (or changed) — recount to it.
    if (old.endsAt != widget.endsAt) {
      _resetTarget();
      setState(() => _remaining = _computeRemaining());
    }
  }

  void _resetTarget() =>
      _target = _demo ? DateTime.now().add(_demoWindow) : widget.endsAt!;

  Duration _computeRemaining() {
    final rem = _target.difference(DateTime.now());
    return rem.isNegative ? Duration.zero : rem;
  }

  void _tick() {
    var rem = _computeRemaining();
    // Demo mode loops; a real sale simply holds at 00:00:00 (it has ended).
    if (rem == Duration.zero && _demo) {
      _resetTarget();
      rem = _demoWindow;
    }
    if (mounted) setState(() => _remaining = rem);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    String two(int n) => n.toString().padLeft(2, '0');
    final h = two(_remaining.inHours);
    final m = two(_remaining.inMinutes % 60);
    final s = two(_remaining.inSeconds % 60);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.statusErrorRed,
        borderRadius: BorderRadius.circular(AppRadii.control),
      ),
      child: Text('$h : $m : $s',
          style: AppType.bodySmall.copyWith(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.4,
              color: Colors.white)),
    );
  }
}

class _RailSkeleton extends StatelessWidget {
  const _RailSkeleton();
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 250,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.x20),
        itemCount: 3,
        separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.x12),
        itemBuilder: (_, _) => const SizedBox(
          width: 160,
          child: AppShimmer(height: 240, radius: AppRadii.field),
        ),
      ),
    );
  }
}
