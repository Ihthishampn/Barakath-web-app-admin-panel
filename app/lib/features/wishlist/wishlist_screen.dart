import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/router/app_router.dart';
import '../../core/services/wishlist_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import '../../core/widgets/product_card.dart';

/// Screen — Wishlist (Figma node 82:5149). A 2-column grid of the products the
/// customer has favourited. Backed by [WishlistProvider], so it's live and stays
/// in sync with the web (same `customers/{uid}/wishlist` docs). Tapping a card's
/// heart removes it; the grid updates in real time.
class WishlistScreen extends StatelessWidget {
  const WishlistScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final wishlist = context.watch<WishlistProvider>();
    return Scaffold(
      backgroundColor: AppColors.surfaceBackground,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _header(context),
            Expanded(child: _body(context, wishlist)),
          ],
        ),
      ),
    );
  }

  Widget _header(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x10, AppSpacing.x20, AppSpacing.x12),
      child: Row(
        children: [
          AppCircleIconButton(
            icon: Icons.arrow_back_rounded,
            iconColor: AppColors.textPrimary,
            onTap: () => context.pop(),
          ),
          const SizedBox(width: AppSpacing.x12),
          Text('Wishlist',
              style: AppType.headingLarge.copyWith(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.48)),
        ],
      ),
    );
  }

  Widget _body(BuildContext context, WishlistProvider wishlist) {
    if (wishlist.loading) return _skeleton();
    if (wishlist.isEmpty) {
      return const AppEmptyState(
        icon: Icons.favorite_border_rounded,
        title: 'Your wishlist is empty',
        subtitle: 'Tap the heart on any product to save it here.',
      );
    }
    final items = wishlist.items;
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x20),
      itemCount: items.length,
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 210,
        crossAxisSpacing: AppSpacing.x14,
        mainAxisSpacing: AppSpacing.x14,
        mainAxisExtent: 252,
      ),
      itemBuilder: (context, i) {
        final product = items[i].toProduct();
        return ProductCard(
          product: product,
          onTap: () =>
              context.push('${Routes.product}/${product.id}', extra: product),
        );
      },
    );
  }

  Widget _skeleton() {
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x20),
      itemCount: 4,
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 210,
        crossAxisSpacing: AppSpacing.x14,
        mainAxisSpacing: AppSpacing.x14,
        mainAxisExtent: 252,
      ),
      itemBuilder: (_, _) =>
          const AppShimmer(height: 252, radius: AppRadii.field),
    );
  }
}
