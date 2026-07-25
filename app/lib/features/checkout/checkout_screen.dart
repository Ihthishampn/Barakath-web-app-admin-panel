import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/constants/limits.dart';
import '../../core/router/app_router.dart';
import '../../core/services/auth_provider.dart';
import '../../core/services/cart_provider.dart';
import '../../core/services/checkout_draft.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/app_bottom_sheet.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_toast.dart';
import '../cart/data/cart_line.dart';
import 'data/address.dart';
import 'data/checkout_repository.dart';
import 'data/offers.dart';
import 'widgets/coupon_apply.dart';

/// Screen — Checkout (Figma node 46:6784). Address, delivery, payment method,
/// wallet and the live price summary. "Pay" carries the draft to the Payment
/// screen. All money math mirrors the web `computeSummary`.
class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  final _repo = CheckoutRepository();
  StoreSettings _settings = const StoreSettings();
  bool _placing = false;

  // Live stock per cart line, so an unavailable item is caught here rather than
  // by `placeOrder` rejecting the whole order. A missing key means "not known
  // yet" and never blocks.
  Map<String, int> _stock = const {};
  String _stockKey = '';
  StreamSubscription<Map<String, int>>? _stockSub;

  // Stock hold for this checkout attempt. `reserveStock` takes the units out of
  // `products` straight away and holds them for 15 minutes, so a slow checkout
  // can't be beaten to the last piece. Released again in dispose() unless the
  // server consumed it by placing the order.
  String? _reservationId;
  // Units this screen is holding, per cart-line key. The live stock stream
  // reads `products` AFTER our decrement, so without adding these back our own
  // hold would surface as "out of stock".
  Map<String, int> _reserved = const {};
  // Cart signature (line + qty) the hold was last requested for; also set on a
  // failed attempt so an unchanged bag isn't retried on every rebuild.
  String _reserveKey = '';
  bool _reserving = false;
  // Set once `placeOrder` has returned — the server consumed the hold, so
  // leaving the screen must not release it.
  bool _orderPlaced = false;

  // Offers, mirrored from the web checkout: `placeOrder` auto-applies the best
  // available offer whenever no code is sent, so the app must apply it to the
  // draft too — otherwise the summary shows a higher total than what is charged
  // and a one-time spin reward is spent without the customer choosing to.
  final _offersRepo = OffersRepository();
  StreamSubscription<List<Map<String, dynamic>>>? _userCouponsSub;
  StreamSubscription<List<Map<String, dynamic>>>? _promoCouponsSub;
  List<Map<String, dynamic>>? _userCoupons; // null = still loading
  List<Map<String, dynamic>>? _promoCoupons;
  bool _autoTried = false;

  // The customer's own record (order count, affiliate flag, per-coupon
  // redemption counters). The offer rules that depend on WHO the customer is —
  // audience, first-order-only, "you have already used this coupon" — cannot be
  // evaluated without it, and an offer that fails one of them must never reach
  // the draft: `placeOrder` refuses the whole order over it.
  StreamSubscription<CustomerOfferFacts>? _factsSub;
  CustomerOfferFacts _facts = CustomerOfferFacts.unknown;

  // Live `productId → categorySlug` for the bag. A category-restricted coupon
  // may only discount the lines in `applicableCategories`, so without these the
  // app would quote a discount on the whole bag that `placeOrder` grants on part
  // of it. Null = not resolved yet, which blocks auto-apply rather than guessing
  // (the web gates its auto-apply on the same readiness).
  StreamSubscription<Map<String, String>>? _categoriesSub;
  Map<String, String>? _categories;
  String _categoriesKey = '';

  /// (Re)subscribe only when the set of lines actually changes — this runs from
  /// build(), so it must be a no-op on an unchanged bag.
  void _syncStockWatch(List<CartLine> lines) {
    final key = lines.map((l) => l.key).join(',');
    if (key == _stockKey) return;
    _stockKey = key;
    _stockSub?.cancel();
    _stockSub = null;
    if (lines.isEmpty) {
      _stock = const {};
      return;
    }
    _stockSub = _repo.watchLineStock(lines).listen(
      (m) {
        if (mounted) setState(() => _stock = m);
      },
      // Availability is advisory here — `placeOrder` re-checks atomically — so
      // a read failure must not strand the customer on a dead pay bar.
      onError: (_) {},
    );
  }

  /// (Re)subscribe to the bag's live category slugs, on the same "only when the
  /// lines actually change" contract as [_syncStockWatch] — it too runs from
  /// build().
  void _syncCategoriesWatch(List<CartLine> lines) {
    final key = lines.map((l) => l.productId).toSet().join(',');
    if (key == _categoriesKey) return;
    _categoriesKey = key;
    _categoriesSub?.cancel();
    _categoriesSub = null;
    if (lines.isEmpty) {
      _categories = const {};
      return;
    }
    _categoriesSub = _offersRepo.cartCategories(lines).listen(
      (m) {
        if (!mounted) return;
        setState(() => _categories = m);
        // The bag's categories are what makes a restricted coupon priceable, so
        // the one-shot auto-apply may only now have everything it needs.
        _autoApplyBestOffer();
      },
      // A read failure leaves the map null: restricted coupons then price at 0
      // and are never auto-applied, which can only under-claim a discount.
      onError: (_) {},
    );
  }

  /// Units this customer can still buy on [l]: what's left on the product now,
  /// plus whatever our own reservation already took out of it. Null while the
  /// stock stream hasn't reported, which never blocks.
  int? _availableFor(CartLine l) {
    final onHand = _stock[l.key];
    if (onHand == null) return null;
    return onHand + (_reserved[l.key] ?? 0);
  }

  /// Lines that can't be fulfilled: nothing left, or fewer units than wanted.
  ({List<CartLine> gone, List<CartLine> short}) _stockIssues(
      List<CartLine> lines) {
    final gone = <CartLine>[];
    final short = <CartLine>[];
    for (final l in lines) {
      final available = _availableFor(l);
      if (available == null) continue; // not resolved yet
      if (available <= 0) {
        gone.add(l);
      } else if (available < l.qty) {
        short.add(l);
      }
    }
    return (gone: gone, short: short);
  }

  /// Takes (or re-takes) the 15-minute stock hold for [lines].
  ///
  /// Runs on entering checkout and again whenever the bag changes — the server
  /// releases the previous hold inside the same transaction, so re-entering or
  /// trimming the bag never leaks units. A failure is not fatal: `placeOrder`
  /// still validates and decrements stock itself, exactly as it did before
  /// reservations existed, so the customer is left no worse off.
  Future<void> _ensureReservation(List<CartLine> lines) async {
    if (_reserving || _orderPlaced || lines.isEmpty) return;
    final key = lines.map((l) => '${l.key}x${l.qty}').join(',');
    if (key == _reserveKey) return;
    _reserving = true;
    // Marked before the call so a rejected bag isn't retried (and re-toasted)
    // on every rebuild; changing the bag changes the key and retries.
    _reserveKey = key;
    try {
      final hold = await _repo.reserveStock(lines);
      if (!mounted) {
        // Popped while the call was in flight — hand the units straight back.
        await _repo.releaseStock(hold.reservationId);
        return;
      }
      CheckoutHold.reservationId = hold.reservationId;
      setState(() {
        _reservationId = hold.reservationId;
        _reserved = {for (final l in lines) l.key: l.qty};
      });
    } on FirebaseFunctionsException catch (e) {
      // Out of stock. The live stock stream already blocks the pay bar and the
      // alert above names the offending lines — this only relays the server's
      // wording. A rolled-back reserve leaves any previous hold untouched, so
      // _reservationId / _reserved stay as they are.
      if (!mounted) return;
      AppToast.show(context,
          e.message ?? 'Some items in your bag are no longer available.',
          variant: AppToastVariant.error);
    } catch (_) {
      // Network / cold start — stay silent and let placeOrder do the checking.
    } finally {
      _reserving = false;
    }
  }

  /// Set once the bag has been re-priced for this visit to checkout.
  bool _repriced = false;

  /// Re-read the bag's prices from the live products, once, as soon as the bag
  /// has resolved.
  ///
  /// Every figure on this screen — the subtotal, the free-delivery threshold,
  /// each coupon's minimum and the amount on the pay button — is derived from
  /// prices snapshotted when the items were added, while `placeOrder` prices
  /// from the product document. A price that moved in between is charged at the
  /// server's number, not the one quoted here.
  void _refreshCartPrices() {
    if (_repriced || !mounted) return;
    _repriced = true;
    unawaited(context.read<CartProvider>().refreshPrices());
  }

  /// Hands the held units back when checkout is abandoned. Called from
  /// dispose(), so it can't await: release is idempotent and the 5-minute
  /// sweep is the backstop if the call never lands.
  void _releaseHoldOnLeave() {
    final id = _reservationId;
    _reservationId = null;
    if (id == null || _orderPlaced) return;
    // The Payment screen clears the shared handle the moment `placeOrder`
    // consumes the hold; a mismatch means the server already owns it and this
    // pop is just the checkout route being torn down behind a placed order.
    if (CheckoutHold.reservationId != id) return;
    CheckoutHold.clear();
    unawaited(_repo.releaseStock(id));
  }

  /// Place the order directly — only reachable when there is nothing left to
  /// collect, so no gateway leg is owed. Anything with a balance due routes to
  /// the Payment screen instead. [walletOnly] is the method the server is told
  /// (see [CheckoutRepository.placeOrder]).
  Future<void> _placeOrder({required bool walletOnly}) async {
    if (_placing) return;
    final cart = context.read<CartProvider>();
    final draft = context.read<CheckoutDraft>();
    // Read every provider up front: the recovery path below runs after a 120s
    // await, by which time this State may be unmounted and `context` unusable.
    final uid = context.read<AuthProvider>().uid;
    if (draft.addressId == null || cart.lines.isEmpty) {
      AppToast.show(context, 'Your bag or address is missing.',
          variant: AppToastVariant.error);
      return;
    }
    // Backstop for the pay bar's own check — the bag can change on another
    // device between the rebuild that enabled the button and this tap, and
    // `placeOrder` rejects an over-sized bag outright.
    final limit = cart.limitBreach();
    if (limit.blocked) {
      AppToast.show(context, limit.message!, variant: AppToastVariant.error);
      return;
    }
    setState(() => _placing = true);
    try {
      final placed = await _repo.placeOrder(
        lines: cart.lines,
        addressId: draft.addressId!,
        couponCode: draft.coupon?.code,
        // No coupon on the draft is a DELIBERATE choice here (this screen picks
        // and auto-applies the best offer itself, and the summary above shows
        // the result) — say so, or the server auto-applies one the customer
        // never saw and may burn a one-time reward. Mirrors web's
        // `noCoupon: !draft.coupon`.
        noCoupon: draft.coupon == null,
        useWallet: draft.useWallet,
        walletOnly: walletOnly,
        placementNonce: CheckoutAttempt.nonce,
        reservationId: CheckoutHold.reservationId,
      );
      // The server consumed the hold inside the same transaction — leaving the
      // screen must not now release (and re-stock) units that were sold.
      _orderPlaced = true;
      CheckoutHold.clear();
      // The order landed: retire the key so a later order gets a fresh one.
      CheckoutAttempt.clear();
      cart.clear();
      draft.reset();
      if (!mounted) return;
      context.go(Routes.orderConfirmation, extra: placed);
    } on FirebaseFunctionsException catch (e) {
      // A deadline says nothing about whether the order committed — the call is
      // idempotent on the nonce, so look before reporting failure.
      if (e.code == 'deadline-exceeded' || e.code == 'unavailable') {
        if (await _recoverTimedOutOrder(uid, cart, draft)) return;
        if (mounted) {
          setState(() => _placing = false);
          AppToast.show(
              context, 'Network is slow — check My orders before retrying.',
              variant: AppToastVariant.error);
        }
        return;
      }
      if (mounted) {
        setState(() => _placing = false);
        AppToast.show(context, e.message ?? 'Could not place your order.',
            variant: AppToastVariant.error);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _placing = false);
        AppToast.show(context, 'Could not place your order. Please try again.',
            variant: AppToastVariant.error);
      }
    }
  }

  /// Returns true when the order actually landed despite the timeout, in which
  /// case checkout completes normally instead of inviting a duplicate order.
  Future<bool> _recoverTimedOutOrder(
      String? uid, CartProvider cart, CheckoutDraft draft) async {
    // [uid] is captured before the placeOrder await — touching `context` here
    // would throw (and escape the caller's catch) if the screen was popped
    // while the call was in flight.
    if (uid == null) return false;
    final placed = await _repo.findOrderByNonce(uid, CheckoutAttempt.nonce);
    if (placed == null) return false;
    // It committed after the deadline — the hold went with it.
    _orderPlaced = true;
    CheckoutHold.clear();
    CheckoutAttempt.clear();
    cart.clear();
    draft.reset();
    if (!mounted) return true;
    context.go(Routes.orderConfirmation, extra: placed);
    return true;
  }

  @override
  void initState() {
    super.initState();
    _loadSettings();
    _watchOffers();
    // Hold the stock as soon as checkout opens. The bag may still be loading
    // from Firestore, in which case this is a no-op and the first build with a
    // non-empty bag takes the hold instead.
    unawaited(_ensureReservation(context.read<CartProvider>().lines));
  }

  @override
  void dispose() {
    _stockSub?.cancel();
    _userCouponsSub?.cancel();
    _promoCouponsSub?.cancel();
    _factsSub?.cancel();
    _categoriesSub?.cancel();
    _releaseHoldOnLeave();
    // The nonce belongs to THIS visit to checkout (web scopes it to the
    // checkout page's lifetime the same way). Leaving checkout ends the
    // attempt, so the next order must not replay this one's key — while a trip
    // to the Payment screen, which does not dispose this screen, keeps it.
    CheckoutAttempt.clear();
    super.dispose();
  }

  void _watchOffers() {
    final uid = context.read<AuthProvider>().uid;
    if (uid == null) return;
    _userCouponsSub = _offersRepo.userCoupons(uid).listen((v) {
      _userCoupons = v;
      _autoApplyBestOffer();
    }, onError: (_) {});
    _promoCouponsSub = _offersRepo.promoCoupons().listen((v) {
      _promoCoupons = v;
      _autoApplyBestOffer();
    }, onError: (_) {});
    // Never gates the one-shot auto-apply (both halves of it degrade to "rule
    // not enforced"), but it decides which offers are candidates at all — so
    // re-run the pick whenever it lands.
    _factsSub = _offersRepo.customerFacts(uid).listen((v) {
      _facts = v;
      _autoApplyBestOffer();
    }, onError: (_) {});
  }

  /// Applies the best qualifying offer to the draft exactly once, so the
  /// displayed discount matches what `placeOrder` charges. Runs only after both
  /// offer streams AND the bag's categories have reported and the bag has a
  /// value; once it has run, a manual removal is respected.
  ///
  /// Only offers that pass every rule the server's `autoBestOffer` applies are
  /// considered ([OfferOption.autoApplicable]) — auto-applying anything else
  /// puts a code on the order that `placeOrder` then rejects outright.
  void _autoApplyBestOffer() {
    if (_autoTried || !mounted) return;
    final user = _userCoupons;
    final promo = _promoCoupons;
    if (user == null || promo == null) return; // still loading
    final cart = context.read<CartProvider>();
    final subtotal = cart.subtotalPaise;
    if (subtotal <= 0) return; // bag not ready
    // Categories not settled yet: a restricted coupon can't be priced, and
    // applying an unpriceable one would quote a discount the server won't give.
    final lines = offerCartLines(cart.lines, _categories);
    if (lines == null) return;
    _autoTried = true;
    final draft = context.read<CheckoutDraft>();
    if (draft.coupon != null) return; // customer already chose one
    final best = bestAutoOffer(listAvailableOffers(subtotal, user, promo,
        cartLines: lines, facts: _facts));
    if (best == null) return;
    draft.setCoupon(AppliedCoupon(
      code: best.code,
      discountPaise: best.discountPaise,
      label: best.source == 'spin' ? 'Spin reward' : 'Coupon',
      waiveDelivery: best.waiveDelivery,
    ));
  }

  Future<void> _loadSettings() async {
    try {
      final s = await _repo.fetchSettings();
      if (mounted) setState(() => _settings = s);
    } catch (_) {
      // Fall back to the defaults in [StoreSettings] (everything on).
    }
  }

  @override
  Widget build(BuildContext context) {
    final uid = context.watch<AuthProvider>().uid;
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _topBar(context),
            Expanded(
              child: uid == null
                  ? const SizedBox.shrink()
                  : StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
                      stream: FirebaseFirestore.instance
                          .doc('customers/$uid')
                          .snapshots(),
                      builder: (context, snap) {
                        final data = snap.data?.data() ?? const {};
                        final addresses = ((data['addresses'] as List?) ??
                                const [])
                            .whereType<Map>()
                            .map(Address.fromMap)
                            .toList();
                        final walletBalance =
                            ((data['wallet'] as Map?)?['balancePaise'] as num?)
                                    ?.toInt() ??
                                0;
                        return _content(
                            context, uid, addresses, walletBalance);
                      },
                    ),
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
          Text('Checkout',
              style: AppType.headingLarge.copyWith(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.48)),
        ],
      ),
    );
  }

  Widget _content(BuildContext context, String uid, List<Address> addresses,
      int walletBalance) {
    final cart = context.watch<CartProvider>();
    final draft = context.watch<CheckoutDraft>();
    final s = _settings;

    _syncStockWatch(cart.lines);
    _syncCategoriesWatch(cart.lines);
    // The bag usually resolves after initState, and trimming an unavailable
    // line changes it again — both are handled by re-checking here (guarded on
    // the line+qty signature, so an unchanged bag never re-reserves).
    if (cart.lines.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _ensureReservation(cart.lines);
        _refreshCartPrices();
      });
    }
    // initState may have run before auth resolved a uid; subscribe as soon as
    // one exists (this branch only renders with a signed-in customer).
    if (_userCouponsSub == null) _watchOffers();
    // The offer streams can report before the bag has been priced, so retry the
    // one-shot auto-apply on rebuild until it has actually run.
    if (!_autoTried) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _autoApplyBestOffer());
    }
    final issues = _stockIssues(cart.lines);
    final blocked = issues.gone.isNotEmpty || issues.short.isNotEmpty;

    // Payment availability (missing settings ⇒ everything on).
    // The admin toggle alone decides (web: `gateway?.onlinePaymentEnabled ??
    // true`). Falling back to "a key id is configured" made the kill switch
    // inert — the key stays configured when online payment is turned off, so
    // the app kept offering Razorpay after the admin disabled it.
    final onlineEnabled = s.onlinePaymentEnabled;
    final walletEnabled = s.walletEnabled && walletBalance > 0;

    // Resolve the selected address (draft → default → first).
    Address? selected;
    if (addresses.isNotEmpty) {
      selected = addresses.where((a) => a.id == draft.addressId).firstOrNull ??
          addresses.where((a) => a.isDefault).firstOrNull ??
          addresses.first;
      if (draft.addressId != selected.id) {
        WidgetsBinding.instance.addPostFrameCallback(
            (_) => context.read<CheckoutDraft>().setAddress(selected!.id));
      }
    }

    if (draft.useWallet && !walletEnabled) {
      WidgetsBinding.instance.addPostFrameCallback(
          (_) => context.read<CheckoutDraft>().setUseWallet(false));
    }

    final summary = _repo.computeSummary(
      cart.subtotalPaise,
      s,
      coupon: draft.coupon,
      walletBalancePaise: draft.useWallet && walletEnabled ? walletBalance : null,
    );

    // Nothing left to collect — the wallet, the discounts, or both cover it —
    // so the gateway (the only way to pay now) no longer applies. An emptied
    // bag also prices at zero, and that is not an order that is "covered": the
    // last line can be dropped from right here by the out-of-stock fix.
    final nothingToPay = cart.lines.isNotEmpty && summary.payablePaise == 0;
    // 'wallet' is the server's method for an order with nothing to collect, and
    // the ONLY one it still accepts while online payment is switched off. Send
    // it when the wallet is genuinely the tender, and whenever the gateway is
    // off; a zero-payable order that came purely from discounts goes as
    // 'razorpay' and the server settles it as a wallet payment itself, which
    // keeps working even where the admin has wallet payment disabled.
    final walletOnly =
        nothingToPay && (summary.walletUsedPaise > 0 || !onlineEnabled);

    // The server caps the bag the same way (`placeOrder`), so an over-sized bag
    // is rejected outright — better to block here and name the cap than to take
    // a payment attempt into a callable that will refuse it. The bag can arrive
    // over a cap without this screen ever adding to it: another device, a
    // re-price, or a bag built before the caps existed.
    final limit = cart.limitBreach(totalPaise: summary.totalPaise);

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
                AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x16),
            children: [
              if (blocked) ...[
                _stockAlert(context, issues.gone, issues.short),
                const SizedBox(height: AppSpacing.x12),
              ],
              _addressSection(context, uid, addresses, selected),
              const SizedBox(height: AppSpacing.x12),
              _deliveryCard(summary),
              const SizedBox(height: AppSpacing.x20),
              Text('Payment method',
                  style: AppType.bodyLarge.copyWith(
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary)),
              const SizedBox(height: AppSpacing.x12),
              if (nothingToPay)
                _nothingToPayNote(summary.walletUsedPaise > 0)
              else if (onlineEnabled)
                _onlinePaymentCard()
              else
                _onlinePaymentOffNote(),
              if (walletEnabled) ...[
                const SizedBox(height: AppSpacing.x12),
                _walletCard(context, draft, walletBalance),
              ],
              const SizedBox(height: AppSpacing.x20),
              Text('Coupons & offers',
                  style: AppType.bodyLarge.copyWith(
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary)),
              const SizedBox(height: AppSpacing.x12),
              const CouponRewardBanner(),
              const CouponRow(),
              const SizedBox(height: AppSpacing.x16),
              _summaryCard(summary),
            ],
          ),
        ),
        _payBar(context, summary, selected != null,
            walletOnly: walletOnly,
            blocked: blocked,
            limit: limit,
            // Nothing can be collected with the gateway off unless the order is
            // already covered — block rather than place an order the server
            // would only reject.
            paymentUnavailable: !onlineEnabled && !nothingToPay),
      ],
    );
  }

  // ── Address ────────────────────────────────────────────────────────
  Widget _addressSection(BuildContext context, String uid,
      List<Address> addresses, Address? selected) {
    if (selected == null) {
      return AppButton.outlined(
        label: 'Add address',
        icon: Icons.add_rounded,
        onPressed: () => context.push(Routes.addAddress),
      );
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.location_on_outlined,
              size: 20, color: AppColors.brandGreen),
          const SizedBox(width: AppSpacing.x10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${selected.label} · ${selected.city}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppType.bodyMedium.copyWith(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary)),
                const SizedBox(height: 2),
                Text(selected.line1,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppType.bodySmall
                        .copyWith(color: AppColors.textSecondary)),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.x10),
          GestureDetector(
            onTap: () => _openAddressPicker(context, uid, addresses, selected),
            behavior: HitTestBehavior.opaque,
            child: Text('Change',
                style: AppType.bodyMedium.copyWith(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.brandGreen)),
          ),
        ],
      ),
    );
  }

  Future<void> _openAddressPicker(BuildContext context, String uid,
      List<Address> addresses, Address selected) async {
    await AppBottomSheet.show<void>(
      context,
      title: 'Delivery address',
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final a in addresses)
            InkWell(
              onTap: () {
                context.read<CheckoutDraft>().setAddress(a.id);
                Navigator.of(context).pop();
              },
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.x12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      a.id == selected.id
                          ? Icons.radio_button_checked_rounded
                          : Icons.radio_button_unchecked_rounded,
                      size: 20,
                      color: a.id == selected.id
                          ? AppColors.brandGreen
                          : AppColors.textTertiary,
                    ),
                    const SizedBox(width: AppSpacing.x12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${a.label} · ${a.city}',
                              style: AppType.bodyMedium.copyWith(
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.textPrimary)),
                          const SizedBox(height: 2),
                          Text(a.line1,
                              style: AppType.bodySmall.copyWith(
                                  color: AppColors.textSecondary)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: AppSpacing.x8),
          AppButton.outlined(
            label: 'Add new address',
            icon: Icons.add_rounded,
            onPressed: () {
              Navigator.of(context).pop();
              context.push(Routes.addAddress);
            },
          ),
        ],
      ),
    );
  }

  // ── Delivery ───────────────────────────────────────────────────────
  /// States the delivery actually being charged for THIS bag.
  ///
  /// The label used to read a hard-coded "Standard · Free" no matter what, so
  /// with `standardFeePaise: 4900` and `freeDeliveryOverPaise: 149900` every
  /// bag under ₹1,499 promised free delivery directly above a ₹49 line in the
  /// summary below it. [s] is the same summary that prices the order, so the
  /// two can no longer disagree.
  Widget _deliveryCard(CheckoutSummary s) {
    final free = s.freeDelivery || s.deliveryPaise <= 0;
    final fee = free ? 'Free' : Money.fromPaise(s.deliveryPaise);
    final arrival = _repo.estimateArrival(_settings);
    final tomorrow = DateTime.now().add(const Duration(days: 1));
    final isTomorrow = arrival.year == tomorrow.year &&
        arrival.month == tomorrow.month &&
        arrival.day == tomorrow.day;
    final when = isTomorrow
        ? 'Arrives tomorrow'
        : 'Arrives ${DateFormat('EEE, d MMM').format(arrival)}';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      child: Row(
        children: [
          const Icon(Icons.local_shipping_rounded,
              size: 20, color: AppColors.brandGreen),
          const SizedBox(width: AppSpacing.x10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Standard · $fee',
                    style: AppType.bodyMedium.copyWith(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary)),
                const SizedBox(height: 2),
                Text(when,
                    style: AppType.bodySmall
                        .copyWith(color: AppColors.textSecondary)),
              ],
            ),
          ),
          const Icon(Icons.check_circle_rounded,
              size: 20, color: AppColors.brandGreen),
        ],
      ),
    );
  }

  // ── Payment method ─────────────────────────────────────────────────
  /// How this order will be paid. Online is now the only way to settle a
  /// balance (cash on delivery is gone, and the wallet is the switch below), so
  /// this states the method rather than offering a choice — a lone radio row
  /// that can never be unselected only reads as a broken selector.
  Widget _onlinePaymentCard() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.brandGreen, width: 1.5),
      ),
      child: Row(
        children: [
          const Icon(Icons.credit_card_rounded,
              size: 20, color: AppColors.brandGreen),
          const SizedBox(width: AppSpacing.x12),
          Expanded(
            child: Text('Card / UPI · Razorpay',
                style: AppType.bodyMedium.copyWith(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary)),
          ),
          const Icon(Icons.check_circle_rounded,
              size: 22, color: AppColors.brandGreen),
        ],
      ),
    );
  }

  /// The admin has switched online payment off. With cash on delivery gone
  /// there is no other way to settle a balance, so say so plainly instead of
  /// leaving the section blank above a pay bar that cannot work.
  Widget _onlinePaymentOffNote() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.destructiveRedLight,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border:
            Border.all(color: AppColors.destructiveRed.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          const Icon(Icons.credit_card_off_rounded,
              size: 20, color: AppColors.destructiveRed),
          const SizedBox(width: AppSpacing.x12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Online payment is unavailable',
                    style: AppType.bodyMedium.copyWith(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary)),
                const SizedBox(height: 2),
                Text('Please try again in a little while.',
                    style: AppType.bodySmall
                        .copyWith(color: AppColors.textSecondary)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Out-of-stock alert ─────────────────────────────────────────────
  /// Names exactly what went unavailable while the bag was sitting there, and
  /// offers the one-tap fix (drop the sold-out lines / trim to what's left) so
  /// the customer isn't sent back to the bag to work it out themselves.
  Widget _stockAlert(
      BuildContext context, List<CartLine> gone, List<CartLine> short) {
    final onlyShort = gone.isEmpty;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.destructiveRedLight,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border:
            Border.all(color: AppColors.destructiveRed.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.remove_shopping_cart_outlined,
                  size: 20, color: AppColors.destructiveRed),
              const SizedBox(width: AppSpacing.x10),
              Expanded(
                child: Text(
                    onlyShort
                        ? 'Not enough stock'
                        : gone.length == 1 && short.isEmpty
                            ? 'An item is out of stock'
                            : 'Some items are unavailable',
                    style: AppType.bodyMedium.copyWith(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary)),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.x8),
          for (final l in gone)
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Text('• ${l.name} — out of stock',
                  style:
                      AppType.bodySmall.copyWith(color: AppColors.textSecondary)),
            ),
          for (final l in short)
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Text(
                  '• ${l.name} — only ${_availableFor(l)} left (you have ${l.qty})',
                  style:
                      AppType.bodySmall.copyWith(color: AppColors.textSecondary)),
            ),
          const SizedBox(height: AppSpacing.x10),
          GestureDetector(
            onTap: () => _resolveStockIssues(gone, short),
            behavior: HitTestBehavior.opaque,
            child: Text(
                onlyShort ? 'Reduce to available quantity' : 'Update my bag',
                style: AppType.bodyMedium.copyWith(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: AppColors.destructiveRed)),
          ),
        ],
      ),
    );
  }

  /// Drops sold-out lines and trims over-ordered ones to what's actually left.
  void _resolveStockIssues(List<CartLine> gone, List<CartLine> short) {
    final cart = context.read<CartProvider>();
    for (final l in gone) {
      cart.remove(l.key);
    }
    for (final l in short) {
      final available = _availableFor(l);
      if (available != null && available > 0) cart.setQty(l.key, available);
    }
    AppToast.show(context, 'Bag updated');
  }

  // ── Nothing-to-pay note ────────────────────────────────────────────
  /// Shown in place of the payment method when the order is already covered.
  /// [fromWallet] distinguishes the two ways that happens — the balance paid it
  /// down to zero, or the discounts alone did — because "paid fully from
  /// wallet" on an order the wallet never touched is simply wrong.
  Widget _nothingToPayNote(bool fromWallet) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.brandGreenSubtle,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.brandGreen.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          const Icon(Icons.verified_rounded,
              size: 20, color: AppColors.brandGreen),
          const SizedBox(width: AppSpacing.x12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(fromWallet ? 'Paid fully from wallet' : 'Nothing to pay',
                    style: AppType.bodyMedium.copyWith(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary)),
                const SizedBox(height: 2),
                Text(
                    fromWallet
                        ? 'Nothing left to pay online.'
                        : 'Your offers cover this order in full.',
                    style: AppType.bodySmall
                        .copyWith(color: AppColors.textSecondary)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Wallet ─────────────────────────────────────────────────────────
  Widget _walletCard(
      BuildContext context, CheckoutDraft draft, int balancePaise) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.brandAmberLight.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.brandAmber.withValues(alpha: 0.5)),
      ),
      child: Row(
        children: [
          const Icon(Icons.account_balance_wallet_outlined,
              size: 20, color: AppColors.brandGoldStrong),
          const SizedBox(width: AppSpacing.x12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Use wallet balance',
                    style: AppType.bodyMedium.copyWith(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary)),
                const SizedBox(height: 2),
                Text('${Money.fromPaise(balancePaise)} available',
                    style: AppType.bodySmall
                        .copyWith(color: AppColors.brandGoldStrong)),
              ],
            ),
          ),
          Switch.adaptive(
            value: draft.useWallet,
            activeTrackColor: AppColors.brandGreen,
            onChanged: (v) => context.read<CheckoutDraft>().setUseWallet(v),
          ),
        ],
      ),
    );
  }

  // ── Summary ────────────────────────────────────────────────────────
  Widget _summaryCard(CheckoutSummary s) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.x16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      child: Column(
        children: [
          _row('Subtotal', Money.fromPaise(s.subtotalPaise)),
          if (s.discountPaise > 0) ...[
            const SizedBox(height: AppSpacing.x10),
            _row('Discount', '−${Money.fromPaise(s.discountPaise)}',
                color: AppColors.brandGreen),
          ],
          if (!s.freeDelivery && s.deliveryPaise > 0) ...[
            const SizedBox(height: AppSpacing.x10),
            _row('Delivery', Money.fromPaise(s.deliveryPaise)),
          ],
          if (s.taxPaise > 0) ...[
            const SizedBox(height: AppSpacing.x10),
            _row('GST', Money.fromPaise(s.taxPaise)),
          ],
          if (s.walletUsedPaise > 0) ...[
            const SizedBox(height: AppSpacing.x10),
            _row('Wallet', '−${Money.fromPaise(s.walletUsedPaise)}',
                color: AppColors.brandGreen),
          ],
          const Padding(
            padding: EdgeInsets.symmetric(vertical: AppSpacing.x12),
            child: Divider(height: 1, color: AppColors.borderSubtle),
          ),
          Row(
            children: [
              Expanded(
                child: Text('To pay',
                    style: AppType.bodyLarge.copyWith(
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary)),
              ),
              Text(Money.fromPaise(s.payablePaise),
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

  Widget _row(String label, String value, {Color? color}) {
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
                color: color ?? AppColors.textPrimary)),
      ],
    );
  }

  /// Hand off to the Payment screen, then rebuild on the way back — the wallet
  /// balance and the bag may both have moved while it was on top.
  Future<void> _openPayment(BuildContext context, int payablePaise) async {
    await context.push(Routes.payment, extra: payablePaise);
    if (mounted) setState(() {});
  }

  Widget _payBar(BuildContext context, CheckoutSummary s, bool hasAddress,
      {required bool walletOnly,
      bool blocked = false,
      CartLimit limit = CartLimit.none,
      bool paymentUnavailable = false}) {
    // A balance due → hand off to the Payment screen for the gateway leg. A
    // fully wallet-covered order has nothing to collect, so it is placed
    // outright here — no second "pay" step.
    final online = s.payablePaise > 0;
    final label =
        online ? 'Pay ${Money.fromPaise(s.payablePaise)}' : 'Place order';
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
            : limit.blocked
                ? 'Bag is too large'
                : paymentUnavailable
                    ? 'Payment unavailable'
                    : label,
        loading: _placing,
        // Stock first: an unavailable line has to go whatever the gateway is
        // doing, and it is the customer's to fix. A broken cap comes next —
        // `placeOrder` refuses such an order outright, so there is no point
        // starting a payment for it.
        onPressed: blocked
            ? () => AppToast.show(
                context, 'Remove the unavailable items to continue.',
                variant: AppToastVariant.error)
            : limit.blocked
                ? () => AppToast.show(context, limit.message!,
                    variant: AppToastVariant.error)
                : paymentUnavailable
                    ? () => AppToast.show(context,
                        'Online payment is unavailable right now. Please try again later.',
                        variant: AppToastVariant.error)
                    : hasAddress
                        ? (online
                            ? () => _openPayment(context, s.payablePaise)
                            : () => _placeOrder(walletOnly: walletOnly))
                        : () => AppToast.show(
                            context, 'Add a delivery address first.',
                            variant: AppToastVariant.error),
      ),
    );
  }
}
