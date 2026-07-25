import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/create_profile_screen.dart';
import '../../features/auth/data/auth_repository.dart';
import '../../features/auth/enter_mobile_screen.dart';
import '../../features/auth/onboarding_screen.dart';
import '../../features/auth/otp_screen.dart';
import '../../features/auth/splash_screen.dart';
import '../../features/catalog/categories_screen.dart';
import '../../features/catalog/category_products_screen.dart';
import '../../features/catalog/product_details_screen.dart';
import '../../features/catalog/product_list_screen.dart';
import '../../features/catalog/reviews_screen.dart';
import '../../features/cart/bag_screen.dart';
import '../../features/checkout/add_address_screen.dart';
import '../../features/checkout/saved_addresses_screen.dart';
import '../../features/checkout/checkout_screen.dart';
import '../../features/checkout/coupon_screen.dart';
import '../../features/checkout/order_confirmation_screen.dart';
import '../../features/checkout/payment_screen.dart';
import '../../features/checkout/data/address.dart';
import '../../features/checkout/data/checkout_repository.dart';
import '../../features/catalog/data/category.dart';
import '../../features/catalog/data/product.dart';
import '../../features/home/home_screen.dart';
import '../../features/notifications/notifications_screen.dart';
import '../../features/profile/edit_profile_screen.dart';
import '../../features/settings/content_page_screen.dart';
import '../../features/settings/settings_screen.dart';
import '../../features/orders/data/order.dart';
import '../../features/orders/invoice_screen.dart';
import '../../features/orders/order_detail_screen.dart';
import '../../features/orders/order_tracking_screen.dart';
import '../../features/orders/orders_screen.dart';
import '../../features/orders/return_request_screen.dart';
import '../../features/affiliate/affiliate_add_bank_screen.dart';
import '../../features/affiliate/affiliate_banks_screen.dart';
import '../../features/affiliate/affiliate_dashboard_screen.dart';
import '../../features/affiliate/affiliate_wallet_screen.dart';
import '../../features/affiliate/affiliate_withdraw_screen.dart';
import '../../features/affiliate/data/affiliate_models.dart';
import '../../features/coupons/coupons_screen.dart';
import '../../features/profile/profile_screen.dart';
import '../../features/search/search_screen.dart';
import '../../features/spin/spin_reward_screen.dart';
import '../../features/spin/spin_screen.dart';
import '../../features/support/help_centre_screen.dart';
import '../../features/wallet/wallet_screen.dart';
import '../../features/wishlist/wishlist_screen.dart';
import '../../features/shell/app_shell.dart';
import '../services/auth_provider.dart';

/// Route path constants — one source of truth for navigation.
abstract final class Routes {
  static const splash = '/splash';
  static const onboarding = '/onboarding';
  static const signin = '/signin';
  static const otp = '/otp';
  static const createProfile = '/create-profile';

  static const home = '/home';
  static const search = '/search';
  static const notifications = '/notifications';
  static const categories = '/categories';
  static const category = '/category'; // + /:slug → Category Products
  static const product = '/product'; //   + /:id   → Product Details
  static const productList = '/products'; // See-all grid (extra: {title, source})
  static const coupon = '/coupon';
  static const checkout = '/checkout';
  static const addAddress = '/address/edit'; // optional ?id via extra
  static const savedAddresses = '/addresses'; // Saved addresses list
  static const payment = '/payment';
  static const orderConfirmation = '/order-confirmation';
  static const bag = '/bag';
  static const wallet = '/wallet';
  static const profile = '/profile';
  static const editProfile = '/profile/edit';
  static const settings = '/settings';
  static const contentPage = '/content'; // + /:id → policy/content page
  static const helpCentre = '/help';
  static const wishlist = '/wishlist';
  static const spin = '/spin'; //             Spin & Win wheel
  static const spinReward = '/spin/reward'; // reward result (extra: SpinRewardArgs)
  static const myCoupons = '/my-coupons'; //  My coupons (Active/Used/Expired)

  // Orders (Profile → My orders → detail → tracking / invoice / return).
  static const orders = '/orders';
  static const order = '/order'; //          + /:id → Order Detail
  static const orderTracking = '/order-tracking'; // + /:id → Track Order
  static const invoice = '/invoice'; //      + /:id → Invoice
  static const returnRequest = '/return-request'; // extra: {orderId, item}

  /// Affiliate-gated routes (spec §0.2) — enforced by [affiliateGuard].
  static const affiliateDashboard = '/affiliate';
  static const affiliateWallet = '/affiliate/wallet';
  static const referEarn = '/refer';
  static const affiliateBanks = '/affiliate/banks'; // saved payout accounts
  static const addBank = '/affiliate/bank/add'; // + extra: BankAccount → edit
  static const completeWithdrawal = '/affiliate/withdraw';
}

/// Shell tabs require a session. Everything else (auth flow) is open.
const _protectedPrefixes = [
  Routes.home,
  Routes.search,
  Routes.notifications,
  Routes.category, // covers /category/:slug AND /categories
  Routes.product,
  Routes.coupon,
  Routes.checkout,
  Routes.payment,
  Routes.orderConfirmation,
  '/address',
  Routes.categories,
  Routes.bag,
  Routes.wallet,
  Routes.profile,
  Routes.settings,
  // NOT contentPage: Terms & Conditions / Privacy Policy must be readable
  // pre-auth (linked from the sign-in screen) — the Firestore rule for
  // `content` already only requires App Check, not a session.
  Routes.helpCentre,
  Routes.spin, // covers /spin and /spin/reward
  Routes.myCoupons,
  Routes.orders,
  Routes.order, // covers /order/:id, /order-tracking, /order-confirmation
  Routes.invoice,
  Routes.returnRequest,
  Routes.affiliateDashboard,
  Routes.referEarn,
];

/// Part 1 flips this on: the shell now requires auth; the app boots to Splash,
/// which routes to onboarding / sign-in / create-profile / home.
const bool kEnforceAuth = true;

/// The root navigator. Exposed because navigation can be triggered from
/// outside the widget tree — a tapped push notification arrives on a plugin
/// callback with no BuildContext of its own, so [PushMessageService] checks
/// this key to know whether there is a Navigator to push onto yet.
final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();

final _rootKey = rootNavigatorKey;

GoRouter createRouter(AuthProvider auth) {
  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: kEnforceAuth ? Routes.splash : Routes.home,
    refreshListenable: auth,
    redirect: (context, state) {
      if (!kEnforceAuth) return null;
      final loc = state.matchedLocation;
      final protected = _protectedPrefixes.any((p) => loc.startsWith(p));
      if (protected && auth.ready && !auth.isAuthenticated) return Routes.signin;
      return null;
    },
    routes: [
      GoRoute(path: Routes.splash, builder: (_, _) => const SplashScreen()),
      GoRoute(
          path: Routes.onboarding, builder: (_, _) => const OnboardingScreen()),
      GoRoute(path: Routes.signin, builder: (_, _) => const EnterMobileScreen()),
      GoRoute(
        path: Routes.otp,
        builder: (_, state) {
          final args = (state.extra as Map?) ?? const {};
          return OtpScreen(
            localPhone: (args['phone'] as String?) ?? '',
            // Opened by `sendOtp` on the previous screen; absent if this route
            // was reached without one (the screen treats that as expired).
            session: args['session'] as OtpSession?,
          );
        },
      ),
      GoRoute(
        path: Routes.createProfile,
        builder: (_, state) {
          final args = (state.extra as Map?) ?? const {};
          return CreateProfileScreen(localPhone: (args['phone'] as String?) ?? '');
        },
      ),

      // Search — full-screen, pushed over the shell (own back button).
      GoRoute(
        path: Routes.search,
        parentNavigatorKey: _rootKey,
        builder: (_, state) => SearchScreen(
          initialQuery: (state.extra as String?) ?? '',
        ),
      ),

      // Category products — pushed over the shell, `/category/:slug`.
      GoRoute(
        path: '${Routes.category}/:slug',
        parentNavigatorKey: _rootKey,
        builder: (_, state) => CategoryProductsScreen(
          slug: state.pathParameters['slug']!,
          category: state.extra is Category ? state.extra as Category : null,
        ),
      ),

      // Product details — pushed over the shell, `/product/:id`.
      GoRoute(
        path: '${Routes.product}/:id',
        parentNavigatorKey: _rootKey,
        builder: (_, state) => ProductDetailsScreen(
          productId: state.pathParameters['id']!,
          product: state.extra is Product ? state.extra as Product : null,
        ),
      ),

      // See-all product grid — pushed over the shell, `/products`.
      GoRoute(
        path: Routes.productList,
        parentNavigatorKey: _rootKey,
        builder: (_, state) {
          final args = (state.extra as Map?) ?? const {};
          return ProductListScreen(
            title: (args['title'] as String?) ?? 'Products',
            source: (args['source'] as String?) ?? 'all',
          );
        },
      ),

      // Ratings & reviews — pushed over the shell, `/product/:id/reviews`.
      GoRoute(
        path: '${Routes.product}/:id/reviews',
        parentNavigatorKey: _rootKey,
        builder: (_, state) {
          final args = (state.extra as Map?) ?? const {};
          return ReviewsScreen(
            productId: state.pathParameters['id']!,
            rating: (args['rating'] as num?)?.toDouble() ?? 0,
            ratingCount: (args['ratingCount'] as num?)?.toInt() ?? 0,
          );
        },
      ),

      // Checkout flow — all pushed over the shell.
      GoRoute(
        path: Routes.coupon,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const CouponScreen(),
      ),
      GoRoute(
        path: Routes.checkout,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const CheckoutScreen(),
      ),
      GoRoute(
        path: Routes.addAddress,
        parentNavigatorKey: _rootKey,
        builder: (_, state) => AddAddressScreen(
          existing: state.extra is Address ? state.extra as Address : null,
        ),
      ),
      GoRoute(
        path: Routes.savedAddresses,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const SavedAddressesScreen(),
      ),
      GoRoute(
        path: Routes.payment,
        parentNavigatorKey: _rootKey,
        // `extra` is an int (payable amount) for a fresh checkout, or a Map
        // {orderId, shortId, payablePaise} to RESUME paying an existing unpaid
        // order (the "Pay now" retry from My orders).
        builder: (_, state) {
          final extra = state.extra;
          if (extra is Map) {
            return PaymentScreen(
              payablePaise: (extra['payablePaise'] as num?)?.toInt() ?? 0,
              resumeOrderId: extra['orderId'] as String?,
              resumeShortId: extra['shortId'] as String?,
            );
          }
          return PaymentScreen(payablePaise: extra is int ? extra : 0);
        },
      ),
      GoRoute(
        path: Routes.orderConfirmation,
        parentNavigatorKey: _rootKey,
        builder: (_, state) => OrderConfirmationScreen(
          order: state.extra is PlacedOrder ? state.extra as PlacedOrder : null,
        ),
      ),

      // Orders flow — all pushed over the shell (own back buttons).
      GoRoute(
        path: Routes.orders,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const OrdersScreen(),
      ),
      GoRoute(
        path: '${Routes.order}/:id',
        parentNavigatorKey: _rootKey,
        builder: (_, state) => OrderDetailScreen(
          orderId: state.pathParameters['id']!,
          initial: state.extra is Order ? state.extra as Order : null,
        ),
      ),
      GoRoute(
        path: '${Routes.orderTracking}/:id',
        parentNavigatorKey: _rootKey,
        builder: (_, state) =>
            OrderTrackingScreen(orderId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '${Routes.invoice}/:id',
        parentNavigatorKey: _rootKey,
        builder: (_, state) =>
            InvoiceScreen(orderId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: Routes.wishlist,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const WishlistScreen(),
      ),

      GoRoute(
        path: Routes.notifications,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const NotificationsScreen(),
      ),
      GoRoute(
        path: Routes.editProfile,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const EditProfileScreen(),
      ),
      GoRoute(
        path: Routes.settings,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const SettingsScreen(),
      ),
      GoRoute(
        path: '${Routes.contentPage}/:id',
        parentNavigatorKey: _rootKey,
        builder: (_, state) =>
            ContentPageScreen(pageId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: Routes.helpCentre,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const HelpCentreScreen(),
      ),

      // Spin & Win → reward → coupons.
      GoRoute(
        path: Routes.spin,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const SpinScreen(),
      ),
      GoRoute(
        path: Routes.spinReward,
        parentNavigatorKey: _rootKey,
        builder: (_, state) => SpinRewardScreen(
          args: state.extra is SpinRewardArgs
              ? state.extra as SpinRewardArgs
              : const SpinRewardArgs(
                  kind: 'better_luck',
                  headline: 'Better luck!',
                  subtitle: 'No prize this time — try again tomorrow'),
        ),
      ),
      GoRoute(
        path: Routes.myCoupons,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const CouponsScreen(),
      ),

      // Affiliate — dashboard → wallet → withdraw → add bank.
      GoRoute(
        path: Routes.affiliateDashboard,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const AffiliateDashboardScreen(),
      ),
      GoRoute(
        path: Routes.affiliateWallet,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const AffiliateWalletScreen(),
      ),
      GoRoute(
        path: Routes.completeWithdrawal,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const AffiliateWithdrawScreen(),
      ),
      GoRoute(
        path: Routes.affiliateBanks,
        parentNavigatorKey: _rootKey,
        builder: (_, _) => const AffiliateBanksScreen(),
      ),
      // Add and edit share one screen (as add/edit address do): passing the
      // saved account as `extra` switches it into edit mode.
      GoRoute(
        path: Routes.addBank,
        parentNavigatorKey: _rootKey,
        builder: (_, state) => AffiliateAddBankScreen(
          existing: state.extra is BankAccount ? state.extra as BankAccount : null,
        ),
      ),
      GoRoute(
        path: Routes.returnRequest,
        parentNavigatorKey: _rootKey,
        builder: (_, state) {
          final args = (state.extra as Map?) ?? const {};
          return ReturnRequestScreen(
            orderId: (args['orderId'] as String?) ?? '',
            item: args['item'] as OrderItem,
          );
        },
      ),

      // ── Bottom-nav shell (5 branches, screens land in Parts 2–8) ─────
      StatefulShellRoute.indexedStack(
        builder: (_, _, shell) => AppShell(navigationShell: shell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(path: Routes.home, builder: (_, _) => const HomeScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
                path: Routes.categories,
                builder: (_, _) => const CategoriesScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: Routes.bag, builder: (_, _) => const BagScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
                path: Routes.wallet, builder: (_, _) => const WalletScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(
                path: Routes.profile, builder: (_, _) => const ProfileScreen()),
          ]),
        ],
      ),
    ],
  );
}

/// Guard for affiliate-only routes — call from a route's `redirect`.
String? affiliateGuard(AuthProvider auth) =>
    auth.isAffiliate ? null : Routes.profile;
