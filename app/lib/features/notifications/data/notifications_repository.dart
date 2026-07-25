import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import 'app_notification.dart';

/// Reads the signed-in customer's notification inbox and clears read receipts.
///
/// Mirrors the web (`useUnreadNotifications`) against the SAME collection, so
/// the app + web show the same unread state for one account. All queries are
/// single-field (`where read == false`) with in-memory sorting — no composite
/// index needed.
class NotificationsRepository {
  NotificationsRepository({FirebaseFirestore? db, FirebaseFunctions? functions})
      : _db = db ?? FirebaseFirestore.instance,
        _fn = functions ?? FirebaseFunctions.instanceFor(region: 'asia-south1');

  final FirebaseFirestore _db;
  final FirebaseFunctions _fn;

  CollectionReference<Map<String, dynamic>> _col(String uid) =>
      _db.collection('customers/$uid/notifications');

  /// Live count of unread notifications → drives the yellow bell dot. Stays > 0
  /// until the customer opens their inbox (which calls [markAllRead]).
  Stream<int> unreadCount(String uid) => _col(uid)
      .where('read', isEqualTo: false)
      .snapshots()
      .map((s) => s.size);

  /// The full inbox, newest first (sorted in memory to avoid a composite
  /// index). Consumed by the Notifications screen in Part 8.
  Stream<List<AppNotification>> all(String uid) =>
      _col(uid).snapshots().map((s) {
        final list = s.docs.map(AppNotification.fromDoc).toList();
        list.sort((a, b) => (b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0))
            .compareTo(a.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0)));
        return list;
      });

  /// Flip every unread row to read — call when the customer views their inbox
  /// (Part 8), which clears the bell dot. Rules only permit the owner to set
  /// `read == true` + `readAt`, so this is a safe direct write (no CF).
  /// A WriteBatch is capped at 500 writes and commits atomically, so a single
  /// batch over a long-lived inbox (>500 unread) would be rejected outright and
  /// leave EVERY row unread — the badge could then never be cleared. Commit in
  /// chunks instead; each chunk that lands stays landed.
  static const _batchLimit = 400;

  Future<void> markAllRead(String uid) async {
    final unread = await _col(uid).where('read', isEqualTo: false).get();
    final docs = unread.docs;
    if (docs.isEmpty) return;
    for (var i = 0; i < docs.length; i += _batchLimit) {
      final end = (i + _batchLimit) < docs.length ? i + _batchLimit : docs.length;
      final batch = _db.batch();
      for (final d in docs.sublist(i, end)) {
        batch.update(d.reference,
            {'read': true, 'readAt': FieldValue.serverTimestamp()});
      }
      await batch.commit();
    }
    // These rows have just been opened for the first time — report the ones that
    // came from an admin broadcast so its Opened stat moves.
    await _reportBroadcastOpens(
      docs.map((d) => d.data()['broadcastId'] as String?),
    );
  }

  /// Mark a single notification read (e.g. when it is tapped in Part 8).
  ///
  /// Reads the row first so a broadcast open can be attributed: the caller only
  /// has the notification id, and an already-read row must not be reported again
  /// (the callable de-dupes too, but there is no point calling it).
  Future<void> markRead(String uid, String id) async {
    final ref = _col(uid).doc(id);
    final snap = await ref.get();
    final data = snap.data();
    if (data == null) return;
    final wasUnread = data['read'] != true;
    await ref.update({'read': true, 'readAt': FieldValue.serverTimestamp()});
    if (wasUnread) {
      await _reportBroadcastOpens([data['broadcastId'] as String?]);
    }
  }

  /// Max broadcast ids per `markBroadcastOpened` call (matches the callable).
  static const _openBatchLimit = 50;

  /// Count a broadcast "open" — once per customer per broadcast.
  ///
  /// `broadcasts.opened` is a cross-user counter on a CF-only-write collection,
  /// so the client cannot increment it directly; the `markBroadcastOpened`
  /// callable owns it and guards the increment with a per-customer marker doc.
  /// Best-effort: the read receipt above is the source of truth and must never
  /// fail because a stat write did.
  Future<void> _reportBroadcastOpens(Iterable<String?> broadcastIds) async {
    final ids = broadcastIds
        .whereType<String>()
        .where((s) => s.isNotEmpty)
        .toSet()
        .toList();
    if (ids.isEmpty) return;
    try {
      for (var i = 0; i < ids.length; i += _openBatchLimit) {
        final end =
            (i + _openBatchLimit) < ids.length ? i + _openBatchLimit : ids.length;
        await _fn
            .httpsCallable('markBroadcastOpened')
            .call<dynamic>({'broadcastIds': ids.sublist(i, end)});
      }
    } catch (_) {
      // Stat only — never surface this to the customer.
    }
  }
}
