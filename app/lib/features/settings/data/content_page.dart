import 'package:cloud_firestore/cloud_firestore.dart';

int _int(dynamic v) => (v as num?)?.toInt() ?? 0;
DateTime? _ts(dynamic v) => v is Timestamp ? v.toDate() : null;

/// One section within a policy/content page. `body` is minimal Markdown
/// (`#/##/###` headings, `-`/`*` bullets, paragraphs).
class ContentSection {
  const ContentSection({
    required this.id,
    required this.heading,
    required this.body,
    required this.order,
  });

  final String id;
  final String heading;
  final String body;
  final int order;

  factory ContentSection.fromMap(Map<String, dynamic> m) => ContentSection(
        id: (m['id'] as String?) ?? '',
        heading: (m['heading'] as String?) ?? '',
        body: (m['body'] as String?) ?? '',
        order: _int(m['order']),
      );
}

/// A dynamic policy/content page authored in the Admin Panel
/// (`content/{id}`). The app streams every `published == true` page and renders
/// its embedded [sections]. Mirrors the web/admin `ContentPage` shape exactly —
/// the app never hardcodes page ids.
class ContentPage {
  const ContentPage({
    required this.id,
    required this.title,
    required this.slug,
    required this.sections,
    required this.body,
    required this.order,
    required this.published,
    required this.updatedAt,
  });

  final String id;
  final String title;
  final String slug;
  final List<ContentSection> sections;

  /// Legacy single-blob markdown — rendered only when [sections] is empty.
  final String body;
  final int order;
  final bool published;
  final DateTime? updatedAt;

  factory ContentPage.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const <String, dynamic>{};
    final raw = (d['sections'] as List?) ?? const [];
    final sections = raw
        .whereType<Map<String, dynamic>>()
        .map(ContentSection.fromMap)
        .toList()
      ..sort((a, b) => a.order.compareTo(b.order));
    return ContentPage(
      id: doc.id,
      title: (d['title'] as String?) ?? '',
      slug: (d['slug'] as String?) ?? '',
      sections: sections,
      body: (d['body'] as String?) ?? '',
      order: _int(d['order']),
      published: (d['published'] as bool?) ?? false,
      updatedAt: _ts(d['updatedAt']),
    );
  }
}
