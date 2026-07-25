import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import '../../core/widgets/app_toast.dart';
import 'data/order.dart';
import 'data/orders_repository.dart';
import 'order_common.dart';

/// Screen — Invoice (Figma node 46:7244). A tax-invoice card rendered from the
/// order + items (the web does the same client-side render). The customer can
/// only view; the PDF/HTML invoice is generated admin-side into `invoiceUrl`.
class InvoiceScreen extends StatelessWidget {
  const InvoiceScreen({super.key, required this.orderId});
  final String orderId;

  /// Shares the hosted invoice link when there is one, else a plain summary.
  ///
  /// `invoiceUrl` is stamped server-side moments after the order is paid, so
  /// the order is re-read at share time (never reused from a snapshot taken
  /// when the screen opened) and, for an order placed just now whose URL hasn't
  /// landed yet, read once more after a short pause — otherwise an invoice
  /// opened straight off the confirmation screen would go out without its link
  /// for good. Old orders never pay that wait.
  ///
  /// The card itself needs none of this: it renders from `watchOrder`, a live
  /// snapshot stream, so a late `invoiceUrl` (or a late order document) simply
  /// rebuilds it — a too-early read can't leave it stuck on "unavailable".
  Future<void> _shareInvoice(BuildContext context, OrdersRepository repo) async {
    Order? o;
    try {
      o = await repo.getOrder(orderId);
      final placedAt = o?.placedAt;
      final justPlaced = placedAt != null &&
          DateTime.now().difference(placedAt) < const Duration(minutes: 2);
      if (o != null && (o.invoiceUrl?.isEmpty ?? true) && justPlaced) {
        await Future<void>.delayed(const Duration(milliseconds: 1200));
        o = await repo.getOrder(orderId) ?? o;
      }
    } catch (_) {
      o = null; // permission / network — reported below rather than swallowed
    }
    if (o == null) {
      if (context.mounted) {
        AppToast.show(context, "Couldn't load this invoice.",
            variant: AppToastVariant.error);
      }
      return;
    }
    final hasPdf = o.invoiceUrl?.isNotEmpty ?? false;
    final text = hasPdf
        ? 'Invoice ${o.shortId} — Barakath\n${o.invoiceUrl}'
        // The order's total, matching the card above and the server invoice —
        // `paidPaise` is only the wallet portion until the payment is captured.
        : 'Invoice ${o.shortId} — Barakath\nTotal ${Money.fromPaise(o.totalPaise)}';
    await Share.share(text, subject: 'Invoice ${o.shortId}');
  }

  @override
  Widget build(BuildContext context) {
    final repo = OrdersRepository();
    return Scaffold(
      backgroundColor: AppColors.surfaceBackground,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            OrderTopBar(
              title: 'Invoice',
              trailing: GestureDetector(
                onTap: () => _shareInvoice(context, repo),
                behavior: HitTestBehavior.opaque,
                child: const Icon(Icons.ios_share_rounded,
                    size: 20, color: AppColors.brandGreen),
              ),
            ),
            Expanded(
              child: StreamBuilder<Order?>(
                stream: repo.watchOrder(orderId),
                builder: (context, orderSnap) {
                  if (orderSnap.hasError) {
                    return const AppErrorState(
                        message: "Couldn't load this invoice.");
                  }
                  final order = orderSnap.data;
                  if (order == null) {
                    return orderSnap.connectionState == ConnectionState.waiting
                        ? const Padding(
                            padding: EdgeInsets.all(AppSpacing.x20),
                            child:
                                AppShimmer(height: 320, radius: AppRadii.hero))
                        : const AppEmptyState(
                            icon: Icons.receipt_long_outlined,
                            title: 'Invoice unavailable');
                  }
                  return StreamBuilder<List<OrderItem>>(
                    stream: repo.watchItems(order.id),
                    builder: (context, itemsSnap) {
                      final items = itemsSnap.data ?? const <OrderItem>[];
                      return FutureBuilder<({String legalName, String gstin})>(
                        future: repo.fetchIssuer(),
                        builder: (context, issuerSnap) {
                          return ListView(
                            padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                                AppSpacing.x4, AppSpacing.x20, AppSpacing.x24),
                            children: [
                              _InvoiceCard(
                                order: order,
                                items: items,
                                legalName: issuerSnap.data?.legalName ?? '',
                                gstin: issuerSnap.data?.gstin ?? '',
                              ),
                            ],
                          );
                        },
                      );
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

class _InvoiceCard extends StatelessWidget {
  const _InvoiceCard({
    required this.order,
    required this.items,
    this.legalName = '',
    this.gstin = '',
  });
  final Order order;
  final List<OrderItem> items;
  final String legalName;
  final String gstin;

  /// Issuer line from admin settings, degrading gracefully when unset.
  String get _footer {
    final name = legalName.isNotEmpty ? legalName : 'Barakath';
    final gst = gstin.isNotEmpty ? ' · GSTIN $gstin' : '';
    return '$name$gst. This is a computer-generated invoice.';
  }

  @override
  Widget build(BuildContext context) {
    final net = order.subtotalPaise - order.discountPaise;
    final taxRate = (order.taxPaise > 0 && net > 0)
        ? (order.taxPaise / net * 100).round()
        : 0;
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.hero),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      padding: const EdgeInsets.all(AppSpacing.x20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header — brand + invoice meta.
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _logo(),
              const SizedBox(width: AppSpacing.x10),
              Text('Barakath',
                  style: AppType.headingLarge.copyWith(
                      fontSize: 18, fontWeight: FontWeight.w800)),
              const Spacer(),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text('Tax invoice',
                      style: AppType.bodyMedium.copyWith(
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary)),
                  const SizedBox(height: 2),
                  Text(order.shortId,
                      style: AppType.bodySmall
                          .copyWith(color: AppColors.textSecondary)),
                ],
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.x16),
          const Divider(height: 1, thickness: 1, color: AppColors.borderSubtle),
          const SizedBox(height: AppSpacing.x16),

          // Line items.
          if (items.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: AppSpacing.x8),
              child: AppShimmer(height: 20, radius: AppRadii.micro),
            )
          else
            for (final it in items) ...[
              _line('${it.title} × ${it.quantity}',
                  Money.fromPaise(it.lineTotalPaise)),
              const SizedBox(height: AppSpacing.x10),
            ],

          // The same lines, in the same order, as the invoice the server
          // generates into `invoiceUrl` (functions/src/orders/invoice.ts):
          // items → discount → delivery → COD → GST → total. Delivery was
          // missing entirely and the wallet was folded into the discount, so on
          // any order that paid a delivery fee (under the free-delivery
          // threshold) or spent wallet balance the lines did not add up to the
          // total printed underneath them — and disagreed with the downloadable
          // invoice for the same order.
          if (order.discountsExWalletPaise > 0) ...[
            _line(_discountLabel(),
                '−${Money.fromPaise(order.discountsExWalletPaise)}',
                valueColor: AppColors.brandGreen),
            const SizedBox(height: AppSpacing.x10),
          ],
          if (order.deliveryPaise > 0) ...[
            _line('Delivery', Money.fromPaise(order.deliveryPaise)),
            const SizedBox(height: AppSpacing.x10),
          ],
          // Only ever non-zero on orders placed while cash on delivery existed.
          if (order.codSurchargePaise > 0) ...[
            _line('COD charges', Money.fromPaise(order.codSurchargePaise)),
            const SizedBox(height: AppSpacing.x10),
          ],
          if (order.taxPaise > 0)
            _line(taxRate > 0 ? 'TAX ($taxRate%)' : 'TAX',
                Money.fromPaise(order.taxPaise)),

          const SizedBox(height: AppSpacing.x16),
          const Divider(height: 1, thickness: 1, color: AppColors.borderSubtle),
          const SizedBox(height: AppSpacing.x16),

          // Total — the order's own `totalPaise`, which is what the lines above
          // sum to and what the server's invoice prints. `paidPaise` is NOT
          // that number: at placement it holds only the wallet portion, and it
          // falls back to the total on an order that has not been paid at all.
          Row(
            children: [
              Expanded(
                child: Text('Total paid',
                    style: AppType.headingLarge.copyWith(
                        fontSize: 16, fontWeight: FontWeight.w800)),
              ),
              Text(Money.fromPaise(order.totalPaise),
                  style: AppType.headingLarge.copyWith(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      color: AppColors.brandGoldStrong)),
            ],
          ),
          // How that total was settled. Shown after the total rather than
          // deducted from it: the wallet is tender, not a discount — the same
          // treatment the order detail's payment card already uses.
          if (order.walletUsedPaise > 0) ...[
            const SizedBox(height: AppSpacing.x10),
            _line('Paid from wallet', Money.fromPaise(order.walletUsedPaise)),
          ],
          const SizedBox(height: AppSpacing.x16),

          // Footer note.
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(AppSpacing.x14),
            decoration: BoxDecoration(
              color: AppColors.bgMuted,
              borderRadius: BorderRadius.circular(AppRadii.field),
            ),
            child: Text(_footer,
                style: AppType.bodySmall.copyWith(
                    fontSize: 12,
                    height: 1.5,
                    color: AppColors.textTertiary)),
          ),
        ],
      ),
    );
  }

  /// A spin reward IS the coupon discount (same paise, see
  /// `spinRewardPaise = discountPaise` in functions/src/orders/checkout.ts), so
  /// it names that one line rather than promising a second component the amount
  /// does not contain.
  String _discountLabel() => order.isSpinReward ? 'Spin reward' : 'Discount';

  Widget _logo() {
    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        color: AppColors.brandAmber,
        borderRadius: BorderRadius.circular(AppRadii.chipSmall),
      ),
      alignment: Alignment.center,
      child: Container(
        width: 16,
        height: 16,
        decoration: const BoxDecoration(
            color: AppColors.brandGreen, shape: BoxShape.circle),
        child: Center(
          child: Container(
            width: 5,
            height: 5,
            decoration: const BoxDecoration(
                color: AppColors.brandAmber, shape: BoxShape.circle),
          ),
        ),
      ),
    );
  }

  Widget _line(String label, String value, {Color? valueColor}) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(label,
              style: AppType.bodyMedium.copyWith(color: AppColors.textSecondary)),
        ),
        const SizedBox(width: AppSpacing.x12),
        Text(value,
            style: AppType.bodyMedium.copyWith(
                fontWeight: FontWeight.w700,
                color: valueColor ?? AppColors.textPrimary)),
      ],
    );
  }
}
