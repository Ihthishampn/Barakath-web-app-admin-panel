import 'dart:async';

import 'package:flutter/widgets.dart';

import '../../features/cart/data/cart_line.dart';
import '../../features/cart/data/cart_repository.dart';
import '../../features/catalog/data/product.dart';
import '../constants/limits.dart';
import 'auth_provider.dart';

/// App-wide bag state, tuned for a snappy UI.
///
/// Mutations update the in-memory [lines] **immediately** and notify listeners
/// (optimistic UI), then persist to Firestore in the background — quantity
/// changes are debounced so rapid +/− taps coalesce into a single write. While
/// a write is in flight (or a debounce is pending) incoming snapshots are
/// ignored so the server echo can't clobber the optimistic state; once idle,
/// snapshots reconcile normally (real-time cross-device sync). A failed write
/// re-reads the server state so the UI never drifts from Firebase.
///
/// Observes the app lifecycle so a pending debounced write is flushed when the
/// app is backgrounded — otherwise a quantity change made just before the user
/// leaves would be lost.
class CartProvider extends ChangeNotifier with WidgetsBindingObserver {
  CartProvider(this._auth, {CartRepository? repo})
      : _repo = repo ?? CartRepository() {
    WidgetsBinding.instance.addObserver(this);
    _auth.addListener(_onAuthChanged);
    _onAuthChanged();
  }

  final AuthProvider _auth;
  final CartRepository _repo;

  /// Rules cap the cart array at 50 lines; guard client-side so the 51st add
  /// doesn't optimistically flip then get silently rejected + reverted.
  static const maxLines = OrderLimits.maxCartLines;

  StreamSubscription<List<CartLine>>? _sub;
  Timer? _debounce;
  int _inFlight = 0;
  String? _uid;
  List<CartLine> _lines = const [];
  bool _loading = true;
  bool _error = false;
  bool _disposed = false;

  /// notifyListeners guarded against a late async callback firing after the
  /// provider (rarely) disposes.
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  /// Bumped on every local mutation. A failed [_flush] only reverts to the
  /// server state if no newer mutation happened while its write was in flight —
  /// otherwise the revert would discard the user's newer edit.
  int _gen = 0;

  /// Set when a snapshot is ignored because we were busy writing. Once idle we
  /// reconcile once against the server so a cross-device change that landed
  /// during the busy window isn't dropped.
  bool _suppressedSnapshot = false;

  /// Bumped whenever the signed-in account changes. A [_flush] that started
  /// under an older epoch belongs to the previous account: it still balances its
  /// own `_inFlight`, but must never write that account's lines or reconcile
  /// into the new one.
  int _epoch = 0;

  static const _debounceMs = 350;

  List<CartLine> get lines => _lines;
  bool get loading => _loading;
  bool get hasError => _error;
  bool get isEmpty => _lines.isEmpty;
  int get distinctCount => _lines.length;
  int get count => _lines.fold(0, (n, l) => n + l.qty);
  int get subtotalPaise => _lines.fold(0, (n, l) => n + l.linePaise);
  bool get isFull => _lines.length >= maxLines;

  /// Would adding [addQty] units of [key] (priced at [pricePaise] each) break a
  /// cap? Shared by every entry point so add-to-bag, the stepper and Checkout
  /// all agree — and all agree with the server, which applies the same numbers.
  ///
  /// [newLine] distinguishes "a 51st distinct line" from "more of a line that is
  /// already there".
  CartLimit _breachForAdd({
    required String key,
    required int addQty,
    required int pricePaise,
    required bool newLine,
  }) {
    if (addQty <= 0) return CartLimit.none;
    if (newLine && _lines.length >= OrderLimits.maxCartLines) {
      return CartLimit.lines;
    }
    final currentQty = newLine ? 0 : (lineFor(key)?.qty ?? 0);
    if (currentQty + addQty > OrderLimits.maxQtyPerLine) {
      return CartLimit.qtyPerLine;
    }
    if (count + addQty > OrderLimits.maxUnitsPerOrder) {
      return CartLimit.unitsPerOrder;
    }
    if (subtotalPaise + pricePaise * addQty > OrderLimits.maxOrderTotalPaise) {
      return CartLimit.orderTotal;
    }
    return CartLimit.none;
  }

  /// Which cap the bag ALREADY breaks, if any — for Checkout, where the bag may
  /// have grown on another device, been re-priced upwards, or been built before
  /// these limits existed. [totalPaise] is the order total being quoted (after
  /// discounts, including delivery/GST), which is what the server caps.
  CartLimit limitBreach({int? totalPaise}) {
    if (_lines.length > OrderLimits.maxCartLines) return CartLimit.lines;
    if (_lines.any((l) => l.qty > OrderLimits.maxQtyPerLine)) {
      return CartLimit.qtyPerLine;
    }
    if (count > OrderLimits.maxUnitsPerOrder) return CartLimit.unitsPerOrder;
    if ((totalPaise ?? subtotalPaise) > OrderLimits.maxOrderTotalPaise) {
      return CartLimit.orderTotal;
    }
    return CartLimit.none;
  }

  bool get _busy => _inFlight > 0 || (_debounce?.isActive ?? false);

  CartLine? lineFor(String key) {
    for (final l in _lines) {
      if (l.key == key) return l;
    }
    return null;
  }

  /// Whether any variant of [productId] is in the bag → drives the ✓ indicator.
  bool contains(String productId) =>
      _lines.any((l) => l.productId == productId);

  /// Whether the exact product+variant line is in the bag.
  bool containsLine(String key) => lineFor(key) != null;

  // ── Optimistic mutations ───────────────────────────────────────────
  /// Adds [p] (optionally a variant) to the bag. Returns the cap that stopped
  /// it — [CartLimit.none] when the item went in — so the caller can say WHY
  /// nothing happened rather than showing one catch-all "bag is full".
  CartLimit addProduct(Product p, {ProductVariant? variant, int qty = 1}) {
    if (_uid == null) return CartLimit.none;
    final add = CartLine.fromProduct(p, variant: variant, qty: qty);
    final i = _lines.indexWhere((l) => l.key == add.key);
    final breach = _breachForAdd(
      key: add.key,
      addQty: qty,
      pricePaise: add.pricePaise,
      newLine: i < 0,
    );
    if (breach.blocked) return breach;
    final next = List<CartLine>.of(_lines);
    if (i >= 0) {
      next[i] = next[i].copyWith(qty: next[i].qty + qty);
    } else {
      next.add(add);
    }
    _commit(next, immediate: true);
    return CartLimit.none;
  }

  /// Bulk add (e.g. "Reorder") — merges quantities into existing lines. Adds
  /// everything that fits and reports the first cap that stopped the rest, so
  /// a reorder of a big old order still restores what it can and says what it
  /// had to leave behind. One optimistic commit + one write.
  CartLimit addLines(List<CartLine> add) {
    if (_uid == null || add.isEmpty) return CartLimit.none;
    final next = List<CartLine>.of(_lines);
    var units = count;
    var value = subtotalPaise;
    var breach = CartLimit.none;

    void note(CartLimit c) => breach = breach.blocked ? breach : c;

    for (final a in add) {
      final i = next.indexWhere((l) => l.key == a.key);
      final currentQty = i >= 0 ? next[i].qty : 0;
      if (i < 0 && next.length >= OrderLimits.maxCartLines) {
        note(CartLimit.lines);
        continue;
      }
      // Take as much of this line as every cap allows, rather than dropping it.
      var room = OrderLimits.maxQtyPerLine - currentQty;
      if (room < a.qty) note(CartLimit.qtyPerLine);
      if (OrderLimits.maxUnitsPerOrder - units < room) {
        room = OrderLimits.maxUnitsPerOrder - units;
        note(CartLimit.unitsPerOrder);
      }
      if (a.pricePaise > 0) {
        final affordable =
            (OrderLimits.maxOrderTotalPaise - value) ~/ a.pricePaise;
        if (affordable < room) {
          room = affordable;
          note(CartLimit.orderTotal);
        }
      }
      final take = room < a.qty ? room : a.qty;
      if (take <= 0) continue;
      if (i >= 0) {
        next[i] = next[i].copyWith(qty: currentQty + take);
      } else {
        next.add(a.copyWith(qty: take));
      }
      units += take;
      value += a.pricePaise * take;
    }
    _commit(next, immediate: true);
    return breach;
  }

  /// Sets a line's quantity. A REDUCTION always goes through (it can only make
  /// the bag more acceptable — including the checkout screen trimming a line to
  /// the units actually in stock); an increase is refused if it breaks a cap.
  CartLimit setQty(String key, int qty) {
    if (_uid == null) return CartLimit.none;
    if (qty <= 0) {
      remove(key);
      return CartLimit.none;
    }
    final line = lineFor(key);
    if (line == null) return CartLimit.none;
    if (qty > line.qty) {
      final breach = _breachForAdd(
        key: key,
        addQty: qty - line.qty,
        pricePaise: line.pricePaise,
        newLine: false,
      );
      if (breach.blocked) return breach;
    }
    final next = _lines
        .map((l) => l.key == key ? l.copyWith(qty: qty) : l)
        .toList();
    _commit(next, immediate: false); // debounced — coalesces rapid +/−
    return CartLimit.none;
  }

  CartLimit increment(String key) {
    final l = lineFor(key);
    return l == null ? CartLimit.none : setQty(key, l.qty + 1);
  }

  void decrement(String key) {
    final l = lineFor(key);
    if (l != null) setQty(key, l.qty - 1);
  }

  void remove(String key) {
    if (_uid == null) return;
    _commit(_lines.where((l) => l.key != key).toList(), immediate: true);
  }

  /// Remove all lines of [productId] (every variant).
  void removeProduct(String productId) {
    if (_uid == null) return;
    _commit(_lines.where((l) => l.productId != productId).toList(),
        immediate: true);
  }

  void clear() {
    if (_uid == null) return;
    _commit(const [], immediate: true);
  }

  /// Guards [refreshPrices] against overlapping runs (the Bag and the Checkout
  /// screen can both ask, and a Reorder asks again straight away).
  bool _repricing = false;

  /// Re-read every line's price from its product document and apply the result.
  ///
  /// Lines snapshot the price at "Add to bag" — and a Reorder copies the price
  /// the item was BOUGHT at, which can be months old — while `placeOrder`
  /// always prices from the live product. Without this the bag total, the
  /// checkout summary, the free-delivery threshold, every coupon minimum and
  /// the amount on the pay button are all derived from a price the server will
  /// not charge, and the customer is billed something no screen ever showed.
  /// Mirrors the web's `refreshPrices` (web/src/lib/cart.ts).
  ///
  /// Silent and best-effort: nothing to show the customer, and an unreadable
  /// product simply leaves that line as it was — the server still prices
  /// authoritatively.
  Future<void> refreshPrices() async {
    final uid = _uid;
    if (uid == null || _lines.isEmpty || _repricing) return;
    _repricing = true;
    final gen = _gen;
    final epoch = _epoch;
    try {
      final next = await _repo.repriceLines(List<CartLine>.of(_lines));
      // Nothing moved, or the customer edited the bag (or switched account)
      // while we were reading — their newer state wins and the next visit
      // reprices against it.
      if (next == null || gen != _gen || epoch != _epoch || _uid != uid) return;
      _commit(next, immediate: true);
    } catch (_) {
      // Offline / permission — leave the bag as it is.
    } finally {
      _repricing = false;
    }
  }

  /// Apply [next] to the UI now, then schedule/flush the Firestore write.
  void _commit(List<CartLine> next, {required bool immediate}) {
    _lines = next;
    _gen++;
    _loading = false; // we have authoritative local state now
    _error = false;
    _notify();
    _debounce?.cancel();
    if (immediate) {
      _flush();
    } else {
      _debounce = Timer(const Duration(milliseconds: _debounceMs), _flush);
    }
  }

  Future<void> _flush() async {
    final uid = _uid;
    if (uid == null) return;
    _debounce?.cancel();
    final gen = _gen;
    final epoch = _epoch;
    _inFlight++;
    final snapshot = List<CartLine>.of(_lines);
    try {
      await _repo.replace(uid, snapshot);
    } catch (_) {
      // Write failed — re-read the server truth so the UI can't drift, BUT only
      // if the user hasn't made a newer edit in the meantime (which will have
      // its own flush) and we're still on the same account; otherwise we'd
      // discard that newer edit / paste the old account's bag over the new one.
      if (gen == _gen && epoch == _epoch) {
        try {
          final server = await _repo.getOnce(uid);
          if (gen == _gen && epoch == _epoch) {
            _lines = server;
            _notify();
          }
        } catch (_) {/* offline — keep optimistic state; snapshot reconciles */}
      }
    } finally {
      // Only balance the counter if it is still the one we incremented: a write
      // that outlived an account switch was already zeroed out by
      // [_onAuthChanged], and decrementing again would drive `_inFlight`
      // negative — making `_busy` false during every later write and silently
      // disabling snapshot suppression for the rest of the process.
      if (epoch == _epoch) {
        _inFlight--;
        _maybeReconcile();
      }
    }
  }

  /// After the last in-flight write settles, if we ignored a snapshot while
  /// busy, reconcile once against the server (covers a cross-device change that
  /// landed during the busy window and would otherwise be dropped).
  Future<void> _maybeReconcile() async {
    if (_busy || !_suppressedSnapshot) return;
    _suppressedSnapshot = false;
    final uid = _uid;
    if (uid == null) return;
    final gen = _gen;
    try {
      final server = await _repo.getOnce(uid);
      if (gen == _gen && !_busy) {
        _lines = server;
        _loading = false;
        _notify();
      }
    } catch (_) {/* leave state; next snapshot will reconcile */}
  }

  void _onAuthChanged() {
    if (_auth.uid == _uid) return;
    _uid = _auth.uid;
    _epoch++; // any write still settling belongs to the previous account
    _sub?.cancel();
    _debounce?.cancel();
    _inFlight = 0; // safe now: stale flushes no longer decrement (see _flush)
    _suppressedSnapshot = false;
    _lines = const [];
    _error = false;
    _loading = _uid != null;
    _notify();
    if (_uid == null) return;
    _sub = _repo.watch(_uid!).listen(
      (lines) {
        // Ignore server echoes while our own write is settling; remember that
        // we did so, so _maybeReconcile can catch up once idle.
        if (_busy) {
          _suppressedSnapshot = true;
          return;
        }
        _lines = lines;
        _loading = false;
        _error = false;
        _notify();
      },
      onError: (_) {
        // Don't surface a transient stream error over valid optimistic state.
        if (_busy) return;
        _loading = false;
        _error = _lines.isEmpty;
        _notify();
      },
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Persist any pending debounced quantity change before the OS may suspend us.
    if ((state == AppLifecycleState.paused ||
            state == AppLifecycleState.inactive ||
            state == AppLifecycleState.detached) &&
        (_debounce?.isActive ?? false)) {
      _flush();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _auth.removeListener(_onAuthChanged);
    // Flush a pending debounced write rather than dropping it (this fires
    // before we mark disposed, so its own write still goes out; _notify then
    // no-ops for any late callback).
    if (_debounce?.isActive ?? false) _flush();
    _disposed = true;
    _sub?.cancel();
    _debounce?.cancel();
    super.dispose();
  }
}
