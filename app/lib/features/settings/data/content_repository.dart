import 'package:cloud_firestore/cloud_firestore.dart';

import 'content_page.dart';

/// Streams the dynamic policy/content pages authored in the Admin Panel from the
/// top-level `content` collection, real-time. Only `published == true` pages are
/// customer-visible; sorted by `order` in memory (no composite index needed,
/// matching the web). New pages/sections the admin adds appear automatically.
class ContentRepository {
  ContentRepository({FirebaseFirestore? db})
      : _db = db ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;

  /// All published pages, ordered.
  Stream<List<ContentPage>> watchPages() => _db
      .collection('content')
      .where('published', isEqualTo: true)
      .snapshots()
      .map((s) {
        final list = s.docs.map(ContentPage.fromDoc).toList();
        list.sort((a, b) => a.order.compareTo(b.order));
        return list;
      });

  /// A single page by doc id — live, so admin edits to its sections reflect
  /// immediately on the open detail screen. Rules let any signed-in client read
  /// every `content` doc, so `published` must be re-checked here (the list query
  /// filters it): an unpublished draft resolves to null and the screen falls
  /// through to its "no longer published" state, matching the web.
  Stream<ContentPage?> watchPage(String id) => _db
      .doc('content/$id')
      .snapshots()
      .map((d) => d.exists && d.data()?['published'] == true
          ? ContentPage.fromDoc(d)
          : null);
}
