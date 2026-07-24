import 'package:barkath_app/core/router/app_router.dart';
import 'package:barkath_app/features/notifications/notification_deep_link.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

/// A router with the same paths [Routes] declares, so the destinations asserted
/// below are the real ones. Deliberately NOT `createRouter` — that one needs an
/// AuthProvider, and therefore Firebase, which a unit test has no business
/// booting.
///
GoRouter _router() {
  GoRoute at(String path) =>
      GoRoute(path: path, builder: (_, _) => const SizedBox.shrink());
  return GoRouter(
    initialLocation: Routes.splash,
    routes: [
      at(Routes.splash),
      at(Routes.home),
      at(Routes.wallet),
      at(Routes.notifications),
      at(Routes.myCoupons),
      at(Routes.affiliateDashboard),
      at('${Routes.product}/:id'),
      at('${Routes.category}/:slug'),
      at('${Routes.order}/:id'),
    ],
  );
}

/// Drive [body] against a live router and report the screen it landed on.
///
/// Reads the LAST route match rather than `currentConfiguration.uri`: an
/// imperative `push` leaves the uri on the route underneath, so the uri would
/// report "/splash" for a push that worked perfectly.
Future<String> _where(
  WidgetTester tester,
  void Function(GoRouter) body,
) async {
  final router = _router();
  await tester.pumpWidget(MaterialApp.router(routerConfig: router));
  body(router);
  await tester.pumpAndSettle();
  return router.routerDelegate.currentConfiguration.matches.last.matchedLocation;
}

void main() {
  group('appPath is preferred', () {
    testWidgets('the server-resolved path is used as-is', (tester) async {
      // functions/src/notifications/push.ts resolves `{type:'order'}` to this.
      final at = await _where(
        tester,
        (r) => NotificationDeepLink.openData(r, const {
          'appPath': '/order/abc123',
          'deepLinkType': 'home', // would go elsewhere — must not win
          'deepLinkTarget': '',
        }),
      );
      expect(at, '/order/abc123');
    });

    testWidgets('an unrecognised appPath falls back to type/target',
        (tester) async {
      final at = await _where(
        tester,
        (r) => NotificationDeepLink.openData(r, const {
          'appPath': '/some/route/the/app/does/not/have',
          'deepLinkType': 'product',
          'deepLinkTarget': 'p1',
        }),
      );
      expect(at, '/product/p1');
    });

    testWidgets('an unroutable message leaves the customer where they were',
        (tester) async {
      final at = await _where(
        tester,
        (r) => NotificationDeepLink.openData(r, const {
          'appPath': '',
          'deepLinkType': 'none',
          'deepLinkTarget': '',
        }),
      );
      expect(at, Routes.splash);
    });
  });

  group('every deep-link type the server emits has a destination', () {
    // Mirrors `routesFor` in functions/src/notifications/push.ts.
    final cases = <({String type, String target, String expected})>[
      (type: 'home', target: '', expected: Routes.home),
      (type: 'product', target: 'p1', expected: '/product/p1'),
      (type: 'category', target: 'attar', expected: '/category/attar'),
      (type: 'order', target: 'o1', expected: '/order/o1'),
      (type: 'wallet', target: '', expected: Routes.wallet),
      (type: 'affiliate', target: '', expected: Routes.affiliateDashboard),
      (type: 'coupons', target: '', expected: Routes.myCoupons),
      (type: 'notifications', target: '', expected: Routes.notifications),
    ];

    for (final c in cases) {
      testWidgets('${c.type} → ${c.expected}', (tester) async {
        final at = await _where(
          tester,
          (r) => NotificationDeepLink.open(r,
              type: c.type, target: c.target),
        );
        expect(at, c.expected);
      });
    }
  });

  group('targets that cannot be routed', () {
    testWidgets('product without a target does nothing', (tester) async {
      final at = await _where(
        tester,
        (r) => NotificationDeepLink.open(r, type: 'product', target: ''),
      );
      expect(at, Routes.splash);
    });

    testWidgets('order without a target does nothing', (tester) async {
      final at = await _where(
        tester,
        (r) => NotificationDeepLink.open(r, type: 'order', target: null),
      );
      expect(at, Routes.splash);
    });

    testWidgets('an unknown type does nothing', (tester) async {
      final at = await _where(
        tester,
        (r) => NotificationDeepLink.open(r, type: 'wormhole', target: 'x'),
      );
      expect(at, Routes.splash);
    });
  });

  group('external URLs never become in-app routes', () {
    test('a non-http scheme is refused', () {
      // No navigation and no launch — url_launcher is not even consulted,
      // so this needs no router.
      expect(
        NotificationDeepLink.openPath(_router(), 'javascript:alert(1)'),
        isFalse,
      );
      expect(
        NotificationDeepLink.openPath(_router(), 'file:///etc/passwd'),
        isFalse,
      );
    });

    test('a bare path outside the known set is refused', () {
      expect(NotificationDeepLink.openPath(_router(), '/admin'), isFalse);
      // /order-tracking must NOT be matched by the /order/ prefix check.
      expect(
        NotificationDeepLink.openPath(_router(), '/order-tracking/o1'),
        isFalse,
      );
    });
  });
}
