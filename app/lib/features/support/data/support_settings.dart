import 'package:cloud_firestore/cloud_firestore.dart';

/// The Help & Support contact details, admin-managed at `settings/support`.
/// Mirrors the web/admin `SettingsSupport` shape. The app renders a card per
/// populated field (so as the admin fills in more, more cards appear), and also
/// surfaces any EXTRA string fields the admin adds later via [extraFields] —
/// so newly-added fields show up without an app change.
class SupportSettings {
  const SupportSettings({
    required this.email,
    required this.phone,
    required this.hours,
    required this.enabled,
    required this.extraFields,
  });

  final String email;
  final String phone;
  final String hours;
  final bool enabled;

  /// Any additional string fields on the doc that aren't part of the known
  /// schema — rendered generically as extra contact rows.
  final Map<String, String> extraFields;

  /// Phone reduced to digits, for `tel:` / `wa.me` links (matches web).
  String get phoneDigits => phone.replaceAll(RegExp(r'\D'), '');

  bool get hasPhone => phoneDigits.isNotEmpty;
  bool get hasEmail => email.trim().isNotEmpty;
  bool get hasAnyContact => hasPhone || hasEmail || extraFields.isNotEmpty;

  static const _known = {
    'id',
    'supportEmail',
    'supportPhone',
    'supportHours',
    'supportEnabled',
    'updatedAt',
  };

  factory SupportSettings.fromDoc(
      DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const <String, dynamic>{};
    final extra = <String, String>{};
    for (final e in d.entries) {
      if (_known.contains(e.key)) continue;
      final v = e.value;
      if (v is String && v.trim().isNotEmpty) extra[e.key] = v.trim();
    }
    return SupportSettings(
      email: (d['supportEmail'] as String?)?.trim() ?? '',
      phone: (d['supportPhone'] as String?)?.trim() ?? '',
      hours: (d['supportHours'] as String?)?.trim() ?? '',
      enabled: (d['supportEnabled'] as bool?) ?? true,
      extraFields: extra,
    );
  }
}
