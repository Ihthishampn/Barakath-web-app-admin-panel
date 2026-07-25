import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'core/router/app_router.dart';
import 'core/services/auth_provider.dart';
import 'core/services/cart_provider.dart';
import 'core/services/checkout_draft.dart';
import 'core/services/push_message_service.dart';
import 'core/services/push_token_service.dart';
import 'core/services/wishlist_provider.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/data/auth_repository.dart';
import 'firebase_options.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  // Start listening for FCM token rotations before any session resolves — a
  // refresh that lands while the app is open must still reach `fcmTokens`.
  PushTokenService.instance.start();
  // MUST be registered before runApp: FCM binds the background isolate entry
  // point at plugin registration time, so a handler installed later never runs
  // for a message that arrives while the app is backgrounded or dead.
  FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle.dark);
  runApp(const BarkathApp());
}

class BarkathApp extends StatefulWidget {
  const BarkathApp({super.key});

  @override
  State<BarkathApp> createState() => _BarkathAppState();
}

class _BarkathAppState extends State<BarkathApp> {
  late final AuthProvider _auth = AuthProvider();
  late final CartProvider _cart = CartProvider(_auth);
  late final WishlistProvider _wishlist = WishlistProvider(_auth);
  final CheckoutDraft _checkout = CheckoutDraft();
  late final GoRouter _router = createRouter(_auth);

  @override
  void initState() {
    super.initState();
    // Handle FCM messages from here on. Started with the router already built,
    // because a tap that STARTED the process is read by `getInitialMessage`
    // inside start() and has nowhere to go without one.
    unawaited(PushMessageService.instance.start(router: _router, auth: _auth));
  }

  @override
  void dispose() {
    _checkout.dispose();
    _cart.dispose();
    _wishlist.dispose();
    _auth.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: _auth),
        ChangeNotifierProvider.value(value: _cart),
        ChangeNotifierProvider.value(value: _wishlist),
        ChangeNotifierProvider.value(value: _checkout),
        Provider<AuthRepository>(create: (_) => AuthRepository()),
      ],
      child: MaterialApp.router(
        title: 'Barakath',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light,
        routerConfig: _router,
      ),
    );
  }
}
