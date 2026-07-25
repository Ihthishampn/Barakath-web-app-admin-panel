import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/router/app_router.dart';
import '../../core/services/auth_provider.dart';
import '../../core/services/cart_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import '../../core/widgets/app_toast.dart';
import '../cart/data/cart_line.dart';
import 'data/order.dart';
import 'data/orders_repository.dart';
import 'order_common.dart';

/// Screen — My Orders (Figma node 46:7022). Filter tabs + a live list of the
/// customer's orders. Tapping an order opens its detail; per-status quick action
/// (Track / Reorder / refund note).
class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

enum _Filter { all, active, delivered, cancelled }

class _OrdersScreenState extends State<OrdersScreen> {
  final _repo = OrdersRepository();
  _Filter _filter = _Filter.all;

  bool _matches(Order o) => switch (_filter) {
        _Filter.all => true,
        _Filter.active => o.status.isOpen,
        _Filter.delivered => o.status == OrderStatus.delivered,
        _Filter.cancelled => o.status == OrderStatus.cancelled,
      };

  @override
  Widget build(BuildContext context) {
    final uid = context.select<AuthProvider, String?>((a) => a.uid);
    return Scaffold(
      backgroundColor: AppColors.surfaceBackground,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const OrderTopBar(title: 'My orders'),
            _tabs(),
            const SizedBox(height: AppSpacing.x4),
            Expanded(
              child: StreamBuilder<List<Order>>(
                stream: uid == null ? null : _repo.watchOrders(uid),
                builder: (context, snap) {
                  if (snap.hasError) {
                    return const AppErrorState(
                        message: "Couldn't load your orders. Please try again.");
                  }
                  if (!snap.hasData) return const _OrdersSkeleton();
                  final orders = snap.data!.where(_matches).toList();
                  if (orders.isEmpty) {
                    return AppEmptyState(
                      icon: Icons.shopping_bag_outlined,
                      title: _filter == _Filter.all
                          ? 'No orders yet'
                          : 'Nothing here',
                      subtitle: _filter == _Filter.all
                          ? 'Your orders will show up here once you place one.'
                          : 'No orders in this filter.',
                      ctaLabel: _filter == _Filter.all ? 'Start shopping' : null,
                      onCta: _filter == _Filter.all
                          ? () => context.go(Routes.home)
                          : null,
                    );
                  }
                  return ListView.separated(
                    padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                        AppSpacing.x8, AppSpacing.x20, AppSpacing.x24),
                    itemCount: orders.length,
                    itemBuilder: (_, i) => _OrderCard(order: orders[i]),
                    separatorBuilder: (_, _) =>
                        const SizedBox(height: AppSpacing.x14),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _tabs() {
    return SizedBox(
      height: 34,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.x20),
        children: [
          for (final f in _Filter.values) ...[
            _tab(f),
            const SizedBox(width: AppSpacing.x8),
          ],
        ],
      ),
    );
  }

  Widget _tab(_Filter f) {
    const labels = {
      _Filter.all: 'All',
      _Filter.active: 'Active',
      _Filter.delivered: 'Delivered',
      _Filter.cancelled: 'Cancelled',
    };
    final selected = _filter == f;
    return GestureDetector(
      onTap: () => setState(() => _filter = f),
      child: Container(
        alignment: Alignment.center,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        decoration: BoxDecoration(
          color: selected ? AppColors.brandGreen : Colors.white,
          borderRadius: BorderRadius.circular(AppRadii.pill),
          border: Border.all(
              color: selected ? AppColors.brandGreen : AppColors.borderSubtle),
        ),
        child: Text(labels[f]!,
            style: AppType.bodyMedium.copyWith(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: selected ? Colors.white : AppColors.textPrimary)),
      ),
    );
  }
}

class _OrderCard extends StatefulWidget {
  const _OrderCard({required this.order});
  final Order order;

  @override
  State<_OrderCard> createState() => _OrderCardState();
}

class _OrderCardState extends State<_OrderCard> {
  final _repo = OrdersRepository();
  bool _reordering = false;

  Order get o => widget.order;

  Future<void> _reorder() async {
    if (_reordering) return;
    setState(() => _reordering = true);
    try {
      final items = await _repo.getItems(o.id);
      if (!mounted) return;
      if (items.isEmpty) {
        AppToast.show(context, 'These items are no longer available.',
            variant: AppToastVariant.error);
        return;
      }
      final cart = context.read<CartProvider>();
      final limit = cart.addLines([
        for (final it in items)
          CartLine(
            productId: it.productId,
            variantId: it.variantId,
            name: it.productName,
            variantLabel: it.variantLabel,
            imageUrl: it.imageUrl,
            categoryTint: it.categoryTint,
            // The price this item was BOUGHT at — which may be months old.
            // Re-priced from the live product immediately below, because
            // `placeOrder` charges the live price and every total on the way
            // there would otherwise be quoted from this historical one.
            pricePaise: it.offerPricePaise,
            mrpPaise: it.mrpPaise,
            qty: it.quantity,
          ),
      ]);
      unawaited(cart.refreshPrices());
      // A big old order can't always be restored in full — the bag caps are the
      // same ones the server enforces, so say what had to be left out instead
      // of silently short-filling the bag.
      AppToast.show(context, limit.message ?? 'Added to your bag',
          variant:
              limit.blocked ? AppToastVariant.error : AppToastVariant.success);
      context.go(Routes.bag);
    } catch (_) {
      if (mounted) {
        AppToast.show(context, "Couldn't reorder. Please try again.",
            variant: AppToastVariant.error);
      }
    } finally {
      if (mounted) setState(() => _reordering = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => context.push('${Routes.order}/${o.id}'),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.x16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(AppRadii.card),
          border: Border.all(color: AppColors.borderSubtle),
          boxShadow: const [
            BoxShadow(
                color: Color(0x0A1B1C1D), blurRadius: 4, offset: Offset(0, 2)),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(o.shortId,
                      style: AppType.bodyLarge.copyWith(
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary)),
                ),
                // Past-due open order reads "Delayed" instead of its stale
                // in-flight status, matching the detail/tracking screens.
                OrderStatusBadge(o.status, label: o.isDelayed ? 'Delayed' : null),
              ],
            ),
            const SizedBox(height: AppSpacing.x12),
            _thumbs(),
            const SizedBox(height: AppSpacing.x14),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(child: _summaryLine()),
                _action(),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _thumbs() {
    final shown = o.itemsSummary.take(3).toList();
    final extra = o.itemsCount > 0
        ? o.itemsCount - shown.fold(0, (n, s) => n + s.quantity)
        : 0;
    return Row(
      children: [
        for (final s in shown) ...[
          OrderThumb(imageUrl: s.imageUrl, tint: s.categoryTint, size: 52),
          const SizedBox(width: AppSpacing.x8),
        ],
        if (extra > 0)
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: AppColors.bgMuted,
              borderRadius: BorderRadius.circular(AppRadii.tile),
            ),
            alignment: Alignment.center,
            child: Text('+$extra',
                style: AppType.bodySmall.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.textSecondary)),
          ),
      ],
    );
  }

  Widget _summaryLine() {
    return Text.rich(
      TextSpan(
        text: '${o.itemsCount} item${o.itemsCount == 1 ? '' : 's'} · ',
        style: AppType.bodySmall.copyWith(color: AppColors.textSecondary),
        children: [
          TextSpan(
            text: Money.fromPaise(o.paidPaise),
            style: AppType.bodyMedium.copyWith(
                fontWeight: FontWeight.w800,
                color: AppColors.brandGoldStrong),
          ),
        ],
      ),
    );
  }

  Widget _action() {
    if (o.status == OrderStatus.cancelled) {
      return Text(o.wasRefunded ? 'Refunded to wallet' : 'Cancelled',
          style: AppType.bodyMedium.copyWith(
              fontWeight: FontWeight.w700,
              color: o.wasRefunded
                  ? AppColors.brandGreen
                  : AppColors.textSecondary));
    }
    if (o.status == OrderStatus.delivered) {
      return _link(_reordering ? 'Adding…' : 'Reorder',
          _reordering ? null : _reorder);
    }
    // Open / trackable order.
    return _link('Track', () => context.push('${Routes.orderTracking}/${o.id}'));
  }

  Widget _link(String label, VoidCallback? onTap) => GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Text(label,
            style: AppType.bodyMedium.copyWith(
                fontWeight: FontWeight.w800, color: AppColors.brandGreen)),
      );
}

class _OrdersSkeleton extends StatelessWidget {
  const _OrdersSkeleton();
  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x24),
      children: const [
        AppShimmer(height: 150, radius: AppRadii.card),
        SizedBox(height: AppSpacing.x14),
        AppShimmer(height: 150, radius: AppRadii.card),
        SizedBox(height: AppSpacing.x14),
        AppShimmer(height: 150, radius: AppRadii.card),
      ],
    );
  }
}
