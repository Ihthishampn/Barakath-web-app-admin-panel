import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../../../core/utils/expiry.dart';
import '../../cart/data/cart_line.dart';

/// A redeemable offer resolved for the current cart. Mirrors the web
/// `OfferOption` (listAvailableOffers in checkout/offers.ts) so app + web show
/// the same coupons/discounts. `placeOrder` re-validates authoritatively.
class OfferOption {
  const OfferOption({
    required this.code,
    required this.headline,
    required this.sub,
    required this.discountPaise,
    required this.qualifies,
    required this.shortfallPaise,
    required this.minPaise,
    required this.source, // 'spin' | 'promo'
    required this.waiveDelivery,
    required this.autoApplicable,
    this.unavailableReason,
  });

  final String code;
  final String headline; // base discount: "₹10 off" / "15% off"
  final String sub; // "Spin reward · min ₹50 · expires in 3 days"
  final int discountPaise;
  final bool qualifies;
  final int shortfallPaise;
  final int minPaise;
  final String source;

  /// A `free_shipping` coupon discounts nothing but waives the delivery fee
  /// server-side (`summarise` in functions/src/orders/checkout.ts), so the
  /// summary has to know about it or it charges delivery the server won't.
  final bool waiveDelivery;

  /// May this offer be put on the draft without the customer choosing it?
  ///
  /// The server auto-applies an offer ONLY when it passes every rule in
  /// `autoBestOffer` (functions/src/orders/checkout.ts) — including the
  /// redemption limits it deliberately refuses to guess at client-side. An
  /// offer that fails only those limits is still listed: tapping it is a
  /// deliberate choice, and `placeOrder` then validates it in full.
  final bool autoApplicable;

  /// Short label for a refusal the client can already prove — "Already used",
  /// "First order only". Non-null means the row must be shown WITHOUT an Apply
  /// button: tapping it would only round-trip to `applyCoupon` and come back as
  /// an error. Unlike [qualifies] this can never be fixed by adding more to the
  /// bag. Same field, same wording and same values as the web's
  /// `OfferOption.unavailableReason` (web/src/components/checkout/offers.ts).
  final String? unavailableReason;

  /// May the customer tap Apply on this offer?
  ///
  /// False when the bag is under the coupon's minimum (the pre-existing
  /// "Locked" state) OR when a per-customer rule is spent — both are refusals
  /// `placeOrder` makes, so neither may present a working Apply button.
  bool get canApply => qualifies && unavailableReason == null;
}

/// The facts about the signed-in customer that a coupon is judged against —
/// the client's copy of the server's `CustomerFacts` plus the per-customer
/// redemption counters (`customers/{uid}/couponUsage`).
///
/// Both halves carry a "did we actually read this?" flag. A rule that cannot be
/// verified is never enforced: the read may legitimately fail (the couponUsage
/// rule may not be deployed yet, or the device is offline), and refusing every
/// coupon on a failed read would be far worse than the behaviour this replaces.
class CustomerOfferFacts {
  const CustomerOfferFacts({
    this.ordersCount = 0,
    this.affiliateEnabled = false,
    this.promoUsage = const {},
    this.promoLastUsedAt = const {},
    this.factsKnown = false,
    this.usageKnown = false,
  });

  /// Nothing read yet — every rule that needs a customer read is skipped.
  static const unknown = CustomerOfferFacts();

  /// `customers/{uid}.stats.ordersCount` — what `firstOrderOnly` and the
  /// 'existing' audience are judged on.
  final int ordersCount;

  /// `customers/{uid}.affiliate.enabled` — the 'affiliates' audience.
  final bool affiliateEnabled;

  /// couponId → how many times THIS customer has redeemed that promotional
  /// coupon (`customers/{uid}/couponUsage/{couponId}.count`).
  final Map<String, int> promoUsage;

  /// couponId → `customers/{uid}/couponUsage/{couponId}.lastUsedAt` — when
  /// this coupon was used to place an order, if ever. Only "My Coupons" reads
  /// this (for the "Used · `date`" ticket); no discount rule needs it.
  final Map<String, DateTime> promoLastUsedAt;

  /// True once the customer document has been read.
  final bool factsKnown;

  /// True once `couponUsage` has been read (i.e. the per-customer limit is
  /// verifiable at all).
  final bool usageKnown;

  /// Floored at zero exactly as the server's `usageCount` floors it — the
  /// cancellation path can drive a counter negative, and a negative count must
  /// not read as "extra redemptions available".
  int usesOfPromo(String couponId) {
    final n = promoUsage[couponId] ?? 0;
    return n < 0 ? 0 : n;
  }

  /// When this coupon was last used to place an order, or null if never
  /// (or unread).
  DateTime? lastUsedOfPromo(String couponId) => promoLastUsedAt[couponId];
}

/// One bag line as the coupon engine scores it.
///
/// [categorySlug] is the product's `categorySlug` — the same value the server
/// matches a coupon's `applicableCategories` against (`PricedLine.category` in
/// functions/src/orders/checkout.ts). [lineTotalPaise] is `price × qty`, the
/// same pairing `discountableSubtotal` works from.
class OfferCartLine {
  const OfferCartLine({
    required this.categorySlug,
    required this.lineTotalPaise,
  });

  final String? categorySlug;
  final int lineTotalPaise;
}

/// The bag in the shape the coupon engine needs.
///
/// Returns null while [categories] is still unknown: a category restriction we
/// cannot verify must never be priced as if it did not exist (see
/// [_discountableSubtotal]). [categories] maps productId → `categorySlug`, as
/// streamed by [OffersRepository.cartCategories] — the app's cart lines don't
/// carry the slug themselves.
List<OfferCartLine>? offerCartLines(
    List<CartLine> lines, Map<String, String>? categories) {
  if (categories == null) return null;
  return [
    for (final l in lines)
      OfferCartLine(
        categorySlug: categories[l.productId],
        lineTotalPaise: l.linePaise,
      ),
  ];
}

String _rupees(num paise) => '₹${(paise / 100).round()}';

/// Reads a paise/count field. Only the names the admin actually writes (and the
/// server reads) are accepted — a fallback chain would silently resolve to 0
/// and turn a real limit into "no limit", which is exactly how the web let
/// minimums and caps go unenforced.
int _num(Map m, String key) {
  final v = m[key];
  return v is num ? v.toInt() : 0;
}

int? _millis(Object? v) => v is Timestamp ? v.millisecondsSinceEpoch : null;

int? _expiryMillis(Map m) => _millis(m['expiresAt']) ?? _millis(m['validUntil']);

String? _expiryLabel(Map m) {
  if ((m['noExpiry'] as bool?) == true) return null;
  final ms = _expiryMillis(m);
  if (ms == null) return null;
  return expiryLabelShort(DateTime.fromMillisecondsSinceEpoch(ms));
}

/// Category *slugs* a coupon is limited to; empty/absent = every category.
List<String> _applicableCategories(Map c) {
  final raw = c['applicableCategories'];
  if (raw is! List) return const [];
  return raw.map((e) => e.toString()).where((s) => s.isNotEmpty).toList();
}

/// Subtotal of the bag lines a coupon may actually discount — the app's copy of
/// `discountableSubtotal` (functions/src/orders/checkout.ts), which restricts
/// BOTH a coupon's validity and its amount to `applicableCategories`.
///
/// Returns null when the coupon IS restricted but the caller could not supply
/// the bag's categories: the restriction is unverifiable here, and an
/// unverifiable restriction must never be advertised as a qualifying discount —
/// the server would grant less than the screen promised.
int? _discountableSubtotal(
    Map c, int subtotalPaise, List<OfferCartLine>? lines) {
  final cats = _applicableCategories(c);
  if (cats.isEmpty) return subtotalPaise;
  if (lines == null) return null;
  var sum = 0;
  for (final l in lines) {
    final slug = l.categorySlug;
    if (slug != null && slug.isNotEmpty && cats.contains(slug)) {
      sum += l.lineTotalPaise;
    }
  }
  return sum;
}

/// The discount a coupon is worth for this bag, term-for-term as the server
/// computes it in `computeCouponDiscount` (functions/src/orders/checkout.ts):
/// flat → the flat value, percent → a percentage of the ELIGIBLE subtotal
/// (capped), free_shipping → nothing, and never more than the eligible subtotal.
///
/// 0 when the bag is below the minimum or no line is in an eligible category.
int _discount(Map c, int subtotalPaise, List<OfferCartLine>? lines) {
  if (subtotalPaise < _num(c, 'minCartValuePaise')) return 0;
  final eligible = _discountableSubtotal(c, subtotalPaise, lines);
  if (eligible == null || eligible <= 0) return 0;
  final type = (c['discountType'] as String?) ?? '';
  var d = 0;
  if (type == 'flat') {
    d = _num(c, 'discountValuePaise');
  } else if (type == 'percent') {
    d = (eligible * _num(c, 'discountPercent') / 100).round();
    final cap = _num(c, 'discountMaxCapPaise');
    if (cap > 0) d = d < cap ? d : cap;
  }
  return d.clamp(0, eligible).toInt();
}

/// The promotional coupon's document id, which is also the id of the
/// per-customer counter (`customers/{uid}/couponUsage/{couponId}`). Stamped
/// onto the map by [OffersRepository.promoCoupons] from the snapshot, so it is
/// present even on a coupon document that predates the admin writing `id`.
String _couponId(Map c) => (c['id'] as String?) ?? '';

/// Is this coupon addressed to this customer at all?
///
/// Mirrors the server's `assertCouponAudience` (functions/src/orders/
/// checkout.ts) and the web's `audienceAllows` term for term.
///
/// 'new' is NOT an audience the server rejects — it is expressed through
/// `firstOrderOnly`, checked separately in [_promoBlocked] — so a blanket
/// `targetUsers != 'all'` hid every first-order coupon from precisely the new
/// customers it was created for. 'existing' and 'affiliates' are answerable
/// from the customer document; anything else fails closed, as the server does.
///
/// With no customer read ([CustomerOfferFacts.factsKnown] false) this keeps the
/// pre-existing "broadly targeted only" behaviour.
bool _audienceOk(Map c, CustomerOfferFacts f) {
  final target = (c['targetUsers'] as String?) ?? 'all';
  if (target == 'all' || target == 'new') return true;
  if (!f.factsKnown) return false; // unverifiable — keep the old, safe answer
  if (target == 'existing') return f.ordersCount > 0;
  if (target == 'affiliates') return f.affiliateEnabled;
  // 'segment' (and anything else) has no model on any surface; the server fails
  // closed with "This coupon is not available on your account."
  return false;
}

/// Why this customer can NEVER redeem this coupon, however big their bag gets —
/// or null when nothing here blocks it.
///
/// The two rules that depend on the customer rather than the cart, both hard
/// refusals in `evaluatePromoCoupon`:
///   • `firstOrderOnly` once they have ordered — "This coupon is for first
///     orders only."
///   • `maxUsesPerUser` against `customers/{uid}/couponUsage/{couponId}.count`
///     — "You have already used this coupon."
///
/// Surfaced as a reason instead of hiding the row: the coupon is genuinely
/// theirs to see, it just cannot be applied (again), and an Apply button that
/// always fails is worse than a row that says why. Wording and order match the
/// web's `promoBlockedReason` exactly.
///
/// Null while the reads behind them have not landed: an unverifiable rule is
/// left exactly as it behaved before, i.e. enforced by the server on Apply.
String? _promoBlocked(Map c, CustomerOfferFacts f) {
  if (!f.factsKnown) return null;
  if ((c['firstOrderOnly'] as bool?) == true && f.ordersCount > 0) {
    return 'First order only';
  }
  final perUser = _num(c, 'maxUsesPerUser');
  // Unreadable counters mean the limit is UNKNOWN and must not be guessed at.
  if (perUser > 0 && f.usageKnown && f.usesOfPromo(_couponId(c)) >= perUser) {
    return 'Already used';
  }
  return null;
}

/// Cart-independent "My Coupons" status for a promotional coupon
/// (`coupons/{id}`) — 'active' (redeemable now), 'used' (this customer's
/// personal allowance is spent) or 'expired' (no longer reachable at all:
/// paused, wrong audience, outside its validity window, or globally
/// exhausted). Matches the vocabulary `UserCoupon.status` already uses
/// (app/lib/features/coupons/data/user_coupon.dart), so the existing
/// `UserCoupon.state` getter needs no changes to display it.
///
/// Deliberately has no cart/subtotal/category args — "My Coupons" lists a
/// coupon regardless of what's in the bag right now; `minCartValuePaise` is
/// shown as informational text, not a gate, same as a personal coupon's.
String promoPersonalStatus(Map c, CustomerOfferFacts f, int now) {
  final perUser = _num(c, 'maxUsesPerUser');
  final used = f.usesOfPromo(_couponId(c));
  if (perUser > 0 && used >= perUser) return 'used';

  if (!_active(c)) return 'expired';
  if ((c['active'] as bool?) == false) return 'expired';
  if (!_audienceOk(c, f)) return 'expired';
  final from = _millis(c['validFrom']);
  if (from != null && from > now) return 'expired';
  final until = _millis(c['validUntil']);
  if (until != null && until < now) return 'expired';
  final maxTotal = c['maxUsesTotal'];
  if (maxTotal is num &&
      _num(c, 'usesCount').clamp(0, 1 << 31) >= maxTotal.toInt()) {
    return 'expired';
  }
  return 'active';
}

/// Does this promotional coupon belong on "My Coupons" for this customer at
/// all — either they can redeem it right now, or they already have (in which
/// case it stays visible as a historical "Used" ticket even after the admin
/// pauses it, it expires, or the audience it targets no longer includes
/// them).
bool promoVisibleToCustomer(Map c, CustomerOfferFacts f, int now) {
  if (f.usesOfPromo(_couponId(c)) > 0) return true;
  return promoPersonalStatus(c, f, now) == 'active';
}

/// Is this PROMOTIONAL coupon redeemable at all for this customer + bag?
///
/// The rules the client can verify from the coupon document itself, checked as
/// `computeCouponDiscount` (functions/src/orders/checkout.ts) checks them. A
/// coupon that fails one of these is refused at placement, so it must not be
/// listed either — a redeemed-out coupon sitting in "Available for you" with an
/// Apply button is the app advertising something checkout will reject.
///
/// [facts] carries the customer reads the rules need (`stats.ordersCount`,
/// `affiliate.enabled`). Anything it could not read is simply not enforced —
/// see [CustomerOfferFacts].
///
/// `maxUsesPerUser` and `firstOrderOnly` are NOT part of this gate: they do not
/// make the coupon invisible, they make it unusable. They are reported by
/// [_promoBlocked], which turns them into a visible "Already used" / "First
/// order only" row with no Apply — see the web's `promoRedeemable`, which draws
/// the same line.
bool _promoRedeemable(Map c, int subtotalPaise, int now,
    List<OfferCartLine>? lines, CustomerOfferFacts facts) {
  if (!_active(c)) return false;
  // `active: false` is the admin's pause switch and is separate from `status`;
  // the list checked only the latter, so a paused coupon stayed on offer.
  if ((c['active'] as bool?) == false) return false;
  if (!_audienceOk(c, facts)) return false;

  // Validity windows are read from the fields the admin writes and the server
  // checks (`validFrom` / `validUntil`) — nothing writes `noExpiry`.
  final from = _millis(c['validFrom']);
  if (from != null && from > now) return false;
  final until = _millis(c['validUntil']);
  if (until != null && until < now) return false;

  // Usage limit reached — the server answers "This coupon has reached its usage
  // limit." Nothing on this screen used to check it, so an exhausted coupon
  // stayed on offer to every customer for ever.
  final maxTotal = c['maxUsesTotal'];
  if (maxTotal is num &&
      _num(c, 'usesCount').clamp(0, 1 << 31) >= maxTotal.toInt()) {
    return false;
  }

  // Drop the ones this bag provably cannot use — the server refuses them with
  // "This coupon does not apply to the items in your bag." A null (categories
  // not loaded yet) is NOT provable, so those stay listed, priced at 0 until
  // the bag's categories arrive.
  return _discountableSubtotal(c, subtotalPaise, lines) != 0;
}

/// May the server auto-apply this PROMOTIONAL coupon?
///
/// Mirrors `autoBestOffer` (functions/src/orders/checkout.ts) — including its
/// deliberate refusal to auto-apply a coupon whose per-customer limit it cannot
/// check inside that loop. Admin stamps `maxUsesPerUser: 1` on every coupon it
/// creates, so auto-applying one anyway got a returning customer's `placeOrder`
/// rejected outright with "You have already used this coupon."
bool _promoAutoApplicable(Map c, int subtotalPaise, int now,
    List<OfferCartLine>? lines, CustomerOfferFacts facts) {
  if (!_promoRedeemable(c, subtotalPaise, now, lines, facts)) return false;
  // A coupon this customer has already spent can never be auto-applied — it
  // would put a code on the order that `placeOrder` rejects outright. Belt and
  // braces alongside the `maxUsesPerUser` rule below, which already covers
  // every coupon the admin creates.
  if (_promoBlocked(c, facts) != null) return false;
  if ((c['autoApply'] as bool?) == false) return false;
  // `autoBestOffer` auto-applies BROADLY targeted coupons only — its very first
  // test is `targetUsers && targetUsers !== 'all'`. Listing a 'new' / 'existing'
  // / 'affiliates' coupon (which the audience gate now correctly allows) must
  // not make it auto-appliable, or the app would put a code on the order that
  // the server's own auto-apply would never have chosen.
  final target = c['targetUsers'] as String?;
  if (target != null && target != 'all') return false;
  if (subtotalPaise < _num(c, 'minCartValuePaise')) return false;

  // Per-customer limits are checked by the SERVER's auto-apply loop with a read
  // it refuses to make there, so it never auto-applies these; the app must not
  // either, or the two disagree about what the order costs. Entering/tapping
  // the code still works and validates fully server-side.
  if ((c['firstOrderOnly'] as bool?) == true) return false;
  if (_num(c, 'maxUsesPerUser') > 0) return false;

  // A restriction we cannot verify (categories unknown) is not auto-appliable.
  final eligible = _discountableSubtotal(c, subtotalPaise, lines);
  return eligible != null && eligible > 0;
}

/// Is this PERSONAL (spin/welcome) coupon still redeemable?
///
/// `usesCount` against `maxUsesPerCoupon` is checked as well as the status:
/// cancelling an order hands a use back, and the counter is what says whether
/// any are left (`evaluateUserCoupon`, functions/src/orders/checkout.ts).
bool _personalRedeemable(Map c, int now) {
  if (!_active(c)) return false;
  final exp = _expiryMillis(c);
  if (exp != null && exp < now) return false;
  final maxUses = c['maxUsesPerCoupon'];
  final max = maxUses is num ? maxUses.toInt() : 1;
  return _num(c, 'usesCount').clamp(0, 1 << 31) < (max < 1 ? 1 : max);
}

/// May the server auto-apply this PERSONAL coupon? `autoBestOffer` checks
/// status, expiry, the remaining uses, the minimum and the eligible subtotal.
bool _personalAutoApplicable(
    Map c, int subtotalPaise, int now, List<OfferCartLine>? lines) {
  if (!_personalRedeemable(c, now)) return false;
  if (subtotalPaise < _num(c, 'minCartValuePaise')) return false;
  final eligible = _discountableSubtotal(c, subtotalPaise, lines);
  return eligible != null && eligible > 0;
}

String _headline(Map c) {
  final type = (c['discountType'] as String?) ?? '';
  if (type == 'flat') return '${_rupees(_num(c, 'discountValuePaise'))} off';
  if (type == 'percent') return '${_num(c, 'discountPercent')}% off';
  return 'Free delivery';
}

int _capPaise(Map c) => _num(c, 'discountMaxCapPaise');

bool _active(Map c) {
  final s = c['status'] as String?;
  return s == null || s == 'active';
}

bool _freeShipping(Map c) => (c['discountType'] as String?) == 'free_shipping';

/// All redeemable offers for [subtotalPaise] — qualifying first, then those
/// needing a bigger cart. [userCoupons] = spin/personal, [promoCoupons] = public.
///
/// [cartLines] carries each line's category + value so category-restricted
/// coupons are priced exactly as `placeOrder` prices them; pass null (or omit)
/// only while the categories are still loading.
///
/// [facts] carries the customer's own record — order count, affiliate flag and
/// the per-coupon redemption counters. Omit it and every rule that needs a
/// customer read is skipped, which is exactly how this behaved before those
/// reads existed.
List<OfferOption> listAvailableOffers(
  int subtotalPaise,
  List<Map<String, dynamic>> userCoupons,
  List<Map<String, dynamic>> promoCoupons, {
  List<OfferCartLine>? cartLines,
  CustomerOfferFacts facts = CustomerOfferFacts.unknown,
}) {
  final now = DateTime.now().millisecondsSinceEpoch;
  final out = <OfferOption>[];

  for (final c in promoCoupons) {
    // One gate for the whole list: status, the admin's pause switch, audience,
    // the validity window, the usage limit and a provably-ineligible bag.
    // Every one of these is refused by `placeOrder`.
    if (!_promoRedeemable(c, subtotalPaise, now, cartLines, facts)) continue;
    // …and the one refusal that leaves the coupon listed: this customer has
    // spent their allowance on it. Tagged rather than dropped, because from the
    // customer's side it is still their coupon.
    final blocked = _promoBlocked(c, facts);
    final min = _num(c, 'minCartValuePaise');
    final cap = _capPaise(c);
    final cats = _applicableCategories(c);
    final subParts = <String>[
      if (cats.length == 1) '${_cap(cats.first)} only',
      if (cats.length > 1) 'Selected categories',
      if (cap > 0) 'up to ${_rupees(cap)}',
      if (min > 0) 'Min cart ${_rupees(min)}',
      ?_expiryLabel(c),
    ];
    out.add(OfferOption(
      code: (c['code'] as String?) ?? '',
      headline: _headline(c),
      sub: subParts.isEmpty ? 'On any order' : subParts.join(' · '),
      discountPaise: _discount(c, subtotalPaise, cartLines),
      qualifies: subtotalPaise >= min,
      shortfallPaise: (min - subtotalPaise).clamp(0, min).toInt(),
      minPaise: min,
      source: 'promo',
      waiveDelivery: _freeShipping(c),
      autoApplicable:
          _promoAutoApplicable(c, subtotalPaise, now, cartLines, facts),
      unavailableReason: blocked,
    ));
  }

  for (final c in userCoupons) {
    if (!_personalRedeemable(c, now)) continue;
    final min = _num(c, 'minCartValuePaise');
    final cap = _capPaise(c);
    final isSpin = (c['source'] as String?) == 'spin';
    if (_discountableSubtotal(c, subtotalPaise, cartLines) == 0) continue;
    final subParts = <String>[
      isSpin ? 'Spin reward' : 'Your reward',
      if (cap > 0) 'up to ${_rupees(cap)}',
      if (min > 0) 'min ${_rupees(min)}',
      ?_expiryLabel(c),
    ];
    out.add(OfferOption(
      code: (c['code'] as String?) ?? '',
      headline: _headline(c),
      sub: subParts.join(' · '),
      discountPaise: _discount(c, subtotalPaise, cartLines),
      qualifies: subtotalPaise >= min,
      shortfallPaise: (min - subtotalPaise).clamp(0, min).toInt(),
      minPaise: min,
      source: 'spin',
      waiveDelivery: _freeShipping(c),
      autoApplicable:
          _personalAutoApplicable(c, subtotalPaise, now, cartLines),
    ));
  }

  // Appliable offers first (by discount desc), then ones that need a bigger bag
  // (by smallest shortfall), then the ones this customer can never redeem.
  // Same comparator as the web's `listAvailableOffers`.
  out.sort((a, b) {
    final aBlocked = a.unavailableReason != null;
    final bBlocked = b.unavailableReason != null;
    if (aBlocked != bBlocked) return aBlocked ? 1 : -1;
    if (a.qualifies != b.qualifies) return a.qualifies ? -1 : 1;
    return a.qualifies
        ? b.discountPaise - a.discountPaise
        : a.shortfallPaise - b.shortfallPaise;
  });
  return out;
}

/// The single best offer the app may apply on the customer's behalf, or null.
///
/// Mirrors web `bestOfferForCart`: only offers that pass every server-side
/// auto-apply rule are considered, and a free-delivery coupon counts even
/// though it discounts nothing. [offers] must come from [listAvailableOffers]
/// (already sorted by discount, qualifying first), so the first match is the
/// largest.
OfferOption? bestAutoOffer(List<OfferOption> offers) => offers
    .where((o) =>
        // `canApply` is redundant against `autoApplicable` today and is here so
        // it stays that way: an offer the customer cannot tap must never be put
        // on the draft behind their back either.
        o.autoApplicable &&
        o.canApply &&
        (o.discountPaise > 0 || o.waiveDelivery))
    .firstOrNull;

String _cap(String s) =>
    s.isEmpty ? s : '${s[0].toUpperCase()}${s.substring(1)}';

/// Streams the customer's redeemable coupons (spins + public promos).
class OffersRepository {
  OffersRepository({FirebaseFirestore? db})
      : _db = db ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;

  Stream<List<Map<String, dynamic>>> userCoupons(String uid) => _db
      .collection('customers/$uid/coupons')
      .where('status', isEqualTo: 'active')
      .snapshots()
      .map((s) => s.docs.map((d) => d.data()).toList());

  /// Public promotional coupons.
  ///
  /// The snapshot's document id is stamped onto each map as `id`: it is the key
  /// of the per-customer counter (`customers/{uid}/couponUsage/{couponId}`), so
  /// without it the "have I already used this?" rule cannot be evaluated at
  /// all. The admin writes the same value into the document on create, but a
  /// coupon that predates that (or was seeded) has no such field.
  Stream<List<Map<String, dynamic>>> promoCoupons() => _db
      .collection('coupons')
      .where('status', isEqualTo: 'active')
      .snapshots()
      .map((s) => s.docs.map((d) => {...d.data(), 'id': d.id}).toList());

  /// Every promotional coupon regardless of status — for "My Coupons", which
  /// must still show one this customer has already redeemed even after the
  /// admin pauses it or it expires. [promoCoupons] stays status-filtered
  /// (cheaper, and all checkout needs) because it only ever offers coupons
  /// that are currently redeemable.
  Stream<List<Map<String, dynamic>>> allPromoCoupons() => _db
      .collection('coupons')
      .snapshots()
      .map((s) => s.docs.map((d) => {...d.data(), 'id': d.id}).toList());

  /// Everything about the signed-in customer the coupon rules are judged
  /// against, as one live value.
  ///
  /// Two owner-scoped reads: the customer document (`stats.ordersCount`,
  /// `affiliate.enabled` — the server's `customerFacts`) and the per-coupon
  /// redemption counters under `couponUsage`.
  ///
  /// Neither read is allowed to break the screen. Each half sets its own
  /// "known" flag and an error simply leaves that flag false, so a coupon rule
  /// that depends on it is skipped rather than guessed — the same behaviour the
  /// app had before these reads existed. That matters for `couponUsage` in
  /// particular: its security rule may not be deployed yet, in which case the
  /// listener errors with permission-denied on every device.
  Stream<CustomerOfferFacts> customerFacts(String uid) {
    var ordersCount = 0;
    var affiliateEnabled = false;
    var factsKnown = false;
    var usage = const <String, int>{};
    var lastUsedAt = const <String, DateTime>{};
    var usageKnown = false;

    final subs = <StreamSubscription<void>>[];
    late StreamController<CustomerOfferFacts> ctrl;
    void emit() {
      if (ctrl.isClosed) return;
      ctrl.add(CustomerOfferFacts(
        ordersCount: ordersCount,
        affiliateEnabled: affiliateEnabled,
        promoUsage: usage,
        promoLastUsedAt: lastUsedAt,
        factsKnown: factsKnown,
        usageKnown: usageKnown,
      ));
    }

    ctrl = StreamController<CustomerOfferFacts>(
      onListen: () {
        subs.add(_db.doc('customers/$uid').snapshots().listen((s) {
          final d = s.data() ?? const <String, dynamic>{};
          final stats = d['stats'];
          final aff = d['affiliate'];
          ordersCount =
              (stats is Map ? (stats['ordersCount'] as num?)?.toInt() : null) ??
                  0;
          affiliateEnabled =
              (aff is Map ? (aff['enabled'] as bool?) : null) ?? false;
          // A customer document always exists by the time checkout is reachable;
          // treat a read that arrived at all as authoritative.
          factsKnown = true;
          emit();
        }, onError: (_) {
          factsKnown = false;
          emit();
        }));

        subs.add(
            _db.collection('customers/$uid/couponUsage').snapshots().listen((s) {
          usage = {
            for (final d in s.docs)
              d.id: (d.data()['count'] as num?)?.toInt() ?? 0,
          };
          lastUsedAt = {
            for (final d in s.docs)
              if (d.data()['lastUsedAt'] is Timestamp)
                d.id: (d.data()['lastUsedAt'] as Timestamp).toDate(),
          };
          usageKnown = true;
          emit();
        }, onError: (_) {
          // permission-denied (rule not deployed) or offline. Fall back to the
          // previous behaviour: the limit goes unchecked here and `applyCoupon`
          // / `placeOrder` remain the ones that enforce it.
          usage = const {};
          lastUsedAt = const {};
          usageKnown = false;
          emit();
        }));
      },
      onCancel: () async {
        for (final s in subs) {
          await s.cancel();
        }
      },
    );
    return ctrl.stream;
  }

  /// Live `productId → categorySlug` for the bag.
  ///
  /// A category-restricted coupon discounts only the lines in
  /// `applicableCategories`, matched against `products/{id}.categorySlug`
  /// (`PricedLine.category`, functions/src/orders/checkout.ts). The app's cart
  /// lines don't carry the slug, and `placeOrder` reads it off the LIVE product
  /// doc — so read it from the same place rather than trusting a value
  /// snapshotted into the bag days ago (this is what the web `refreshPrices`
  /// backfill does for its own lines).
  ///
  /// Firestore caps `whereIn` at 30 ids, so ids are queried in chunks and the
  /// chunk snapshots merged; the stream emits only once every chunk has
  /// reported, so callers never price a coupon against a half-built map.
  Stream<Map<String, String>> cartCategories(List<CartLine> lines) {
    final ids = lines.map((l) => l.productId).toSet().toList();
    if (ids.isEmpty) return Stream.value(const {});

    final chunks = <List<String>>[];
    for (var i = 0; i < ids.length; i += 30) {
      chunks.add(ids.sublist(i, i + 30 > ids.length ? ids.length : i + 30));
    }

    final latest = <int, List<QueryDocumentSnapshot<Map<String, dynamic>>>>{};
    final subs = <StreamSubscription<void>>[];
    late StreamController<Map<String, String>> ctrl;
    ctrl = StreamController<Map<String, String>>(
      onListen: () {
        for (var c = 0; c < chunks.length; c++) {
          final index = c;
          subs.add(
            _db
                .collection('products')
                .where(FieldPath.documentId, whereIn: chunks[index])
                .snapshots()
                .listen((snap) {
              latest[index] = snap.docs;
              if (latest.length < chunks.length) return; // still filling
              ctrl.add({
                for (final d in latest.values.expand((d) => d))
                  if ((d.data()['categorySlug'] as String?)?.isNotEmpty ?? false)
                    d.id: d.data()['categorySlug'] as String,
              });
            }, onError: ctrl.addError),
          );
        }
      },
      onCancel: () async {
        for (final s in subs) {
          await s.cancel();
        }
      },
    );
    return ctrl.stream;
  }
}
