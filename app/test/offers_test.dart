import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:barkath_app/features/checkout/data/offers.dart';

/// Every rule `evaluatePromoCoupon` / `evaluateUserCoupon` / `autoBestOffer`
/// (functions/src/orders/checkout.ts) apply, checked from the client side.
///
/// The contract these lock down: a listed offer with a live Apply button must
/// never be one `placeOrder` refuses, and an offer the server WOULD accept must
/// not be hidden.
void main() {
  Timestamp inDays(int d) =>
      Timestamp.fromDate(DateTime.now().add(Duration(days: d)));

  Map<String, dynamic> promo({
    String id = 'C1',
    String code = 'SAVE10',
    String status = 'active',
    bool active = true,
    String targetUsers = 'all',
    bool firstOrderOnly = false,
    String discountType = 'flat',
    int discountValuePaise = 10000,
    int discountPercent = 0,
    int? discountMaxCapPaise,
    int minCartValuePaise = 0,
    int? maxUsesTotal,
    int usesCount = 0,
    int maxUsesPerUser = 0,
    List<String> applicableCategories = const [],
    Timestamp? validFrom,
    Timestamp? validUntil,
    bool autoApply = true,
  }) =>
      {
        'id': id,
        'code': code,
        'status': status,
        'active': active,
        'targetUsers': targetUsers,
        'firstOrderOnly': firstOrderOnly,
        'discountType': discountType,
        'discountValuePaise': discountValuePaise,
        'discountPercent': discountPercent,
        'discountMaxCapPaise': discountMaxCapPaise,
        'minCartValuePaise': minCartValuePaise,
        'maxUsesTotal': maxUsesTotal,
        'usesCount': usesCount,
        'maxUsesPerUser': maxUsesPerUser,
        'applicableCategories': applicableCategories,
        'validFrom': validFrom,
        'validUntil': validUntil,
        'autoApply': autoApply,
      };

  Map<String, dynamic> personal({
    String code = 'SPIN-AAAAA',
    String status = 'active',
    String source = 'spin',
    int usesCount = 0,
    int maxUsesPerCoupon = 1,
    int minCartValuePaise = 0,
    String discountType = 'flat',
    int discountValuePaise = 5000,
    Timestamp? expiresAt,
  }) =>
      {
        'code': code,
        'status': status,
        'source': source,
        'usesCount': usesCount,
        'maxUsesPerCoupon': maxUsesPerCoupon,
        'minCartValuePaise': minCartValuePaise,
        'discountType': discountType,
        'discountValuePaise': discountValuePaise,
        'expiresAt': expiresAt,
      };

  List<OfferOption> list(
    List<Map<String, dynamic>> promos, {
    int subtotal = 100000,
    List<Map<String, dynamic>> user = const [],
    List<OfferCartLine>? lines,
    CustomerOfferFacts facts = CustomerOfferFacts.unknown,
  }) =>
      listAvailableOffers(subtotal, user, promos,
          cartLines: lines, facts: facts);

  CustomerOfferFacts facts({
    int ordersCount = 0,
    bool affiliateEnabled = false,
    Map<String, int> usage = const {},
    bool factsKnown = true,
    bool usageKnown = true,
  }) =>
      CustomerOfferFacts(
        ordersCount: ordersCount,
        affiliateEnabled: affiliateEnabled,
        promoUsage: usage,
        factsKnown: factsKnown,
        usageKnown: usageKnown,
      );

  // ── The reported bug: per-customer allowance spent ──────────────────
  group('maxUsesPerUser', () {
    test('a coupon the customer has used up is listed but not applicable', () {
      // The exact production shape: global budget left (1 of 2 used), but this
      // customer's own counter is at their limit of 1.
      final offers = list(
        [promo(maxUsesTotal: 2, usesCount: 1, maxUsesPerUser: 1)],
        facts: facts(usage: {'C1': 1}),
      );
      expect(offers, hasLength(1), reason: 'tagged, not dropped');
      expect(offers.single.canApply, isFalse);
      expect(offers.single.unavailableReason, 'Already used');
      // The bag is fine — this is not the "add more to your bag" state.
      expect(offers.single.qualifies, isTrue);
    });

    test('the same coupon is applicable with a use still left', () {
      final offers = list(
        [promo(maxUsesTotal: 2, usesCount: 1, maxUsesPerUser: 2)],
        facts: facts(usage: {'C1': 1}),
      );
      expect(offers.single.canApply, isTrue);
      expect(offers.single.unavailableReason, isNull);
    });

    test('a customer with no usage doc at all can apply', () {
      final offers =
          list([promo(maxUsesPerUser: 1)], facts: facts(usage: const {}));
      expect(offers.single.canApply, isTrue);
    });

    test('a released (negative) counter does not grant extra redemptions', () {
      // performCancellation decrements; the server floors at 0 and so must we.
      final offers = list([promo(maxUsesPerUser: 1)],
          facts: facts(usage: {'C1': -3}));
      expect(offers.single.canApply, isTrue);
    });

    test('an unreadable couponUsage falls back to the old behaviour', () {
      // The rule may not be deployed: never hide, never crash, never tag.
      final offers = list(
        [promo(maxUsesTotal: 2, usesCount: 1, maxUsesPerUser: 1)],
        facts: facts(usage: const {}, usageKnown: false),
      );
      expect(offers, hasLength(1));
      expect(offers.single.canApply, isTrue);
      expect(offers.single.unavailableReason, isNull);
    });

    test('maxUsesPerUser 0/absent means no per-customer limit', () {
      final offers =
          list([promo(maxUsesPerUser: 0)], facts: facts(usage: {'C1': 9}));
      expect(offers.single.canApply, isTrue);
    });

    test('usage is matched by coupon DOC ID, not by code', () {
      final offers = list(
        [promo(id: 'realDocId', code: 'SAVE10', maxUsesPerUser: 1)],
        facts: facts(usage: {'SAVE10': 1}),
      );
      expect(offers.single.canApply, isTrue,
          reason: 'a code-keyed counter is not this coupon');
    });
  });

  // ── Dead for everybody → not listed at all ─────────────────────────
  group('globally unusable coupons are not listed', () {
    test('paused with active:false', () {
      expect(list([promo(active: false)]), isEmpty);
    });
    test('status not active', () {
      expect(list([promo(status: 'expired')]), isEmpty);
    });
    test('global usage limit reached', () {
      expect(list([promo(maxUsesTotal: 5, usesCount: 5)]), isEmpty);
    });
    test('global usage limit exceeded', () {
      expect(list([promo(maxUsesTotal: 5, usesCount: 6)]), isEmpty);
    });
    test('expired validUntil', () {
      expect(list([promo(validUntil: inDays(-1))]), isEmpty);
    });
    test('not started yet', () {
      expect(list([promo(validFrom: inDays(1))]), isEmpty);
    });
    test('no usage limit configured is unlimited', () {
      expect(list([promo(usesCount: 999)]), hasLength(1));
    });
  });

  // ── Audience ────────────────────────────────────────────────────────
  group('targetUsers', () {
    test("'existing' is hidden from a customer with no orders", () {
      expect(list([promo(targetUsers: 'existing')], facts: facts()), isEmpty);
    });
    test("'existing' is offered to a returning customer", () {
      expect(list([promo(targetUsers: 'existing')], facts: facts(ordersCount: 3)),
          hasLength(1));
    });
    test("'affiliates' is hidden from a non-affiliate", () {
      expect(list([promo(targetUsers: 'affiliates')], facts: facts()), isEmpty);
    });
    test("'affiliates' is offered to an affiliate", () {
      expect(
          list([promo(targetUsers: 'affiliates')],
              facts: facts(affiliateEnabled: true)),
          hasLength(1));
    });
    test("'new' is offered — the server accepts it for everyone", () {
      expect(list([promo(targetUsers: 'new')], facts: facts()), hasLength(1));
    });
    test('an unknown segment fails closed, as the server does', () {
      expect(list([promo(targetUsers: 'segment')], facts: facts()), isEmpty);
    });
    test('audience rules are skipped when the customer read failed', () {
      // Conservative fallback: exactly what the app did before it had facts.
      expect(
          list([promo(targetUsers: 'existing')],
              facts: facts(factsKnown: false)),
          isEmpty);
    });
  });

  group('firstOrderOnly', () {
    test('is tagged, not hidden, once the customer has ordered', () {
      final offers = list([promo(firstOrderOnly: true, targetUsers: 'new')],
          facts: facts(ordersCount: 1));
      expect(offers, hasLength(1));
      expect(offers.single.unavailableReason, 'First order only');
      expect(offers.single.canApply, isFalse);
    });
    test('is applicable for a customer with no orders', () {
      final offers = list([promo(firstOrderOnly: true, targetUsers: 'new')],
          facts: facts());
      expect(offers, hasLength(1));
      expect(offers.single.canApply, isTrue);
      expect(offers.single.unavailableReason, isNull);
    });
    test('is left unchecked when the customer read failed', () {
      final offers = list([promo(firstOrderOnly: true)],
          facts: facts(factsKnown: false));
      expect(offers.single.unavailableReason, isNull);
    });
    test('is never auto-applied', () {
      final offers = list([promo(firstOrderOnly: true)], facts: facts());
      expect(offers.single.autoApplicable, isFalse);
      expect(bestAutoOffer(offers), isNull);
    });
  });

  // ── Auto-apply audience, verbatim from the server's autoBestOffer ────
  group('auto-apply is restricted to broadly targeted coupons', () {
    for (final target in ['new', 'existing', 'affiliates']) {
      test("'$target' is listed but never auto-applied", () {
        final offers = list([promo(targetUsers: target)],
            facts: facts(ordersCount: 2, affiliateEnabled: true));
        expect(offers, hasLength(1));
        expect(offers.single.canApply, isTrue);
        expect(offers.single.autoApplicable, isFalse);
        expect(bestAutoOffer(offers), isNull);
      });
    }
    test("'all' still auto-applies", () {
      final offers = list([promo(targetUsers: 'all')], facts: facts());
      expect(offers.single.autoApplicable, isTrue);
      expect(bestAutoOffer(offers)?.code, 'SAVE10');
    });
  });

  // ── Cart minimum ────────────────────────────────────────────────────
  group('minCartValuePaise', () {
    test('below the minimum locks the row without tagging it as used', () {
      final offers = list([promo(minCartValuePaise: 200000)],
          subtotal: 100000, facts: facts());
      expect(offers.single.qualifies, isFalse);
      expect(offers.single.canApply, isFalse);
      expect(offers.single.unavailableReason, isNull,
          reason: 'the existing "add ₹x more" copy must still be used');
      expect(offers.single.shortfallPaise, 100000);
    });
    test('at the minimum it qualifies', () {
      final offers = list([promo(minCartValuePaise: 100000)],
          subtotal: 100000, facts: facts());
      expect(offers.single.canApply, isTrue);
    });
  });

  // ── Categories ──────────────────────────────────────────────────────
  group('applicableCategories', () {
    test('a bag with no eligible line is not listed', () {
      final offers = list(
        [promo(applicableCategories: ['books'])],
        lines: const [
          OfferCartLine(categorySlug: 'perfumes', lineTotalPaise: 100000)
        ],
        facts: facts(),
      );
      expect(offers, isEmpty);
    });

    test('the discount is limited to the eligible lines', () {
      final offers = list(
        [
          promo(
              applicableCategories: ['books'],
              discountType: 'percent',
              discountValuePaise: 0,
              discountPercent: 50)
        ],
        subtotal: 100000,
        lines: const [
          OfferCartLine(categorySlug: 'books', lineTotalPaise: 40000),
          OfferCartLine(categorySlug: 'perfumes', lineTotalPaise: 60000),
        ],
        facts: facts(),
      );
      expect(offers.single.discountPaise, 20000); // 50% of the books line only
    });

    test('unknown categories block auto-apply rather than over-promise', () {
      final offers = list(
        [promo(applicableCategories: ['books'])],
        facts: facts(),
      );
      expect(offers.single.autoApplicable, isFalse);
      expect(offers.single.discountPaise, 0);
    });
  });

  // ── Amounts ─────────────────────────────────────────────────────────
  group('discount amount mirrors couponAmount', () {
    test('percent is capped by discountMaxCapPaise', () {
      final offers = list([
        promo(
            discountType: 'percent',
            discountPercent: 50,
            discountMaxCapPaise: 15000)
      ], subtotal: 100000, facts: facts());
      expect(offers.single.discountPaise, 15000);
    });
    test('a flat coupon never exceeds the subtotal', () {
      final offers = list([promo(discountValuePaise: 500000)],
          subtotal: 100000, facts: facts());
      expect(offers.single.discountPaise, 100000);
    });
    test('free_shipping is worth nothing but waives delivery', () {
      final offers =
          list([promo(discountType: 'free_shipping')], facts: facts());
      expect(offers.single.discountPaise, 0);
      expect(offers.single.waiveDelivery, isTrue);
      expect(bestAutoOffer(offers)?.code, 'SAVE10');
    });
  });

  // ── Personal (spin) coupons ─────────────────────────────────────────
  group('personal coupons', () {
    test('one whose uses are spent is not listed', () {
      final offers = list(const [],
          user: [personal(usesCount: 1, maxUsesPerCoupon: 1)], facts: facts());
      expect(offers, isEmpty);
    });
    test('a multi-use one with a use left is listed', () {
      final offers = list(const [],
          user: [personal(usesCount: 1, maxUsesPerCoupon: 3)], facts: facts());
      expect(offers.single.canApply, isTrue);
    });
    test('an expired one is not listed', () {
      final offers = list(const [],
          user: [personal(expiresAt: inDays(-1))], facts: facts());
      expect(offers, isEmpty);
    });
    test('below its minimum it locks rather than disappears', () {
      final offers = list(const [],
          user: [personal(minCartValuePaise: 500000)],
          subtotal: 100000,
          facts: facts());
      expect(offers.single.canApply, isFalse);
      expect(offers.single.unavailableReason, isNull);
    });
  });

  // ── Auto-apply ──────────────────────────────────────────────────────
  group('bestAutoOffer', () {
    test('never returns a coupon the customer has used up', () {
      final offers = list([promo(maxUsesPerUser: 1)], facts: facts(usage: {'C1': 1}));
      expect(bestAutoOffer(offers), isNull);
    });
    test('never returns a per-customer-limited coupon (server does not)', () {
      final offers = list([promo(maxUsesPerUser: 1)], facts: facts());
      expect(bestAutoOffer(offers), isNull);
    });
    test('never returns a below-minimum coupon', () {
      final offers = list([promo(minCartValuePaise: 900000)],
          subtotal: 100000, facts: facts());
      expect(bestAutoOffer(offers), isNull);
    });
    test('picks the largest applicable discount', () {
      final offers = list([
        promo(id: 'A', code: 'SMALL', discountValuePaise: 5000),
        promo(id: 'B', code: 'BIG', discountValuePaise: 20000),
      ], facts: facts());
      expect(bestAutoOffer(offers)?.code, 'BIG');
    });
    test('autoApply:false is respected', () {
      final offers = list([promo(autoApply: false)], facts: facts());
      expect(bestAutoOffer(offers), isNull);
    });
  });

  // ── Ordering (same comparator as the web) ───────────────────────────
  test('applicable offers sort above locked ones, blocked ones last', () {
    final offers = list([
      promo(id: 'A', code: 'USED', maxUsesPerUser: 1),
      promo(id: 'B', code: 'LOCKED', minCartValuePaise: 900000),
      promo(id: 'C', code: 'OK', discountValuePaise: 5000),
    ], subtotal: 100000, facts: facts(usage: {'A': 1}));
    expect(offers.map((o) => o.code).toList(), ['OK', 'LOCKED', 'USED']);
  });

  // ── My Coupons: cart-independent status + visibility for promo coupons ──
  // The bug this locks down: an admin-created coupon applied fine at
  // checkout but never appeared on the My Coupons screen, and nothing ever
  // showed one as "Used" once its personal allowance was spent.
  group('promoPersonalStatus / promoVisibleToCustomer', () {
    final now = DateTime.now().millisecondsSinceEpoch;

    test('fresh, broadly-targeted, unused coupon is active and visible', () {
      final c = promo(maxUsesPerUser: 1);
      expect(promoPersonalStatus(c, facts(), now), 'active');
      expect(promoVisibleToCustomer(c, facts(), now), isTrue);
    });

    test('per-user allowance spent is used, and stays visible', () {
      final c = promo(id: 'A', maxUsesPerUser: 1);
      final f = facts(usage: {'A': 1});
      expect(promoPersonalStatus(c, f, now), 'used');
      expect(promoVisibleToCustomer(c, f, now), isTrue);
    });

    test('multi-use coupon: partial use stays active, full use is used', () {
      final c = promo(id: 'A', maxUsesPerUser: 3);
      expect(promoPersonalStatus(c, facts(usage: {'A': 1}), now), 'active');
      expect(promoPersonalStatus(c, facts(usage: {'A': 3}), now), 'used');
    });

    test('unlimited per-user (maxUsesPerUser: 0) never reads as used', () {
      final c = promo(id: 'A', maxUsesPerUser: 0);
      expect(promoPersonalStatus(c, facts(usage: {'A': 50}), now), 'active');
    });

    test('expired, never used, is expired and hidden', () {
      final c = promo(validUntil: Timestamp.fromDate(
          DateTime.now().subtract(const Duration(days: 1))));
      expect(promoPersonalStatus(c, facts(), now), 'expired');
      expect(promoVisibleToCustomer(c, facts(), now), isFalse);
    });

    test('expired but already used stays visible as Used (used wins)', () {
      final c = promo(
          id: 'A',
          maxUsesPerUser: 1,
          validUntil: Timestamp.fromDate(
              DateTime.now().subtract(const Duration(days: 1))));
      final f = facts(usage: {'A': 1});
      expect(promoPersonalStatus(c, f, now), 'used');
      expect(promoVisibleToCustomer(c, f, now), isTrue);
    });

    test('paused (active:false), never used, is hidden', () {
      final c = promo(active: false, status: 'paused');
      expect(promoPersonalStatus(c, facts(), now), 'expired');
      expect(promoVisibleToCustomer(c, facts(), now), isFalse);
    });

    test('scheduled (validFrom in the future), never used, is hidden', () {
      final c = promo(validFrom: inDays(1));
      expect(promoVisibleToCustomer(c, facts(), now), isFalse);
    });

    test('globally exhausted (maxUsesTotal reached) is hidden', () {
      final c = promo(maxUsesTotal: 100, usesCount: 100);
      expect(promoVisibleToCustomer(c, facts(), now), isFalse);
    });

    test("targetUsers 'existing': hidden for a new customer, visible for a "
        'returning one', () {
      final c = promo(targetUsers: 'existing');
      expect(promoVisibleToCustomer(c, facts(ordersCount: 0), now), isFalse);
      expect(promoVisibleToCustomer(c, facts(ordersCount: 3), now), isTrue);
    });

    test("targetUsers 'new' is visible regardless of order history", () {
      final c = promo(targetUsers: 'new');
      expect(promoVisibleToCustomer(c, facts(ordersCount: 5), now), isTrue);
    });

    test("targetUsers 'affiliates': hidden unless affiliate-enabled", () {
      final c = promo(targetUsers: 'affiliates');
      expect(
          promoVisibleToCustomer(c, facts(affiliateEnabled: false), now),
          isFalse);
      expect(
          promoVisibleToCustomer(c, facts(affiliateEnabled: true), now),
          isTrue);
    });

    test('no validUntil (no expiry) is active indefinitely', () {
      final c = promo();
      expect(promoPersonalStatus(c, facts(), now), 'active');
    });
  });
}
