import 'package:shared_preferences/shared_preferences.dart';

/// Thin wrapper over SharedPreferences for the auth/onboarding flags — spec §3.
abstract final class AppPrefs {
  static const _onboardingComplete = 'onboardingComplete';
  static const _profileSkipped = 'profileSkipped';

  static Future<bool> onboardingComplete() async {
    final p = await SharedPreferences.getInstance();
    return p.getBool(_onboardingComplete) ?? false;
  }

  static Future<void> setOnboardingComplete() async {
    final p = await SharedPreferences.getInstance();
    await p.setBool(_onboardingComplete, true);
  }

  static Future<bool> profileSkipped() async {
    final p = await SharedPreferences.getInstance();
    return p.getBool(_profileSkipped) ?? false;
  }

  static Future<void> setProfileSkipped() async {
    final p = await SharedPreferences.getInstance();
    await p.setBool(_profileSkipped, true);
  }

  // ── Recent searches (device-local; there is no backend for search history) ──
  static const _recentSearches = 'recentSearches';
  static const _maxRecent = 8;

  static Future<List<String>> recentSearches() async {
    final p = await SharedPreferences.getInstance();
    return p.getStringList(_recentSearches) ?? const [];
  }

  /// Push a query to the front (deduped, case-insensitive), capped at [_maxRecent].
  static Future<List<String>> addRecentSearch(String query) async {
    final q = query.trim();
    if (q.isEmpty) return recentSearches();
    final p = await SharedPreferences.getInstance();
    final list = p.getStringList(_recentSearches) ?? <String>[];
    list.removeWhere((e) => e.toLowerCase() == q.toLowerCase());
    list.insert(0, q);
    final capped = list.take(_maxRecent).toList();
    await p.setStringList(_recentSearches, capped);
    return capped;
  }

  static Future<List<String>> removeRecentSearch(String query) async {
    final p = await SharedPreferences.getInstance();
    final list = p.getStringList(_recentSearches) ?? <String>[];
    list.removeWhere((e) => e.toLowerCase() == query.toLowerCase());
    await p.setStringList(_recentSearches, list);
    return list;
  }

  static Future<void> clearRecentSearches() async {
    final p = await SharedPreferences.getInstance();
    await p.remove(_recentSearches);
  }
}
