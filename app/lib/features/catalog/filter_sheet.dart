import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_chip.dart';
import 'data/product.dart';
import 'data/product_filters.dart';

/// Filter bottom sheet (Figma node 50:8713). Returns the chosen [ProductFilters]
/// via "Show N results", or null if dismissed. The live result count is computed
/// against [products] (the category set, already narrowed to the active
/// sub-category) as the user changes selections.
Future<ProductFilters?> showFilterSheet(
  BuildContext context, {
  required List<Product> products,
  required int boundsMinPaise,
  required int boundsMaxPaise,
  required List<String> typeOptions,
  required ProductFilters current,
}) {
  return showModalBottomSheet<ProductFilters>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    barrierColor: Colors.black.withValues(alpha: 0.5),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadii.sheet)),
    ),
    builder: (_) => _FilterSheet(
      products: products,
      boundsMinPaise: boundsMinPaise,
      boundsMaxPaise: boundsMaxPaise,
      typeOptions: typeOptions,
      current: current,
    ),
  );
}

class _FilterSheet extends StatefulWidget {
  const _FilterSheet({
    required this.products,
    required this.boundsMinPaise,
    required this.boundsMaxPaise,
    required this.typeOptions,
    required this.current,
  });

  final List<Product> products;
  final int boundsMinPaise;
  final int boundsMaxPaise;
  final List<String> typeOptions;
  final ProductFilters current;

  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late RangeValues _price;
  late Set<String> _types;
  double? _minRating;

  bool get _hasPriceRange => widget.boundsMaxPaise > widget.boundsMinPaise;

  @override
  void initState() {
    super.initState();
    _reset(initial: true);
  }

  void _reset({bool initial = false}) {
    final lo = (initial ? widget.current.minPricePaise : null) ??
        widget.boundsMinPaise;
    final hi = (initial ? widget.current.maxPricePaise : null) ??
        widget.boundsMaxPaise;
    final clampedLo =
        lo.clamp(widget.boundsMinPaise, widget.boundsMaxPaise).toDouble();
    final clampedHi =
        hi.clamp(widget.boundsMinPaise, widget.boundsMaxPaise).toDouble();
    setState(() {
      _price = RangeValues(
          clampedLo, clampedHi < clampedLo ? clampedLo : clampedHi);
      _types = initial ? {...widget.current.types} : {};
      _minRating = initial ? widget.current.minRating : null;
    });
  }

  ProductFilters _build() => ProductFilters(
        minPricePaise: _hasPriceRange ? _price.start.round() : null,
        maxPricePaise: _hasPriceRange ? _price.end.round() : null,
        types: _types,
        minRating: _minRating,
      );

  int get _resultCount => widget.products.applyListing(filters: _build()).length;

  void _toggleType(String t) {
    setState(() {
      if (_types.contains(t)) {
        _types = {..._types}..remove(t);
      } else {
        _types = {..._types, t};
      }
    });
  }

  void _setRating(double r) {
    setState(() => _minRating = _minRating == r ? null : r);
  }

  @override
  Widget build(BuildContext context) {
    final maxH = MediaQuery.of(context).size.height * 0.85;
    return SafeArea(
      top: false,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: maxH),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              margin: const EdgeInsets.only(top: AppSpacing.x12),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.borderSubtle,
                borderRadius: BorderRadius.circular(AppRadii.pill),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                  AppSpacing.x16, AppSpacing.x20, AppSpacing.x8),
              child: Row(
                children: [
                  Expanded(
                    child: Text('Filters',
                        style: AppType.headingMedium
                            .copyWith(color: AppColors.textPrimary)),
                  ),
                  GestureDetector(
                    onTap: () => _reset(),
                    child: Text('Reset',
                        style: AppType.bodyMedium.copyWith(
                            fontWeight: FontWeight.w600,
                            color: AppColors.textTertiary)),
                  ),
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                    AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (_hasPriceRange) ...[
                      _label('Price range'),
                      const SizedBox(height: AppSpacing.x4),
                      SliderTheme(
                        data: SliderTheme.of(context).copyWith(
                          activeTrackColor: AppColors.brandGreen,
                          inactiveTrackColor: AppColors.borderSubtle,
                          thumbColor: Colors.white,
                          overlayColor:
                              AppColors.brandGreen.withValues(alpha: 0.12),
                          rangeThumbShape: const RoundRangeSliderThumbShape(
                              enabledThumbRadius: 10),
                          trackHeight: 3,
                          showValueIndicator: ShowValueIndicator.never,
                        ),
                        child: RangeSlider(
                          min: widget.boundsMinPaise.toDouble(),
                          max: widget.boundsMaxPaise.toDouble(),
                          values: _price,
                          onChanged: (v) => setState(() => _price = v),
                        ),
                      ),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(Money.fromPaiseCompact(_price.start.round()),
                              style: _priceStyle),
                          Text(Money.fromPaiseCompact(_price.end.round()),
                              style: _priceStyle),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.x20),
                    ],
                    if (widget.typeOptions.isNotEmpty) ...[
                      _label('Type'),
                      const SizedBox(height: AppSpacing.x10),
                      Wrap(
                        spacing: 9,
                        runSpacing: 9,
                        children: [
                          for (final t in widget.typeOptions)
                            AppChip(
                              label: t,
                              selected: _types.contains(t),
                              variant: AppChipVariant.filter,
                              onTap: () => _toggleType(t),
                            ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.x20),
                    ],
                    _label('Rating'),
                    const SizedBox(height: AppSpacing.x10),
                    Wrap(
                      spacing: 9,
                      runSpacing: 9,
                      children: [
                        AppChip(
                          label: '4.5 & up',
                          leadingStar: true,
                          selected: _minRating == 4.5,
                          variant: AppChipVariant.rating,
                          onTap: () => _setRating(4.5),
                        ),
                        AppChip(
                          label: '4.0 & up',
                          leadingStar: true,
                          selected: _minRating == 4.0,
                          variant: AppChipVariant.rating,
                          onTap: () => _setRating(4.0),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.x8),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x16),
              child: Row(
                children: [
                  Expanded(
                    child: AppButton.outlined(
                      label: 'Clear',
                      onPressed: () => _reset(),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.x12),
                  Expanded(
                    flex: 2,
                    child: AppButton.reward(
                      label: 'Show $_resultCount result${_resultCount == 1 ? '' : 's'}',
                      onPressed: () => Navigator.of(context).pop(_build()),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _label(String text) => Text(text,
      style: AppType.bodyMedium.copyWith(
          fontSize: 13,
          fontWeight: FontWeight.w800,
          color: AppColors.textPrimary));

  TextStyle get _priceStyle => AppType.bodyMedium.copyWith(
      fontSize: 13,
      fontWeight: FontWeight.w800,
      color: AppColors.brandGoldStrong);
}
