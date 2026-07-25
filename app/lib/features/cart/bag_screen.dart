import 'dart:async';

import 'package:flutter/foundation.dart' show listEquals;
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/router/app_router.dart';
import '../../core/services/cart_provider.dart';
import '../../core/services/checkout_draft.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_quantity_stepper.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import '../../core/widgets/app_toast.dart';
import '../checkout/data/checkout_repository.dart';
import '../checkout/widgets/coupon_apply.dart';
import 'data/cart_line.dart';

/// Screen — Your bag (tab 3, Figma node 46:6449). Live from the Firestore cart
/// (`customers/{uid}.cart`) via [CartProvider] — real-time, cross-device, and
/// optimistic. Rebuilds are scoped with `Selector`/`select`: changing one line's
/// quantity repaints only that line + the totals, never the whole screen.
class BagScreen extends StatelessWidget {
  const BagScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Selector<CartProvider, int>(
            selector: (_, c) => c.count,
            builder: (_, count, _) => _header(count),
          ),
          const Expanded(child: _BagBody()),
        ],
      ),
    );
  }

  Widget _header(int count) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.baseline,
        textBaseline: TextBaseline.alphabetic,
        children: [
          Text('Your bag',
              style: AppType.headingLarge.copyWith(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.48)),
          if (count > 0) ...[
            const SizedBox(width: AppSpacing.x8),
            Text('$count item${count == 1 ? '' : 's'}',
                style: AppType.bodyMedium.copyWith(
                    fontSize: 14, color: AppColors.textTertiary)),
          ],
        ],
      ),
    );
  }
}

/// Structural body — rebuilds only when loading/error/emptiness changes, not on
/// every quantity edit.
class _BagBody extends StatelessWidget {
  const _BagBody();

  @override
  Widget build(BuildContext context) {
    return Selector<CartProvider, ({bool loading, bool error, int distinct})>(
      selector: (_, c) =>
          (loading: c.loading, error: c.hasError, distinct: c.distinctCount),
      builder: (context, s, _) {
        if (s.loading) return const _BagSkeleton();
        if (s.error) {
          return const AppErrorState(
              message: "Couldn't load your bag. Please try again.");
        }
        if (s.distinct == 0) {
          return AppEmptyState(
            icon: Icons.shopping_bag_outlined,
            title: 'Your bag is empty',
            subtitle: 'Browse products and add items to your bag.',
            ctaLabel: 'Start shopping',
            onCta: () => context.go(Routes.home),
          );
        }
        return Column(
          children: [
            Expanded(
              // Rebuilds only when a line is added/removed (keys change).
              child: Selector<CartProvider, List<String>>(
                selector: (_, c) => [for (final l in c.lines) l.key],
                shouldRebuild: (a, b) => !listEquals(a, b),
                builder: (context, keys, _) {
                  return ListView(
                    padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                        AppSpacing.x4, AppSpacing.x20, AppSpacing.x16),
                    children: [
                      for (final key in keys) ...[
                        _CartLineCard(lineKey: key),
                        const SizedBox(height: AppSpacing.x12),
                      ],
                      const CouponRewardBanner(),
                      const CouponRow(),
                      const SizedBox(height: AppSpacing.x12),
                      const _SummaryCard(),
                    ],
                  );
                },
              ),
            ),
            const _CheckoutBar(),
          ],
        );
      },
    );
  }
}

// ── One cart line — rebuilds only when THIS line changes ──────────────
class _CartLineCard extends StatelessWidget {
  const _CartLineCard({required this.lineKey});
  final String lineKey;

  @override
  Widget build(BuildContext context) {
    return Selector<CartProvider, CartLine?>(
      selector: (_, c) => c.lineFor(lineKey),
      // Rebuild only when this line's identity/qty actually changes.
      shouldRebuild: (a, b) =>
          a?.qty != b?.qty || a?.pricePaise != b?.pricePaise || (a == null) != (b == null),
      builder: (context, line, _) {
        if (line == null) return const SizedBox.shrink();
        final cart = context.read<CartProvider>();
        final tint = _hex(line.categoryTint) ?? AppColors.bgMuted;
        return Container(
          padding: const EdgeInsets.all(AppSpacing.x12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppRadii.field),
            border: Border.all(color: AppColors.borderSubtle),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(AppRadii.control),
                child: SizedBox(
                  width: 64,
                  height: 64,
                  child: line.imageUrl != null && line.imageUrl!.isNotEmpty
                      ? Image.network(line.imageUrl!,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => ColoredBox(color: tint))
                      : ColoredBox(color: tint),
                ),
              ),
              const SizedBox(width: AppSpacing.x12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(line.name,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: AppType.bodyMedium.copyWith(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.textPrimary)),
                        ),
                        GestureDetector(
                          onTap: () => cart.remove(line.key),
                          behavior: HitTestBehavior.opaque,
                          child: const Padding(
                            padding: EdgeInsets.only(left: 8),
                            child: Icon(Icons.close_rounded,
                                size: 18, color: AppColors.textTertiary),
                          ),
                        ),
                      ],
                    ),
                    if (line.variantLabel != null &&
                        line.variantLabel!.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(line.variantLabel!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppType.bodySmall
                              .copyWith(color: AppColors.textSecondary)),
                    ],
                    const SizedBox(height: AppSpacing.x10),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        AppQuantityStepper(
                          quantity: line.qty,
                          onDecrement: () => cart.decrement(line.key),
                          // A refused "+" says which cap stopped it (10 of one
                          // item, 100 units in the bag, ₹2,00,000 order value)
                          // rather than doing nothing.
                          onIncrement: () {
                            final limit = cart.increment(line.key);
                            if (limit.blocked) {
                              AppToast.show(context, limit.message!,
                                  variant: AppToastVariant.error);
                            }
                          },
                        ),
                        const Spacer(),
                        Text(Money.fromPaise(line.linePaise),
                            style: AppType.bodyLarge.copyWith(
                                fontWeight: FontWeight.w800,
                                color: AppColors.brandGoldStrong)),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

// ── Summary — rebuilds on subtotal or coupon change ──────────────────
/// The bag used to print `Delivery: Free` unconditionally and total to
/// `subtotal − discount`, omitting delivery entirely — so a bag under the
/// free-delivery threshold quoted ₹49 less than Checkout charged for the very
/// same items, and claimed free delivery it did not give. It now prices from
/// [CheckoutRepository.computeSummary], the same function Checkout uses and the
/// mirror of `summarise` in functions/src/orders/checkout.ts.
class _SummaryCard extends StatefulWidget {
  const _SummaryCard();

  @override
  State<_SummaryCard> createState() => _SummaryCardState();
}

class _SummaryCardState extends State<_SummaryCard> {
  static final _repo = CheckoutRepository();
  // Defaults mean "everything on, no fee" until the real doc lands — the same
  // starting point Checkout uses, so the two screens converge rather than
  // disagreeing for a frame.
  StoreSettings _settings = const StoreSettings();

  @override
  void initState() {
    super.initState();
    unawaited(_loadSettings());
  }

  Future<void> _loadSettings() async {
    try {
      final s = await _repo.fetchSettings();
      if (mounted) setState(() => _settings = s);
    } catch (_) {
      // Advisory only: Checkout re-reads settings and the server prices the
      // order regardless, so a failure here must not block the bag.
    }
  }

  @override
  Widget build(BuildContext context) {
    final subtotal = context.select<CartProvider, int>((c) => c.subtotalPaise);
    final coupon = context.select<CheckoutDraft, AppliedCoupon?>((d) => d.coupon);
    final summary =
        _repo.computeSummary(subtotal, _settings, coupon: coupon);
    final discount = summary.discountPaise;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.x16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      child: Column(
        children: [
          _row('Subtotal', Money.fromPaise(subtotal)),
          if (discount > 0) ...[
            const SizedBox(height: AppSpacing.x10),
            _row(coupon == null ? 'Discount' : 'Coupon (${coupon.code})',
                '−${Money.fromPaise(discount)}',
                valueColor: AppColors.brandGreen),
          ],
          const SizedBox(height: AppSpacing.x10),
          _row(
            'Delivery',
            summary.freeDelivery
                ? 'Free'
                : Money.fromPaise(summary.deliveryPaise),
            valueColor:
                summary.freeDelivery ? AppColors.brandGreen : AppColors.textPrimary,
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: AppSpacing.x12),
            child: Divider(height: 1, color: AppColors.borderSubtle),
          ),
          Row(
            children: [
              Expanded(
                child: Text('Total',
                    style: AppType.bodyLarge.copyWith(
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary)),
              ),
              Text(Money.fromPaise(summary.totalPaise),
                  style: AppType.headingLarge.copyWith(
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                      color: AppColors.brandGoldStrong)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _row(String label, String value, {Color? valueColor}) {
    return Row(
      children: [
        Expanded(
          child: Text(label,
              style: AppType.bodyMedium.copyWith(
                  fontSize: 14, color: AppColors.textSecondary)),
        ),
        Text(value,
            style: AppType.bodyMedium.copyWith(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: valueColor ?? AppColors.textPrimary)),
      ],
    );
  }
}

/// Blocks the hand-off to Checkout while anything in the bag has gone
/// unavailable — an item can sell out while the bag just sits there, and it is
/// better to say so here than to let Checkout (or `placeOrder`) reject it.
class _CheckoutBar extends StatefulWidget {
  const _CheckoutBar();

  @override
  State<_CheckoutBar> createState() => _CheckoutBarState();
}

class _CheckoutBarState extends State<_CheckoutBar> {
  static final _repo = CheckoutRepository();

  Map<String, int> _stock = const {};
  String _stockKey = '';
  StreamSubscription<Map<String, int>>? _sub;
  // Same reason as _SummaryCard: this button quoted `subtotal − discount`, i.e.
  // the total WITHOUT delivery, so it promised a figure Checkout then exceeded.
  StoreSettings _settings = const StoreSettings();

  @override
  void initState() {
    super.initState();
    unawaited(_loadSettings());
    // The bag's prices were snapshotted when each item was added (or, after a
    // Reorder, when the original order was placed) while `placeOrder` prices
    // from the live product — so re-read them before this bar quotes a total.
    // Mounted only once the bag is non-empty, which is exactly when it matters.
    unawaited(context.read<CartProvider>().refreshPrices());
  }

  Future<void> _loadSettings() async {
    try {
      final s = await _repo.fetchSettings();
      if (mounted) setState(() => _settings = s);
    } catch (_) {
      // Advisory only — Checkout re-reads settings and the server prices the
      // order, so a failure here must never disable the button.
    }
  }

  void _syncStockWatch(List<CartLine> lines) {
    final key = lines.map((l) => l.key).join(',');
    if (key == _stockKey) return;
    _stockKey = key;
    _sub?.cancel();
    _sub = null;
    if (lines.isEmpty) {
      _stock = const {};
      return;
    }
    _sub = _repo.watchLineStock(lines).listen(
      (m) {
        if (mounted) setState(() => _stock = m);
      },
      // Availability is advisory — never strand the customer on a dead button.
      onError: (_) {},
    );
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();
    final subtotal = cart.subtotalPaise;
    final coupon = context.select<CheckoutDraft, AppliedCoupon?>((d) => d.coupon);
    // Priced by the same function Checkout uses, so this button and the next
    // screen can never quote different money for the same bag.
    final total =
        _repo.computeSummary(subtotal, _settings, coupon: coupon).totalPaise;

    _syncStockWatch(cart.lines);
    // A line with no resolved stock yet is left alone rather than blocked.
    final blocked = cart.lines.any((l) {
      final available = _stock[l.key];
      return available != null && available < l.qty;
    });

    return Container(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x12, AppSpacing.x20, AppSpacing.x12),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: AppColors.borderSubtle)),
      ),
      child: AppButton.reward(
        label: blocked
            ? 'Out of stock'
            : 'Checkout · ${Money.fromPaise(total)}',
        onPressed: blocked
            ? () => AppToast.show(
                context, 'Some items are unavailable — update your bag.',
                variant: AppToastVariant.error)
            : () => context.push(Routes.checkout),
      ),
    );
  }
}

class _BagSkeleton extends StatelessWidget {
  const _BagSkeleton();
  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x16),
      children: [
        for (var i = 0; i < 3; i++)
          const Padding(
            padding: EdgeInsets.only(bottom: AppSpacing.x12),
            child: AppShimmer(height: 88, radius: AppRadii.field),
          ),
      ],
    );
  }
}

Color? _hex(String? s) {
  if (s == null || s.isEmpty) return null;
  var h = s.replaceAll('#', '').trim();
  if (h.length == 6) h = 'FF$h';
  final v = int.tryParse(h, radix: 16);
  return v == null ? null : Color(v);
}
