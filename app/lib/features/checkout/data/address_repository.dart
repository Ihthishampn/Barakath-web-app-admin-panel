import 'package:cloud_firestore/cloud_firestore.dart';

import 'address.dart';

/// CRUD for the customer's saved addresses, stored as the `addresses` array on
/// `customers/{uid}` (owner-writable, ≤ 10, per security rules). Mirrors the web
/// add/edit flow so both clients agree on the same records.
class AddressRepository {
  AddressRepository({FirebaseFirestore? db})
      : _db = db ?? FirebaseFirestore.instance;

  final FirebaseFirestore _db;

  DocumentReference<Map<String, dynamic>> _doc(String uid) =>
      _db.doc('customers/$uid');

  static const maxAddresses = 10;

  /// Live list of saved addresses (default first, then by label).
  Stream<List<Address>> watch(String uid) => _doc(uid).snapshots().map((s) {
        final raw = (s.data()?['addresses'] as List?) ?? const [];
        final list = raw.whereType<Map>().map(Address.fromMap).toList();
        list.sort((a, b) {
          if (a.isDefault != b.isDefault) return a.isDefault ? -1 : 1;
          return a.label.compareTo(b.label);
        });
        return list;
      });

  Future<List<Address>> _current(String uid) async {
    final raw = (await _doc(uid).get()).data()?['addresses'] as List?;
    return (raw ?? const []).whereType<Map>().map(Address.fromMap).toList();
  }

  Future<void> _commit(String uid, List<Address> addresses) async {
    final now = Timestamp.now();
    // Preserve each address's original createdAt (rewriting the whole array
    // would otherwise reset every element's createdAt to "now" on any edit).
    final snap = await _doc(uid).get();
    final existing = <String, Timestamp>{
      for (final e in (snap.data()?['addresses'] as List? ?? const []))
        if (e is Map && e['id'] is String && e['createdAt'] is Timestamp)
          e['id'] as String: e['createdAt'] as Timestamp,
    };
    // set(merge) rather than update() so the first-ever address is create-safe
    // (update() throws NOT_FOUND if customers/{uid} doesn't exist yet, which
    // would permanently block the user from checking out). Merge only touches
    // addresses + updatedAt, staying within the fields the rules allow.
    await _doc(uid).set({
      'addresses': addresses
          .map((a) =>
              a.toMap(createdAt: existing[a.id] ?? now, updatedAt: now))
          .toList(),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  /// Create or update [address]. If it's the first address, it becomes default.
  /// Returns the saved id. Throws [StateError] if the 10-address cap is hit.
  Future<String> save(String uid, Address address) async {
    final current = await _current(uid);
    final isEdit = current.any((a) => a.id == address.id);
    if (!isEdit && current.length >= maxAddresses) {
      throw StateError('You can save up to $maxAddresses addresses.');
    }
    final makeDefault = address.isDefault || current.isEmpty;
    final saved = Address(
      id: address.id,
      label: address.label,
      name: address.name,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      isDefault: makeDefault,
    );
    List<Address> next;
    if (isEdit) {
      next = current.map((a) => a.id == saved.id ? saved : a).toList();
    } else {
      next = [...current, saved];
    }
    if (makeDefault) {
      next = next.map((a) => a.id == saved.id ? a : _withDefault(a, false)).toList();
    }
    await _commit(uid, next);
    return saved.id;
  }

  Future<void> remove(String uid, String id) async {
    final current = await _current(uid);
    var next = current.where((a) => a.id != id).toList();
    // If we removed the default, promote the first remaining one.
    if (next.isNotEmpty && !next.any((a) => a.isDefault)) {
      next = [
        _withDefault(next.first, true),
        ...next.skip(1),
      ];
    }
    await _commit(uid, next);
  }

  Future<void> setDefault(String uid, String id) async {
    final current = await _current(uid);
    final next = current.map((a) => _withDefault(a, a.id == id)).toList();
    await _commit(uid, next);
  }

  Address _withDefault(Address a, bool isDefault) => Address(
        id: a.id,
        label: a.label,
        name: a.name,
        phone: a.phone,
        line1: a.line1,
        line2: a.line2,
        city: a.city,
        state: a.state,
        pincode: a.pincode,
        isDefault: isDefault,
      );
}
