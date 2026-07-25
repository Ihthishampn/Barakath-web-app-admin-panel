import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../../core/router/app_router.dart';
import '../../../core/services/auth_provider.dart';
import '../../../core/services/cart_provider.dart';
import '../../../core/services/checkout_draft.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/money.dart';
import '../../../core/widgets/app_toast.dart';
import '../../cart/data/cart_line.dart';
import '../data/checkout_repository.dart';
import '../data/offers.dart';

/// Gold reward banner — surfaces the best qualifying spin reward / coupon when
/// none is applied yet, with a one-tap Apply. Shared by the Bag and Checkout
/// screens (Figma 46:6449) so both stay in sync with real offer data.
///
/// While a coupon IS applied it renders nothing but keeps the offer streams
/// alive to re-price it against the live bag — the applied discount is a
/// snapshot taken when Apply was tapped, and editing quantities afterwards would
/// otherwise leave a stale (or no longer valid) discount on screen while
/// `placeOrder` re-derives it from the real cart.
class CouponRewardBanner extends StatelessWidget {
  const CouponRewardBanner({super.key});

  static final _offers = OffersRepository();

  @override
  Widget build(BuildContext context) {
    final applied =
        context.select<CheckoutDraft, AppliedCoupon?>((d) => d.coupon);
    final uid = context.select<AuthProvider, String?>((a) => a.uid);
    final subtotal = context.select<CartProvider, int>((c) => c.subtotalPaise);
    final lines = context.select<CartProvider, List<CartLine>>((c) => c.lines);
    if (uid == null) return const SizedBox.shrink();

    return StreamBuilder<List<Map<String, dynamic>>>(
      stream: _offers.promoCoupons(),
      builder: (context, promoSnap) {
        return StreamBuilder<List<Map<String, dynamic>>>(
          stream: _offers.userCoupons(uid),
          builder: (context, userSnap) {
            // The bag's live categories: a coupon limited to
            // `applicableCategories` only discounts the lines in those
            // categories server-side, so pricing one without them would show a
            // discount `placeOrder` never grants.
            return StreamBuilder<Map<String, String>>(
              stream: _offers.cartCategories(lines),
              builder: (context, catSnap) {
                // The customer's own record — order count, affiliate flag and
                // the per-coupon redemption counters — so a coupon they have
                // already used up is neither suggested here nor left applied.
                return StreamBuilder<CustomerOfferFacts>(
                  stream: _offers.customerFacts(uid),
                  builder: (context, factsSnap) {
                    final offers = listAvailableOffers(
                      subtotal,
                      userSnap.data ?? const [],
                      promoSnap.data ?? const [],
                      cartLines: offerCartLines(lines, catSnap.data),
                      facts: factsSnap.data ?? CustomerOfferFacts.unknown,
                    );
                    if (applied != null) {
                      // Only once every stream has reported — an empty list (or
                      // an unpriceable category restriction) while loading would
                      // look like "this coupon no longer exists".
                      if (promoSnap.hasData &&
                          userSnap.hasData &&
                          catSnap.hasData) {
                        _resyncApplied(context, applied, offers);
                      }
                      return const SizedBox.shrink();
                    }
                    // Only offers the server would itself auto-apply are
                    // suggested: admin stamps `maxUsesPerUser: 1` on every
                    // coupon, and one the customer has already used is rejected
                    // outright at placement.
                    final best = bestAutoOffer(offers);
                    if (best == null) return const SizedBox.shrink();
                    return _banner(context, best);
                  },
                );
              },
            );
          },
        );
      },
    );
  }

  /// The gold suggestion row itself — unchanged markup, lifted out so the
  /// builder above stays readable.
  Widget _banner(BuildContext context, OfferOption best) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.x12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: AppColors.brandAmberLight.withValues(alpha: 0.3),
          borderRadius: BorderRadius.circular(AppRadii.field),
          border:
              Border.all(color: AppColors.brandAmber.withValues(alpha: 0.5)),
        ),
        child: Row(
          children: [
            const Icon(Icons.card_giftcard_rounded,
                size: 20, color: AppColors.brandGoldStrong),
            const SizedBox(width: AppSpacing.x12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                      best.source == 'spin'
                          ? 'You have a spin reward'
                          : 'You have a coupon',
                      style: AppType.bodyMedium.copyWith(
                          fontSize: 14,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary)),
                  const SizedBox(height: 2),
                  Text('${best.headline} · ${best.sub}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppType.bodySmall
                          .copyWith(color: AppColors.textSecondary)),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.x10),
            GestureDetector(
              onTap: () {
                context.read<CheckoutDraft>().setCoupon(AppliedCoupon(
                      code: best.code,
                      discountPaise: best.discountPaise,
                      label: best.source == 'spin' ? 'Spin reward' : 'Coupon',
                      // A free-delivery coupon discounts nothing; the summary
                      // has to waive the fee instead, exactly as the server's
                      // `summarise` does.
                      waiveDelivery: best.waiveDelivery,
                    ));
                AppToast.show(context, '${best.code} applied',
                    variant: AppToastVariant.success);
              },
              behavior: HitTestBehavior.opaque,
              child: Text('Apply',
                  style: AppType.bodyMedium.copyWith(
                      fontWeight: FontWeight.w800,
                      color: AppColors.brandGoldStrong)),
            ),
          ],
        ),
      ),
    );
  }

  /// Re-prices the applied coupon against the current bag, because
  /// [AppliedCoupon.discountPaise] was frozen at the moment Apply was tapped.
  /// A code we can't see in the offer list (e.g. a manually entered promo that
  /// isn't auto-applicable) is left alone — `placeOrder` re-derives it anyway.
  static void _resyncApplied(
      BuildContext context, AppliedCoupon applied, List<OfferOption> offers) {
    final live = offers.where((o) => o.code == applied.code).firstOrNull;
    if (live == null) return;
    // A free-delivery coupon is worth ₹0 by design — judging it on the discount
    // alone would tear a perfectly valid one straight back off. `canApply` adds
    // the per-customer refusals: a coupon whose last use was spent on another
    // device while this draft sat open is one `placeOrder` now rejects.
    final stillValid =
        live.canApply && (live.discountPaise > 0 || live.waiveDelivery);
    if (stillValid &&
        live.discountPaise == applied.discountPaise &&
        live.waiveDelivery == applied.waiveDelivery) {
      return;
    }

    // Never mutate the draft during build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!context.mounted) return;
      final draft = context.read<CheckoutDraft>();
      final current = draft.coupon;
      if (current == null || current.code != applied.code) return; // moved on
      if (!stillValid) {
        // No longer applicable — keeping it would show a discount the server
        // rejects with a bare error at placement. Say WHICH reason: "below the
        // minimum" on a coupon that is actually used up reads as a bug.
        draft.setCoupon(null);
        AppToast.show(
            context,
            live.unavailableReason != null
                ? '${applied.code} removed — ${live.unavailableReason}.'
                : '${applied.code} removed — bag is below the '
                    '${Money.fromPaise(live.minPaise)} minimum.',
            variant: AppToastVariant.error);
        return;
      }
      draft.setCoupon(AppliedCoupon(
        code: current.code,
        discountPaise: live.discountPaise,
        label: current.label,
        waiveDelivery: live.waiveDelivery,
      ));
    });
  }
}

/// The "Apply a coupon" row — or the applied-coupon chip with a clear (×)
/// action. Tapping the empty row opens the full coupon screen. Shared by Bag +
/// Checkout.
class CouponRow extends StatelessWidget {
  const CouponRow({super.key});

  @override
  Widget build(BuildContext context) {
    final applied = context.select<CheckoutDraft, AppliedCoupon?>((d) => d.coupon);
    if (applied != null) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: AppColors.brandGreenSubtle,
          borderRadius: BorderRadius.circular(AppRadii.field),
          border: Border.all(color: AppColors.brandGreen.withValues(alpha: 0.4)),
        ),
        child: Row(
          children: [
            const Icon(Icons.local_offer_rounded,
                size: 18, color: AppColors.brandGreen),
            const SizedBox(width: AppSpacing.x10),
            Expanded(
              child: Text('${applied.code} applied',
                  style: AppType.bodyMedium.copyWith(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: AppColors.brandGreenDark)),
            ),
            Text('−${Money.fromPaise(applied.discountPaise)}',
                style: AppType.bodyMedium.copyWith(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: AppColors.brandGreen)),
            const SizedBox(width: AppSpacing.x10),
            GestureDetector(
              onTap: () => context.read<CheckoutDraft>().setCoupon(null),
              behavior: HitTestBehavior.opaque,
              child: const Icon(Icons.close_rounded,
                  size: 18, color: AppColors.textTertiary),
            ),
          ],
        ),
      );
    }
    return GestureDetector(
      onTap: () => context.push(Routes.coupon),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(AppRadii.field),
          border: Border.all(color: AppColors.borderSubtle),
        ),
        child: Row(
          children: [
            const Icon(Icons.add_circle_outline_rounded,
                size: 20, color: AppColors.brandGreen),
            const SizedBox(width: AppSpacing.x10),
            Expanded(
              child: Text('Apply a coupon',
                  style: AppType.bodyMedium.copyWith(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary)),
            ),
            const Icon(Icons.arrow_forward_rounded,
                size: 18, color: AppColors.textTertiary),
          ],
        ),
      ),
    );
  }
}
