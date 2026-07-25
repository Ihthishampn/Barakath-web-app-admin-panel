import 'package:cloud_firestore/cloud_firestore.dart';

/// A saved delivery address — one entry in `customers/{uid}.addresses`.
/// Shape matches the shared `CustomerAddress` (and the web) exactly.
class Address {
  const Address({
    required this.id,
    required this.label,
    required this.name,
    required this.phone,
    required this.line1,
    this.line2,
    required this.city,
    required this.state,
    required this.pincode,
    this.isDefault = false,
  });

  final String id;
  final String label; // Home / Office / Other
  final String name;
  final String phone; // "+91 98765 43210"
  final String line1;
  final String? line2; // landmark
  final String city;
  final String state;
  final String pincode;
  final bool isDefault;

  /// "42 Marine Drive, Kakkanad, Kochi, Kerala 682001"
  String get formatted {
    final head = [line1, line2, city].where((s) => s != null && s.isNotEmpty).join(', ');
    final region = [state, pincode].where((s) => s.isNotEmpty).join(' ');
    return [head, region].where((s) => s.isNotEmpty).join(', ');
  }

  factory Address.fromMap(Map<dynamic, dynamic> m) => Address(
        id: (m['id'] as String?) ?? '',
        label: (m['label'] as String?) ?? 'Home',
        name: (m['name'] as String?) ?? '',
        phone: (m['phone'] as String?) ?? '',
        line1: (m['line1'] as String?) ?? '',
        line2: m['line2'] as String?,
        city: (m['city'] as String?) ?? '',
        state: (m['state'] as String?) ?? '',
        pincode: (m['pincode'] as String?) ?? '',
        isDefault: (m['isDefault'] as bool?) ?? false,
      );

  /// Serialise for the `addresses` array. Timestamps use [now] (a
  /// serverTimestamp can't live inside an array element).
  Map<String, dynamic> toMap({required Timestamp createdAt, required Timestamp updatedAt}) => {
        'id': id,
        'label': label,
        'name': name,
        'phone': phone,
        'line1': line1,
        'line2': line2,
        'city': city,
        'state': state,
        'pincode': pincode,
        'country': 'India',
        'latitude': null,
        'longitude': null,
        'isDefault': isDefault,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };
}
