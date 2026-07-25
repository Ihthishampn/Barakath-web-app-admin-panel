import 'dart:async';

import 'package:flutter/widgets.dart';

import '../../features/catalog/data/product.dart';
import '../../features/wishlist/data/wishlist.dart';
import '../../features/wishlist/data/wishlist_repository.dart';
import 'auth_provider.dart';

/// App-wide wishlist state. Mirrors [CartProvider]'s shape: a live Firestore
/// listener on `customers/{uid}/wishlist` keeps [items] + the id [Set] fresh
/// (real-time cross-device / cross-platform sync with the web), while [toggle]
/// flips membership optimistically for an instant heart response.
class WishlistProvider extends ChangeNotifier {
  WishlistProvider(this._auth, {WishlistRepository? repo})
      : _repo = repo ?? WishlistRepository() {
    _auth.addListener(_onAuthChanged);
    _onAuthChanged();
  }

  final AuthProvider _auth;
  final WishlistRepository _repo;

  StreamSubscription<List<WishlistItem>>? _sub;
  String? _uid;
  List<WishlistItem> _items = const [];
  Set<String> _ids = <String>{};
  bool _loading = false;
  bool _disposed = false;

  List<WishlistItem> get items => _items;
  bool get loading => _loading;
  bool get isEmpty => _items.isEmpty;

  /// Whether [productId] is wishlisted → drives the filled/outline heart.
  bool contains(String productId) => _ids.contains(productId);

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _onAuthChanged() {
    if (_auth.uid == _uid) return;
    _uid = _auth.uid;
    _sub?.cancel();
    _items = const [];
    _ids = <String>{};
    _loading = _uid != null;
    _notify();
    if (_uid == null) return;
    _sub = _repo.watch(_uid!).listen(
      (items) {
        _items = items;
        _ids = items.map((i) => i.productId).toSet();
        _loading = false;
        _notify();
      },
      onError: (_) {
        _loading = false;
        _notify();
      },
    );
  }

  /// Toggle [p]. Returns the new state (true = now wishlisted). Optimistically
  /// flips the id set so every heart repaints immediately; the live stream then
  /// reconciles the full item list. Reverts the flip if the write fails.
  Future<bool> toggle(Product p) async {
    final uid = _uid;
    if (uid == null) return false;
    final wasIn = _ids.contains(p.id);
    final next = Set<String>.of(_ids);
    if (wasIn) {
      next.remove(p.id);
    } else {
      next.add(p.id);
    }
    _ids = next;
    _notify();
    try {
      if (wasIn) {
        await _repo.remove(uid, p.id);
      } else {
        await _repo.add(uid, p);
      }
      return !wasIn;
    } catch (_) {
      final revert = Set<String>.of(_ids);
      if (wasIn) {
        revert.add(p.id);
      } else {
        revert.remove(p.id);
      }
      _ids = revert;
      _notify();
      return wasIn; // write failed → membership stays as it was
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _auth.removeListener(_onAuthChanged);
    _sub?.cancel();
    super.dispose();
  }
}
