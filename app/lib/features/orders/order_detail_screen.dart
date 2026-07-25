import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/router/app_router.dart';
import '../../core/services/auth_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_dialog.dart';
import '../../core/widgets/app_medallion.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import '../../core/widgets/app_toast.dart';
import '../catalog/data/review.dart';
import '../catalog/data/reviews_repository.dart';
import '../catalog/write_review_sheet.dart';
import 'data/order.dart';
import 'data/orders_repository.dart';
import 'data/return_request.dart';
import 'order_common.dart';

/// Screen — Order Detail (Figma node 291:1966). Status banner + items + payment
/// summary, with Invoice and (context) Return / Cancel actions.
class OrderDetailScreen extends StatefulWidget {
  const OrderDetailScreen({super.key, required this.orderId, this.initial});
  final String orderId;
  final Order? initial;

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  final _repo = OrdersRepository();

  /// Reviews live in the catalog feature (shared `reviews` collection), but the
  /// only place a review may be WRITTEN is a delivered order — hence here.
  final _reviewsRepo = ReviewsRepository();
  bool _cancelling = false;

  /// Admin-configured return window. Seeded with the server's default so the
  /// first frame matches what the callable would accept, then refreshed from
  /// `settings/returns` (a one-shot read — the setting changes rarely).
  int _returnWindowDays = Order.defaultReturnWindowDays;

  @override
  void initState() {
    super.initState();
    _repo.fetchReturnWindowDays().then((days) {
      if (mounted) setState(() => _returnWindowDays = days);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surfaceBackground,
      body: SafeArea(
        bottom: false,
        child: StreamBuilder<Order?>(
          stream: _repo.watchOrder(widget.orderId),
          initialData: widget.initial,
          builder: (context, snap) {
            if (snap.hasError) {
              return const Column(children: [
                OrderTopBar(title: 'Order', titleSize: 22),
                Expanded(
                    child: AppErrorState(
                        message: "Couldn't load this order.")),
              ]);
            }
            final order = snap.data;
            if (order == null) {
              return Column(children: [
                const OrderTopBar(title: 'Order', titleSize: 22),
                Expanded(
                    child: snap.connectionState == ConnectionState.waiting
                        ? const _DetailSkeleton()
                        : const AppEmptyState(
                            icon: Icons.receipt_long_outlined,
                            title: 'Order not found',
                          )),
              ]);
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                OrderTopBar(title: 'Order ${order.shortId}', titleSize: 22),
                Expanded(
                  child: StreamBuilder<List<OrderItem>>(
                    stream: _repo.watchItems(order.id),
                    builder: (context, itemsSnap) {
                      final items = itemsSnap.data ?? const <OrderItem>[];
                      return ListView(
                        padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                            AppSpacing.x4, AppSpacing.x20, AppSpacing.x24),
                        children: [
                          _StatusBanner(order: order),
                          const SizedBox(height: AppSpacing.x16),
                          _ItemsCard(
                            items: items,
                            loading: !itemsSnap.hasData,
                            order: order,
                            reviewsRepo: _reviewsRepo,
                          ),
                          _ReturnsSection(orderId: order.id, repo: _repo),
                          const SizedBox(height: AppSpacing.x16),
                          _PaymentCard(order: order),
                          const SizedBox(height: AppSpacing.x20),
                          _actions(order, items),
                        ],
                      );
                    },
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _actions(Order order, List<OrderItem> items) {
    // Unpaid online order — finish paying it, or cancel it. Pay now reopens the
    // gateway for THIS order (resume mode), so no second order is placed and no
    // stock/wallet moves again; what's due is the total less any wallet already
    // applied (mirrors web's `duePaise`). Cancel releases the held stock + coupon
    // and marks the order cancelled (nothing was captured, so nothing refunds).
    if (order.status.isAwaitingPayment) {
      final due =
          (order.totalPaise - order.walletUsedPaise).clamp(0, order.totalPaise);
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AppButton.reward(
            label: 'Pay ${Money.fromPaise(due)} now',
            onPressed: () => context.push(Routes.payment, extra: {
              'orderId': order.id,
              'shortId': order.shortId,
              'payablePaise': due,
            }),
          ),
          const SizedBox(height: AppSpacing.x12),
          AppButton.destructiveOutlined(
            label: 'Cancel order',
            loading: _cancelling,
            onPressed: () => _cancel(order),
          ),
        ],
      );
    }

    final invoice = Expanded(
      child: AppButton.outlined(
        label: 'Invoice',
        onPressed: () => context.push('${Routes.invoice}/${order.id}'),
      ),
    );

    Widget? right;
    if (order.canReturn(windowDays: _returnWindowDays)) {
      final eligible = items.where((i) => !i.hasActiveReturn).toList();
      right = Expanded(
        child: AppButton.destructiveOutlined(
          label: 'Return item',
          onPressed: eligible.isEmpty
              ? null
              : () => _startReturn(order, eligible),
        ),
      );
    } else if (order.status.isCancellable) {
      right = Expanded(
        child: AppButton.destructiveOutlined(
          label: 'Cancel order',
          loading: _cancelling,
          onPressed: () => _cancel(order),
        ),
      );
    }

    return Row(children: [
      invoice,
      if (right != null) ...[const SizedBox(width: AppSpacing.x12), right],
    ]);
  }

  void _startReturn(Order order, List<OrderItem> eligible) {
    if (eligible.length == 1) {
      _pushReturn(order, eligible.first);
      return;
    }
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius:
            BorderRadius.vertical(top: Radius.circular(AppRadii.sheet)),
      ),
      builder: (sheetCtx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                  AppSpacing.x20, AppSpacing.x20, AppSpacing.x8),
              child: Text('Which item?',
                  style: AppType.headingLarge
                      .copyWith(fontSize: 18, fontWeight: FontWeight.w800)),
            ),
            for (final it in eligible)
              ListTile(
                leading: OrderThumb(
                    imageUrl: it.imageUrl, tint: it.categoryTint, size: 44),
                title: Text(it.title,
                    maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text('Qty ${it.quantity}'),
                onTap: () {
                  Navigator.of(sheetCtx).pop();
                  _pushReturn(order, it);
                },
              ),
            const SizedBox(height: AppSpacing.x12),
          ],
        ),
      ),
    );
  }

  void _pushReturn(Order order, OrderItem item) {
    context.push(Routes.returnRequest, extra: {
      'orderId': order.id,
      'item': item,
    });
  }

  Future<void> _cancel(Order order) async {
    final ok = await AppDialog.show<bool>(
      context,
      dialog: Builder(
        builder: (ctx) => AppDialog(
          medallion: AppMedallionVariant.destructiveIconed,
          title: 'Cancel this order?',
          body:
              'Any amount paid is refunded to your wallet. This cannot be undone.',
          primaryLabel: 'Cancel order',
          primaryVariant: AppButtonVariant.destructive,
          onPrimary: () => Navigator.of(ctx).pop(true),
          secondaryLabel: 'Keep order',
          onSecondary: () => Navigator.of(ctx).pop(false),
        ),
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _cancelling = true);
    try {
      await _repo.cancelOrder(order.id);
      if (mounted) {
        AppToast.show(context, 'Order cancelled — refund on its way.',
            variant: AppToastVariant.success);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _cancelling = false);
        AppToast.show(context, "Couldn't cancel this order.",
            variant: AppToastVariant.error);
      }
    }
  }
}

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({required this.order});
  final Order order;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = order.status.badgeColors;
    // An unpaid order has no timeline to track yet — it isn't accepted until the
    // payment is confirmed.
    final trackable = order.status.isOpen && !order.status.isAwaitingPayment;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.x16),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(AppRadii.card),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
                color: fg, borderRadius: BorderRadius.circular(AppRadii.control)),
            child: Icon(_icon(order.status), size: 20, color: Colors.white),
          ),
          const SizedBox(width: AppSpacing.x12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(order.isDelayed ? 'Delivery delayed' : order.status.label,
                    style: AppType.bodyLarge.copyWith(
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary)),
                const SizedBox(height: 2),
                Text(_subtitle(order),
                    style: AppType.bodySmall
                        .copyWith(color: fg, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
          if (trackable) ...[
            const SizedBox(width: AppSpacing.x8),
            GestureDetector(
              onTap: () =>
                  context.push('${Routes.orderTracking}/${order.id}'),
              behavior: HitTestBehavior.opaque,
              child: Text('Track',
                  style: AppType.bodyMedium.copyWith(
                      fontWeight: FontWeight.w800, color: AppColors.brandGreen)),
            ),
          ],
        ],
      ),
    );
  }

  IconData _icon(OrderStatus s) => switch (s) {
        OrderStatus.delivered => Icons.check_rounded,
        OrderStatus.cancelled => Icons.close_rounded,
        OrderStatus.shipped ||
        OrderStatus.outForDelivery =>
          Icons.local_shipping_rounded,
        OrderStatus.packing || OrderStatus.packed => Icons.inventory_2_rounded,
        _ => Icons.receipt_long_rounded,
      };

  String _subtitle(Order o) {
    // Unpaid online order — never an ETA (it isn't accepted yet). Point at the
    // Pay now button below; call out an actual failure so a retry makes sense.
    if (o.status.isAwaitingPayment) {
      return o.paymentStatus == 'failed'
          ? 'Payment failed — tap Pay now to confirm your order.'
          : 'Complete payment to confirm your order.';
    }
    // A past-due open order never shows a stale "arriving <past date>" — say
    // it's running late instead, like Amazon/Flipkart do.
    if (o.isDelayed) return 'Your order is taking longer than expected.';
    switch (o.status) {
      case OrderStatus.delivered:
        return o.deliveredAt != null
            ? 'Delivered on ${_fmtDate(o.deliveredAt!)}'
            : 'Delivered';
      case OrderStatus.cancelled:
        return o.cancellationReason?.isNotEmpty == true
            ? o.cancellationReason!
            : 'Order cancelled';
      case OrderStatus.outForDelivery:
        return 'Arriving ${_arrival(o.expectedDeliveryDate)}';
      case OrderStatus.shipped:
        return 'Shipped · arriving ${_arrival(o.expectedDeliveryDate)}';
      default:
        return 'Arriving by ${_arrival(o.expectedDeliveryDate)}';
    }
  }
}

class _ItemsCard extends StatelessWidget {
  const _ItemsCard({
    required this.items,
    required this.loading,
    required this.order,
    required this.reviewsRepo,
  });
  final List<OrderItem> items;
  final bool loading;
  final Order order;
  final ReviewsRepository reviewsRepo;

  @override
  Widget build(BuildContext context) {
    if (loading && items.isEmpty) {
      return const AppShimmer(height: 150, radius: AppRadii.card);
    }
    final uid = context.watch<AuthProvider>().uid;
    // A review is offered only once the goods are actually in the customer's
    // hands. That is the same moment the server writes the
    // `customers/{uid}/purchases/{productId}` record the rules require, so any
    // other state would be an affordance whose write is guaranteed to fail.
    final canReview = uid != null && order.status == OrderStatus.delivered;

    return StreamBuilder<List<Review>>(
      // One customer-scoped query answers "already reviewed?" for every line
      // item at once; it is filtered down to this order's products below.
      stream: canReview ? reviewsRepo.watchAllMine(uid) : const Stream.empty(),
      builder: (context, snap) {
        // Newest first from the repo, so the first hit per product wins — a
        // rejected old review shouldn't mask a fresh pending one.
        final mine = <String, Review>{};
        for (final r in snap.data ?? const <Review>[]) {
          mine.putIfAbsent(r.productId, () => r);
        }
        return Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppRadii.card),
            border: Border.all(color: AppColors.borderSubtle),
          ),
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.x16),
          child: Column(
            children: [
              for (var i = 0; i < items.length; i++) ...[
                _row(
                  context,
                  items[i],
                  // Waiting on the first snapshot: show nothing rather than a
                  // "Write a review" that flips to "Pending approval".
                  showReview: canReview && snap.hasData,
                  existing: mine[items[i].productId],
                  uid: uid,
                ),
                if (i < items.length - 1)
                  const Divider(
                      height: 1, thickness: 1, color: AppColors.borderSubtle),
              ],
            ],
          ),
        );
      },
    );
  }

  Widget _row(
    BuildContext context,
    OrderItem it, {
    required bool showReview,
    required Review? existing,
    required String? uid,
  }) {
    final sub = [
      if ((it.variantLabel ?? '').isNotEmpty) it.variantLabel!,
      'Qty ${it.quantity}',
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.x14),
      child: Row(
        children: [
          OrderThumb(imageUrl: it.imageUrl, tint: it.categoryTint, size: 56),
          const SizedBox(width: AppSpacing.x12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(it.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppType.bodyMedium.copyWith(
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary)),
                const SizedBox(height: 2),
                Text(sub,
                    style: AppType.bodySmall
                        .copyWith(color: AppColors.textSecondary)),
                // Return status is shown authoritatively in the dedicated
                // "Return status" card below (from orderRequests), so no
                // per-item badge here — it would go stale on the order item.
                //
                // Review action. `productId` can be empty on very old line
                // items, and a review without one is meaningless (and unwritable
                // — the rules look the product up by id), so skip those.
                if (showReview && it.productId.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.x8),
                  if (existing != null)
                    // Already reviewed — show where it stands instead of
                    // inviting a duplicate the customer can't publish.
                    ReviewStatusChip(status: existing.status)
                  else
                    GestureDetector(
                      onTap: () => showWriteReviewSheet(
                        context,
                        productId: it.productId,
                        orderId: order.id,
                        uid: uid!,
                        repo: reviewsRepo,
                        productTitle: it.title,
                      ),
                      behavior: HitTestBehavior.opaque,
                      child: Text('Write a review',
                          style: AppType.bodySmall.copyWith(
                              fontWeight: FontWeight.w800,
                              color: AppColors.brandGreen)),
                    ),
                ],
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.x8),
          Text(Money.fromPaise(it.lineTotalPaise),
              style: AppType.bodyMedium.copyWith(
                  fontWeight: FontWeight.w800,
                  color: AppColors.brandGoldStrong)),
        ],
      ),
    );
  }
}

class _PaymentCard extends StatelessWidget {
  const _PaymentCard({required this.order});
  final Order order;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.x16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.card),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      child: Column(
        children: [
          _row('Paid via ${_method(order)}', Money.fromPaise(order.paidPaise)),
          if (order.discountsExWalletPaise > 0) ...[
            const SizedBox(height: AppSpacing.x10),
            _row('Discounts applied',
                '−${Money.fromPaise(order.discountsExWalletPaise)}',
                valueColor: AppColors.brandGreen),
          ],
          if (order.walletUsedPaise > 0) ...[
            const SizedBox(height: AppSpacing.x10),
            _row('Wallet amount used',
                Money.fromPaise(order.walletUsedPaise)),
          ],
        ],
      ),
    );
  }

  /// 'cod' is deliberately still handled: the method can no longer be chosen,
  /// but orders placed before it was withdrawn were paid that way and must not
  /// suddenly read as a generic "Payment".
  String _method(Order o) {
    final base = switch (o.paymentMethod) {
      'razorpay' => 'Razorpay',
      'cod' => 'Cash on delivery',
      'wallet' => 'Wallet',
      _ => 'Payment',
    };
    return o.walletUsedPaise > 0 && o.paymentMethod != 'wallet'
        ? '$base + Wallet'
        : base;
  }

  Widget _row(String label, String value, {Color? valueColor}) {
    return Row(
      children: [
        Expanded(
          child: Text(label,
              style: AppType.bodyMedium.copyWith(color: AppColors.textSecondary)),
        ),
        Text(value,
            style: AppType.bodyMedium.copyWith(
                fontWeight: FontWeight.w800,
                color: valueColor ?? AppColors.textPrimary)),
      ],
    );
  }
}

class _DetailSkeleton extends StatelessWidget {
  const _DetailSkeleton();
  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x24),
      children: const [
        AppShimmer(height: 72, radius: AppRadii.card),
        SizedBox(height: AppSpacing.x16),
        AppShimmer(height: 150, radius: AppRadii.card),
        SizedBox(height: AppSpacing.x16),
        AppShimmer(height: 72, radius: AppRadii.card),
      ],
    );
  }
}

// ── Return status + timeline ─────────────────────────────────────────
class _ReturnsSection extends StatelessWidget {
  const _ReturnsSection({required this.orderId, required this.repo});
  final String orderId;
  final OrdersRepository repo;

  @override
  Widget build(BuildContext context) {
    final uid = context.watch<AuthProvider>().uid;
    if (uid == null) return const SizedBox.shrink();
    return StreamBuilder<List<ReturnRequest>>(
      stream: repo.watchReturnsForOrder(uid, orderId),
      builder: (context, snap) {
        final returns = snap.data ?? const <ReturnRequest>[];
        if (returns.isEmpty) return const SizedBox.shrink();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: AppSpacing.x16),
            Text('Return status',
                style: AppType.bodyLarge.copyWith(
                    fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
            const SizedBox(height: AppSpacing.x12),
            for (var i = 0; i < returns.length; i++) ...[
              _ReturnCard(request: returns[i]),
              if (i < returns.length - 1)
                const SizedBox(height: AppSpacing.x12),
            ],
          ],
        );
      },
    );
  }
}

class _ReturnCard extends StatelessWidget {
  const _ReturnCard({required this.request});
  final ReturnRequest request;

  @override
  Widget build(BuildContext context) {
    final r = request;
    final refund = Money.fromPaise(r.refundAmountPaise);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.x16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.card),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('Return ${r.shortId}',
                    style: AppType.bodyMedium.copyWith(
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary)),
              ),
              _ReturnStatusChip(request: r),
            ],
          ),
          const SizedBox(height: 6),
          Text('${r.productName} · ${r.reasonLabel}',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppType.bodySmall.copyWith(color: AppColors.textSecondary)),
          const SizedBox(height: AppSpacing.x12),
          // Refund line — reflects the real outcome. An approval only moves
          // money when the admin's "Auto-refund to wallet" is on; with it off
          // the server records the refund as 'gateway' with no `refundedAt`,
          // and it is paid out by hand to the original payment method.
          if (r.isApproved && r.isRefundedToWallet)
            _refundLine('$refund refunded to your wallet',
                AppColors.brandGreen, Icons.check_circle_rounded)
          else if (r.isApproved)
            _refundLine(
                '$refund approved · will be refunded to your original payment method',
                AppColors.brandGreen,
                Icons.check_circle_rounded)
          else if (r.isRejected)
            _refundLine(r.rejectionReason ?? 'Return not approved',
                AppColors.statusErrorRed, Icons.cancel_rounded)
          else
            _refundLine('$refund will be credited to your wallet once approved',
                AppColors.sky700, Icons.schedule_rounded),
          if (r.timeline.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.x14),
            const Divider(height: 1, color: AppColors.borderSubtle),
            const SizedBox(height: AppSpacing.x12),
            for (var i = 0; i < r.timeline.length; i++)
              _timelineRow(r.timeline[i], last: i == r.timeline.length - 1),
          ],
        ],
      ),
    );
  }

  Widget _refundLine(String text, Color color, IconData icon) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: AppSpacing.x8),
        Expanded(
          child: Text(text,
              style: AppType.bodySmall.copyWith(
                  height: 1.4, fontWeight: FontWeight.w600, color: color)),
        ),
      ],
    );
  }

  Widget _timelineRow(ReturnEvent e, {required bool last}) {
    final label = switch (e.status) {
      'pending' => 'Requested',
      'under_review' => 'Under review',
      // Same caveat as the refund line: "refund issued" is only true once the
      // wallet credit actually happened.
      'approved' => request.isRefundedToWallet
          ? 'Approved · refund issued'
          : 'Approved · refund pending',
      'completed' => 'Completed',
      'rejected' => 'Rejected',
      'cancelled' => 'Cancelled',
      _ => e.status,
    };
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Container(
                width: 8,
                height: 8,
                margin: const EdgeInsets.only(top: 4),
                decoration: const BoxDecoration(
                    color: AppColors.brandGreen, shape: BoxShape.circle),
              ),
              if (!last)
                Expanded(
                  child: Container(
                      width: 1.5,
                      color: AppColors.borderSubtle,
                      margin: const EdgeInsets.symmetric(vertical: 2)),
                ),
            ],
          ),
          const SizedBox(width: AppSpacing.x12),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: last ? 0 : AppSpacing.x12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label,
                      style: AppType.bodySmall.copyWith(
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary)),
                  if (e.note != null)
                    Text(e.note!,
                        style: AppType.bodySmall
                            .copyWith(color: AppColors.textSecondary)),
                  if (e.at != null)
                    Text(DateFormat('d MMM, HH:mm').format(e.at!),
                        style: AppType.bodySmall.copyWith(
                            fontSize: 11, color: AppColors.textTertiary)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ReturnStatusChip extends StatelessWidget {
  const _ReturnStatusChip({required this.request});
  final ReturnRequest request;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, label) = request.isApproved
        ? (AppColors.brandGreenSubtle, AppColors.brandGreen, 'Approved')
        : request.isRejected
            ? (
                AppColors.statusErrorRed.withValues(alpha: 0.12),
                AppColors.statusErrorRed,
                'Rejected'
              )
            : (AppColors.sky100, AppColors.sky700, 'Under review');
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration:
          BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Text(label,
          style: AppType.bodySmall.copyWith(
              fontSize: 11, fontWeight: FontWeight.w800, color: fg)),
    );
  }
}

// ── shared date helpers ──────────────────────────────────────────────
String _fmtDate(DateTime d) => DateFormat('EEE, d MMM').format(d);

/// "tomorrow" / "today" / "on Tue, 22 Jul" from an expected-delivery date.
String _arrival(DateTime? d) {
  if (d == null) return 'soon';
  final now = DateTime.now();
  final days = DateTime(d.year, d.month, d.day)
      .difference(DateTime(now.year, now.month, now.day))
      .inDays;
  if (days <= 0) return 'today';
  if (days == 1) return 'tomorrow';
  return 'by ${_fmtDate(d)}';
}
