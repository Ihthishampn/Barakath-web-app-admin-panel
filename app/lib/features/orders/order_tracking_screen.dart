import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import 'data/order.dart';
import 'data/orders_repository.dart';
import 'order_common.dart';

/// Screen — Track Order (Figma node 46:7177). A vertical milestone timeline
/// (confirmed → packed → out for delivery → delivered) with done/active/pending
/// nodes, driven by the live order status + timeline timestamps.
class OrderTrackingScreen extends StatefulWidget {
  const OrderTrackingScreen({super.key, required this.orderId});
  final String orderId;

  @override
  State<OrderTrackingScreen> createState() => _OrderTrackingScreenState();
}

class _OrderTrackingScreenState extends State<OrderTrackingScreen> {
  final _repo = OrdersRepository();
  // Cache the live streams so the subscription is created once and stays open —
  // any admin status change flows straight into these listeners in real time.
  late final Stream<Order?> _orderStream = _repo.watchOrder(widget.orderId);
  late final Stream<List<OrderTimelineEntry>> _timelineStream =
      _repo.watchTimeline(widget.orderId);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surfaceBackground,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const OrderTopBar(title: 'Track order'),
            Expanded(
              child: StreamBuilder<Order?>(
                stream: _orderStream,
                builder: (context, orderSnap) {
                  if (orderSnap.hasError) {
                    return const AppErrorState(
                        message: "Couldn't load tracking.");
                  }
                  final order = orderSnap.data;
                  if (order == null) {
                    return orderSnap.connectionState == ConnectionState.waiting
                        ? const Padding(
                            padding: EdgeInsets.all(AppSpacing.x20),
                            child: AppShimmer(height: 300, radius: AppRadii.card))
                        : const AppEmptyState(
                            icon: Icons.local_shipping_outlined,
                            title: 'Order not found');
                  }
                  return StreamBuilder<List<OrderTimelineEntry>>(
                    stream: _timelineStream,
                    builder: (context, tlSnap) {
                      final timeline = tlSnap.data ?? const <OrderTimelineEntry>[];
                      return _Timeline(order: order, timeline: timeline);
                    },
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

int _rank(OrderStatus s) => switch (s) {
      OrderStatus.accepted => 0,
      OrderStatus.packing => 1,
      OrderStatus.packed => 2,
      OrderStatus.shipped => 3,
      OrderStatus.outForDelivery => 4,
      OrderStatus.delivered => 5,
      _ => -1,
    };

class _Milestone {
  const _Milestone(this.label, this.status, this.rank);
  final String label;
  final OrderStatus status;
  final int rank;
}

// The full state machine, mirroring the admin panel timeline one-for-one.
const _milestones = <_Milestone>[
  _Milestone('Accepted', OrderStatus.accepted, 0),
  _Milestone('Packing', OrderStatus.packing, 1),
  _Milestone('Packed', OrderStatus.packed, 2),
  _Milestone('Shipped', OrderStatus.shipped, 3),
  _Milestone('Out for delivery', OrderStatus.outForDelivery, 4),
  _Milestone('Delivered', OrderStatus.delivered, 5),
];

class _Timeline extends StatelessWidget {
  const _Timeline({required this.order, required this.timeline});
  final Order order;
  final List<OrderTimelineEntry> timeline;

  DateTime? _timeFor(OrderStatus s) {
    for (final e in timeline) {
      if (e.status == s && e.at != null) return e.at;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    if (order.status == OrderStatus.cancelled) {
      return const AppEmptyState(
        icon: Icons.cancel_outlined,
        title: 'Order cancelled',
        subtitle: 'This order was cancelled and is no longer in transit.',
        iconTint: AppColors.textSecondary,
        iconBg: AppColors.bgMuted,
      );
    }
    final orderRank = _rank(order.status);
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x24, AppSpacing.x12, AppSpacing.x24, AppSpacing.x24),
      children: [
        for (var i = 0; i < _milestones.length; i++)
          _node(i, orderRank),
      ],
    );
  }

  Widget _node(int i, int orderRank) {
    final m = _milestones[i];
    final isLast = i == _milestones.length - 1;
    final nextRank = isLast ? 999 : _milestones[i + 1].rank;

    final completed = orderRank >= nextRank || (m.rank == 5 && orderRank >= 5);
    final active = !completed && orderRank >= m.rank;
    final pending = orderRank < m.rank;

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              _dot(completed: completed, active: active),
              if (!isLast)
                Expanded(
                  child: Container(
                    width: 2,
                    color: completed ? AppColors.brandGreen : AppColors.borderSubtle,
                  ),
                ),
            ],
          ),
          const SizedBox(width: AppSpacing.x16),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : AppSpacing.x24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(m.label,
                      style: AppType.bodyLarge.copyWith(
                          fontWeight: FontWeight.w800,
                          color: pending
                              ? AppColors.textTertiary
                              : active
                                  ? AppColors.brandGreen
                                  : AppColors.textPrimary)),
                  const SizedBox(height: 3),
                  Text(_subtitle(m, completed: completed, active: active),
                      style: AppType.bodySmall.copyWith(
                          color: pending
                              ? AppColors.textTertiary
                              : AppColors.textSecondary)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _dot({required bool completed, required bool active}) {
    if (completed) {
      return Container(
        width: 26,
        height: 26,
        decoration: const BoxDecoration(
            color: AppColors.brandGreen, shape: BoxShape.circle),
        child: const Icon(Icons.check_rounded, size: 15, color: Colors.white),
      );
    }
    if (active) {
      return Container(
        width: 26,
        height: 26,
        decoration: BoxDecoration(
          color: AppColors.brandGreen,
          shape: BoxShape.circle,
          border: Border.all(
              color: AppColors.brandGreen.withValues(alpha: 0.25), width: 4),
        ),
      );
    }
    return Container(
      width: 26,
      height: 26,
      decoration: BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.borderSubtle, width: 2),
      ),
    );
  }

  String _subtitle(_Milestone m, {required bool completed, required bool active}) {
    // Every reached state shows its own timestamp from the timeline, exactly
    // like the admin panel (delivered also falls back to the stamped field).
    final t = m.status == OrderStatus.delivered
        ? (order.deliveredAt ?? _timeFor(OrderStatus.delivered))
        : _timeFor(m.status);
    if (t != null) return _fmtStamp(t);

    // Not reached yet → helpful estimates instead of a timestamp. A past-due
    // open order never shows a stale "arriving <past date>" — it's running late.
    if (m.status == OrderStatus.delivered) {
      return order.isDelayed
          ? 'Delayed · taking longer than expected'
          : 'Estimated ${_arrival(order.expectedDeliveryDate)}';
    }
    if (m.status == OrderStatus.outForDelivery && active) {
      final rider = order.riderName;
      final head = (rider != null && rider.isNotEmpty) ? 'Rider $rider · ' : '';
      return order.isDelayed
          ? '${head}running late'
          : '${head}arriving ${_arrivalShort(order.expectedDeliveryDate)}';
    }
    return active ? 'In progress' : (completed ? 'Done' : 'Pending');
  }
}

// ── date helpers ─────────────────────────────────────────────────────
/// Absolute stamp matching the admin timeline, e.g. "22 Jul, 10:09".
String _fmtStamp(DateTime d) => DateFormat('d MMM, HH:mm').format(d);

String _arrival(DateTime? d) {
  if (d == null) return 'soon';
  final now = DateTime.now();
  final days = DateTime(d.year, d.month, d.day)
      .difference(DateTime(now.year, now.month, now.day))
      .inDays;
  if (days <= 0) return 'today';
  if (days == 1) return 'tomorrow';
  return DateFormat('EEE, d MMM').format(d);
}

String _arrivalShort(DateTime? d) {
  if (d == null) return 'soon';
  final now = DateTime.now();
  final days = DateTime(d.year, d.month, d.day)
      .difference(DateTime(now.year, now.month, now.day))
      .inDays;
  if (days <= 0) return 'today';
  if (days == 1) return 'tomorrow';
  return DateFormat('d MMM').format(d);
}
