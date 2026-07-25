import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/services/auth_provider.dart';
import '../../core/services/cart_provider.dart';
import '../../core/services/checkout_draft.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_toast.dart';
import '../cart/data/cart_line.dart';
import 'data/checkout_repository.dart';
import 'data/offers.dart';

/// Screen — Apply coupon (Figma node 46:6611). Enter a code, or pick from the
/// customer's spin rewards (`customers/{uid}/coupons`) and public coupons
/// (`coupons`). Applying sets the coupon on the checkout draft.
class CouponScreen extends StatefulWidget {
  const CouponScreen({super.key});

  @override
  State<CouponScreen> createState() => _CouponScreenState();
}

class _CouponScreenState extends State<CouponScreen> {
  final _controller = TextEditingController();
  final _checkout = CheckoutRepository();
  final _offers = OffersRepository();
  bool _applying = false;

  /// Memoised per uid: [OffersRepository.customerFacts] opens two Firestore
  /// listeners, and a fresh stream on every build would tear them down and
  /// re-open them on every keystroke in the code field.
  Stream<CustomerOfferFacts>? _factsStream;
  String? _factsUid;

  Stream<CustomerOfferFacts> _facts(String uid) {
    if (_factsStream == null || _factsUid != uid) {
      _factsUid = uid;
      _factsStream = _offers.customerFacts(uid);
    }
    return _factsStream!;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _applyCode() async {
    final code = _controller.text.trim();
    if (code.isEmpty || _applying) return;
    final cart = context.read<CartProvider>();
    setState(() => _applying = true);
    try {
      final applied = await _checkout.applyCoupon(code, cart.lines);
      if (!mounted) return;
      context.read<CheckoutDraft>().setCoupon(applied);
      _controller.clear();
      AppToast.show(context, 'Coupon ${applied.code} applied',
          variant: AppToastVariant.success);
    } on FirebaseFunctionsException catch (e) {
      if (mounted) {
        AppToast.show(context, e.message ?? "That coupon couldn't be applied.",
            variant: AppToastVariant.error);
      }
    } catch (_) {
      if (mounted) {
        AppToast.show(context, "That coupon couldn't be applied.",
            variant: AppToastVariant.error);
      }
    } finally {
      if (mounted) setState(() => _applying = false);
    }
  }

  /// Apply an offer the customer picked from the list.
  ///
  /// Routed through `applyCoupon` rather than trusting the client-side amount,
  /// so a coupon is never shown as applied unless the server agreed to it and
  /// the discount on screen is the server's own number. The rules the list can
  /// now prove for itself — `maxUsesPerUser` against `couponUsage`,
  /// `firstOrderOnly`, the audience — only decide whether this row offers an
  /// Apply at all; the server still has the last word on the amount.
  Future<void> _applyOffer(OfferOption o) async {
    // `canApply` also covers the refusals the row is tagged with ("Already
    // used" / "First order only"), which the server answers with an error the
    // customer can do nothing about.
    if (!o.canApply || _applying) return;
    final cart = context.read<CartProvider>();
    setState(() => _applying = true);
    try {
      final applied = await _checkout.applyCoupon(o.code, cart.lines);
      if (!mounted) return;
      // The label stays the screen's own wording (the callable returns the
      // code); the amount and the free-delivery flag come from the server —
      // a free_shipping coupon is worth ₹0 and waives the fee instead, so the
      // summary needs the flag or it charges a fee `summarise` waives.
      context.read<CheckoutDraft>().setCoupon(AppliedCoupon(
            code: applied.code,
            discountPaise: applied.discountPaise,
            label: o.source == 'spin' ? 'Spin reward' : 'Coupon',
            waiveDelivery: applied.waiveDelivery,
          ));
      AppToast.show(context, '${o.code} applied',
          variant: AppToastVariant.success);
    } on FirebaseFunctionsException catch (e) {
      if (mounted) {
        AppToast.show(context, e.message ?? "That coupon couldn't be applied.",
            variant: AppToastVariant.error);
      }
    } catch (_) {
      if (mounted) {
        AppToast.show(context, "That coupon couldn't be applied.",
            variant: AppToastVariant.error);
      }
    } finally {
      if (mounted) setState(() => _applying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final uid = context.watch<AuthProvider>().uid;
    final cart = context.watch<CartProvider>();
    final subtotal = cart.subtotalPaise;
    final appliedCode = context.watch<CheckoutDraft>().coupon?.code;

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _topBar(context),
            _enterCodeRow(),
            Expanded(
              child: uid == null
                  ? const SizedBox.shrink()
                  : _offersList(uid, subtotal, cart.lines, appliedCode),
            ),
          ],
        ),
      ),
    );
  }

  Widget _topBar(BuildContext context) {
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
          const SizedBox(width: AppSpacing.x12),
          Text('Apply coupon',
              style: AppType.headingLarge.copyWith(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.4)),
        ],
      ),
    );
  }

  Widget _enterCodeRow() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x8),
      child: Row(
        children: [
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(AppRadii.control),
                border: Border.all(color: AppColors.borderSubtle),
              ),
              child: TextField(
                controller: _controller,
                textCapitalization: TextCapitalization.characters,
                onSubmitted: (_) => _applyCode(),
                style: AppType.bodyMedium.copyWith(
                    fontSize: 15, color: AppColors.textPrimary),
                decoration: InputDecoration(
                  isCollapsed: true,
                  border: InputBorder.none,
                  hintText: 'Enter code',
                  hintStyle: AppType.bodyMedium.copyWith(
                      fontSize: 15, color: AppColors.textTertiary),
                ),
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.x12),
          GestureDetector(
            onTap: _applyCode,
            child: Container(
              height: 48,
              padding: const EdgeInsets.symmetric(horizontal: 22),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.brandAmber,
                borderRadius: BorderRadius.circular(AppRadii.control),
              ),
              child: _applying
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation(Colors.white)))
                  : Text('Apply',
                      style: AppType.bodyMedium.copyWith(
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _offersList(
      String uid, int subtotal, List<CartLine> lines, String? appliedCode) {
    return StreamBuilder<List<Map<String, dynamic>>>(
      stream: _offers.promoCoupons(),
      builder: (context, promoSnap) {
        return StreamBuilder<List<Map<String, dynamic>>>(
          stream: _offers.userCoupons(uid),
          builder: (context, userSnap) {
            // The bag's live categories, so a coupon restricted to
            // `applicableCategories` is priced on its eligible lines only —
            // the same subtotal `placeOrder` discounts.
            return StreamBuilder<Map<String, String>>(
              stream: _offers.cartCategories(lines),
              builder: (context, catSnap) {
                // The customer's own record: order count, affiliate flag and
                // the per-coupon redemption counters. Without them a coupon the
                // customer has already used up is listed with a working Apply
                // button that `placeOrder` answers with "You have already used
                // this coupon."
                return StreamBuilder<CustomerOfferFacts>(
                  stream: _facts(uid),
                  builder: (context, factsSnap) {
                    return _list(
                      listAvailableOffers(
                        subtotal,
                        userSnap.data ?? const [],
                        promoSnap.data ?? const [],
                        cartLines: offerCartLines(lines, catSnap.data),
                        facts: factsSnap.data ?? CustomerOfferFacts.unknown,
                      ),
                      appliedCode,
                    );
                  },
                );
              },
            );
          },
        );
      },
    );
  }

  Widget _list(List<OfferOption> offers, String? appliedCode) {
    final spins = offers.where((o) => o.source == 'spin').toList();
    final promos = offers.where((o) => o.source == 'promo').toList();
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x12, AppSpacing.x20, AppSpacing.x24),
      children: [
        if (spins.isNotEmpty) ...[
          _sectionLabel('FROM YOUR SPINS'),
          const SizedBox(height: AppSpacing.x10),
          for (final o in spins) ...[
            _spinCard(o, appliedCode == o.code),
            const SizedBox(height: AppSpacing.x10),
          ],
          const SizedBox(height: AppSpacing.x8),
        ],
        if (promos.isNotEmpty) ...[
          _sectionLabel('AVAILABLE FOR YOU'),
          const SizedBox(height: AppSpacing.x10),
          for (final o in promos) ...[
            _promoCard(o, appliedCode == o.code),
            const SizedBox(height: AppSpacing.x10),
          ],
        ],
      ],
    );
  }

  Widget _sectionLabel(String text) => Text(text,
      style: AppType.labelUppercase.copyWith(
          fontSize: 11,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.5,
          color: AppColors.textTertiary));

  // Gold spin-reward card.
  Widget _spinCard(OfferOption o, bool applied) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      decoration: BoxDecoration(
        color: AppColors.brandAmberLight.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.brandAmber.withValues(alpha: 0.5)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(o.headline.toUpperCase(),
                    style: AppType.bodyLarge.copyWith(
                        fontWeight: FontWeight.w800,
                        color: AppColors.brandGoldStrong)),
                const SizedBox(height: 3),
                Text(o.sub,
                    style: AppType.bodySmall
                        .copyWith(color: AppColors.textSecondary)),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.x12),
          _actionPill(o, applied, gold: true),
        ],
      ),
    );
  }

  // White promotional coupon card.
  Widget _promoCard(OfferOption o, bool applied) {
    // The existing "locked" treatment now covers both reasons a coupon can't be
    // tapped: the bag is under its minimum, or the customer has used it up. Same
    // greyed code + red explanation line — only the sentence differs.
    final locked = !o.canApply;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(locked ? o.code : '${o.code} · ${o.headline}',
                    style: AppType.bodyLarge.copyWith(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: locked
                            ? AppColors.textTertiary
                            : AppColors.textPrimary)),
                const SizedBox(height: 3),
                Text(
                    !locked
                        ? o.sub
                        : o.unavailableReason ??
                            'Min cart ${Money.fromPaiseCompact(o.minPaise)} — add ${Money.fromPaiseCompact(o.shortfallPaise)} more',
                    style: AppType.bodySmall.copyWith(
                        color: locked
                            ? AppColors.destructiveRed
                            : AppColors.textSecondary)),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.x12),
          _actionPill(o, applied, gold: false),
        ],
      ),
    );
  }

  Widget _actionPill(OfferOption o, bool applied, {required bool gold}) {
    if (applied) {
      // Tap the applied pill to un-apply the coupon.
      return GestureDetector(
        onTap: () => context.read<CheckoutDraft>().setCoupon(null),
        behavior: HitTestBehavior.opaque,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            color: AppColors.brandAmber,
            borderRadius: BorderRadius.circular(AppRadii.pill),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Text('Applied',
                style: AppType.bodySmall.copyWith(
                    fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
            const SizedBox(width: 4),
            const Icon(Icons.close_rounded,
                size: 14, color: AppColors.textPrimary),
          ]),
        ),
      );
    }
    // No Apply for anything `placeOrder` would refuse: under the minimum
    // ("Locked", as before) or already spent by this customer ("Used"). The
    // spin card has no sub-line, so this word is the only tag it gets.
    if (!o.canApply) {
      return Text(o.unavailableReason ?? 'Locked',
          style: AppType.bodyMedium.copyWith(
              fontWeight: FontWeight.w700, color: AppColors.textTertiary));
    }
    return GestureDetector(
      onTap: () => unawaited(_applyOffer(o)),
      behavior: HitTestBehavior.opaque,
      child: Text('Apply',
          style: AppType.bodyMedium.copyWith(
              fontWeight: FontWeight.w800,
              color: gold ? AppColors.brandGoldStrong : AppColors.brandGreen)),
    );
  }
}
