// Firebase config for project **barkath-25607** — the SAME backend as the admin
// panel and web storefront (shared Firestore, Auth, Storage).
//
// Values mirror web/.env.local. The web appId is reused as a placeholder for
// Android/iOS so the app compiles and connects for development; before shipping
// to a device, run `flutterfire configure` (or register Android/iOS apps in the
// Firebase console) to mint platform-specific appIds + google-services files.
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        return web;
    }
  }

  static const String _apiKey = 'AIzaSyAGzLDHQWWzDLlvYzR1Fb6kUdT1PZSxI48';
  static const String _projectId = 'barkath-25607';
  static const String _messagingSenderId = '250143652149';
  static const String _storageBucket = 'barkath-25607.firebasestorage.app';

  // TODO(flutterfire): replace appId for android/ios with platform-registered IDs.
  static const String _webAppId = '1:250143652149:web:5c8c833aefe2334709f47c';

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyAGzLDHQWWzDLlvYzR1Fb6kUdT1PZSxI48',
    appId: '1:250143652149:web:5c8c833aefe2334709f47c',
    messagingSenderId: '250143652149',
    projectId: 'barkath-25607',
    authDomain: 'barkath-25607.firebaseapp.com',
    storageBucket: 'barkath-25607.firebasestorage.app',
    measurementId: 'G-E5YE59TZGR',
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyA3CYQuznf5qJPAlj2k9fpEH2riGNGO-lk',
    appId: '1:250143652149:android:1ac4e2e98aa3e94b09f47c',
    messagingSenderId: '250143652149',
    projectId: 'barkath-25607',
    storageBucket: 'barkath-25607.firebasestorage.app',
  );
  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: _apiKey,
    appId: _webAppId, // TODO: register iOS app → ios appId
    messagingSenderId: _messagingSenderId,
    projectId: _projectId,
    storageBucket: _storageBucket,
    iosBundleId: 'app.barkath.barkathApp',
  );
}
