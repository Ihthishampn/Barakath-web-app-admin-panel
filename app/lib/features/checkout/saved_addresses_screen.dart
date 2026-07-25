import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/router/app_router.dart';
import '../../core/services/auth_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_dialog.dart';
import '../../core/widgets/app_medallion.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import '../../core/widgets/app_toast.dart';
import 'data/address.dart';
import 'data/address_repository.dart';

/// Screen — Saved addresses. Lists the customer's saved delivery addresses
/// (`customers/{uid}.addresses`) with add / edit / delete / set-default, reusing
/// the existing [AddAddressScreen] for create + edit. Reached from Profile.
class SavedAddressesScreen extends StatelessWidget {
  const SavedAddressesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final uid = context.select<AuthProvider, String?>((a) => a.uid);
    final repo = AddressRepository();
    return Scaffold(
      backgroundColor: AppColors.surfaceBackground,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _header(context),
            Expanded(
              child: uid == null
                  ? const AppErrorState(message: "Couldn't load your addresses.")
                  : StreamBuilder<List<Address>>(
                      stream: repo.watch(uid),
                      builder: (context, snap) {
                        if (snap.hasError) {
                          return const AppErrorState(
                              message: "Couldn't load your addresses.");
                        }
                        if (!snap.hasData) return const _AddressSkeleton();
                        final addresses = snap.data!;
                        if (addresses.isEmpty) {
                          return _empty(context);
                        }
                        return ListView(
                          padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                              AppSpacing.x4, AppSpacing.x20, AppSpacing.x24),
                          children: [
                            for (final a in addresses) ...[
                              _AddressCard(uid: uid, address: a, repo: repo),
                              const SizedBox(height: AppSpacing.x12),
                            ],
                            const SizedBox(height: AppSpacing.x4),
                            AppButton.outlined(
                              label: 'Add new address',
                              icon: Icons.add_rounded,
                              onPressed: () => context.push(Routes.addAddress),
                            ),
                          ],
                        );
                      },
                    ),
            ),
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
          Text('Saved addresses',
              style: AppType.headingLarge.copyWith(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.48)),
        ],
      ),
    );
  }

  Widget _empty(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x24, AppSpacing.x20, AppSpacing.x24),
      children: [
        const AppEmptyState(
          icon: Icons.location_on_outlined,
          title: 'No saved addresses',
          subtitle: 'Add a delivery address to speed up checkout.',
        ),
        const SizedBox(height: AppSpacing.x20),
        AppButton.reward(
          label: 'Add address',
          icon: Icons.add_rounded,
          onPressed: () => context.push(Routes.addAddress),
        ),
      ],
    );
  }
}

class _AddressCard extends StatelessWidget {
  const _AddressCard(
      {required this.uid, required this.address, required this.repo});
  final String uid;
  final Address address;
  final AddressRepository repo;

  Future<void> _delete(BuildContext context) async {
    final ok = await AppDialog.show<bool>(
      context,
      dialog: Builder(
        builder: (ctx) => AppDialog(
          medallion: AppMedallionVariant.destructiveIconed,
          title: 'Delete this address?',
          body: 'This removes the saved address. This cannot be undone.',
          primaryLabel: 'Delete',
          primaryVariant: AppButtonVariant.destructive,
          onPrimary: () => Navigator.of(ctx).pop(true),
          secondaryLabel: 'Keep',
          onSecondary: () => Navigator.of(ctx).pop(false),
        ),
      ),
    );
    if (ok != true) return;
    try {
      await repo.remove(uid, address.id);
      if (context.mounted) {
        AppToast.show(context, 'Address deleted',
            variant: AppToastVariant.success);
      }
    } catch (_) {
      if (context.mounted) {
        AppToast.show(context, "Couldn't delete this address.",
            variant: AppToastVariant.error);
      }
    }
  }

  Future<void> _setDefault(BuildContext context) async {
    try {
      await repo.setDefault(uid, address.id);
      if (context.mounted) {
        AppToast.show(context, 'Default address updated',
            variant: AppToastVariant.success);
      }
    } catch (_) {
      if (context.mounted) {
        AppToast.show(context, "Couldn't update the default address.",
            variant: AppToastVariant.error);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.x16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.card),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(address.label,
                  style: AppType.bodyMedium.copyWith(
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary)),
              if (address.isDefault) ...[
                const SizedBox(width: AppSpacing.x8),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: AppColors.brandGreenSubtle,
                    borderRadius: BorderRadius.circular(AppRadii.pill),
                  ),
                  child: Text('Default',
                      style: AppType.bodySmall.copyWith(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          color: AppColors.brandGreen)),
                ),
              ],
              const Spacer(),
              GestureDetector(
                onTap: () =>
                    context.push(Routes.addAddress, extra: address),
                behavior: HitTestBehavior.opaque,
                child: const Icon(Icons.edit_outlined,
                    size: 19, color: AppColors.textSecondary),
              ),
              const SizedBox(width: AppSpacing.x16),
              GestureDetector(
                onTap: () => _delete(context),
                behavior: HitTestBehavior.opaque,
                child: const Icon(Icons.delete_outline_rounded,
                    size: 19, color: AppColors.destructiveRed),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.x8),
          Text('${address.name} · ${address.phone}',
              style: AppType.bodySmall.copyWith(
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary)),
          const SizedBox(height: 2),
          Text(address.formatted,
              style: AppType.bodySmall.copyWith(
                  height: 1.4, color: AppColors.textSecondary)),
          if (!address.isDefault) ...[
            const SizedBox(height: AppSpacing.x12),
            GestureDetector(
              onTap: () => _setDefault(context),
              behavior: HitTestBehavior.opaque,
              child: Text('Set as default',
                  style: AppType.bodySmall.copyWith(
                      fontWeight: FontWeight.w800,
                      color: AppColors.brandGreen)),
            ),
          ],
        ],
      ),
    );
  }
}

class _AddressSkeleton extends StatelessWidget {
  const _AddressSkeleton();
  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x4, AppSpacing.x20, AppSpacing.x24),
      children: const [
        AppShimmer(height: 108, radius: AppRadii.card),
        SizedBox(height: AppSpacing.x12),
        AppShimmer(height: 108, radius: AppRadii.card),
      ],
    );
  }
}
