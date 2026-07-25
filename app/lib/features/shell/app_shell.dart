import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/services/cart_provider.dart';
import '../../core/widgets/app_toast.dart';
import '../../core/widgets/nav_bar/bottom_nav_bar.dart';

/// Root shell hosting the 5 bottom-nav tabs — spec §2.1.
/// Wraps a [StatefulNavigationShell] so each tab keeps its own navigation stack.
class AppShell extends StatefulWidget {
  const AppShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  /// When back was last pressed at a tab ROOT — a second press inside this
  /// window exits the app, otherwise the customer is warned. Without it a single
  /// back on any tab dropped straight out of the app (there was no PopScope at
  /// all), which reads as an accidental exit.
  DateTime? _lastBackAt;
  static const _exitWindow = Duration(seconds: 2);

  static const _items = [
    AppNavItem(
        label: 'Home',
        icon: Icons.home_outlined,
        activeIcon: Icons.home_rounded),
    AppNavItem(
        label: 'Category',
        icon: Icons.grid_view_outlined,
        activeIcon: Icons.grid_view_rounded),
    AppNavItem(
        label: 'Bag',
        icon: Icons.shopping_bag_outlined,
        activeIcon: Icons.shopping_bag_rounded),
    AppNavItem(
        label: 'Wallet',
        icon: Icons.account_balance_wallet_outlined,
        activeIcon: Icons.account_balance_wallet_rounded),
    AppNavItem(
        label: 'Profile',
        icon: Icons.person_outline_rounded,
        activeIcon: Icons.person_rounded),
  ];

  @override
  Widget build(BuildContext context) {
    // Distinct products, not total units: one product at qty 9 is a bag with
    // one thing in it, and a badge reading "9" reads as nine different items.
    final bagCount = context.select<CartProvider, int>((c) => c.distinctCount);
    final items = [
      for (var i = 0; i < _items.length; i++)
        if (i == 2)
          AppNavItem(
            label: _items[i].label,
            icon: _items[i].icon,
            activeIcon: _items[i].activeIcon,
            badgeCount: bagCount,
          )
        else
          _items[i],
    ];
    // canPop:false so this handler runs at a tab ROOT. A nested route (product
    // detail, checkout, …) lives in the branch's own Navigator, which pops
    // first and never reaches here — so this only ever fires when there is
    // nothing left to pop inside the active tab.
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        final now = DateTime.now();
        if (_lastBackAt != null && now.difference(_lastBackAt!) <= _exitWindow) {
          SystemNavigator.pop(); // second press within the window → leave the app
          return;
        }
        _lastBackAt = now;
        AppToast.show(context, 'Press back again to exit');
      },
      child: Scaffold(
        body: widget.navigationShell,
        bottomNavigationBar: AppBottomNavBar(
          items: items,
          currentIndex: widget.navigationShell.currentIndex,
          onTap: (i) => widget.navigationShell.goBranch(
            i,
            // Tapping the active tab returns it to its root.
            initialLocation: i == widget.navigationShell.currentIndex,
          ),
        ),
      ),
    );
  }
}
