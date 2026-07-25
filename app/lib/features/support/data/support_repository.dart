import 'package:cloud_firestore/cloud_firestore.dart';

import 'support_settings.dart';

/// Streams the admin-managed Help & Support contact details from the singleton
/// `settings/support` doc, real-time. Reads are public (rules allow it), and any
/// admin edit reflects live on the Help centre screen.
class SupportRepository {
  SupportRepository({FirebaseFirestore? db})
      : _db = db ?? FirebaseFirestore.instance;
  final FirebaseFirestore _db;

  Stream<SupportSettings?> watch() => _db
      .doc('settings/support')
      .snapshots()
      .map((d) => d.exists ? SupportSettings.fromDoc(d) : null);
}
