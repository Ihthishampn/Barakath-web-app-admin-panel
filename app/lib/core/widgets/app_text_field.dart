import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

/// Label-above text field — spec §1.6. States: normal / focus / error / disabled.
class AppTextField extends StatelessWidget {
  const AppTextField({
    super.key,
    required this.label,
    this.controller,
    this.hint,
    this.errorText,
    this.enabled = true,
    this.readOnly = false,
    this.obscure = false,
    this.keyboardType,
    this.inputFormatters,
    this.prefixText,
    this.prefixIcon,
    this.maxLength,
    this.maxLines = 1,
    this.textCapitalization = TextCapitalization.none,
    this.onChanged,
    this.onTap,
    this.autofocus = false,
  });

  final String label;
  final TextEditingController? controller;
  final String? hint;
  final String? errorText;
  final bool enabled;
  final bool readOnly;
  final bool obscure;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;

  /// Inline prefix (e.g. `₹ ` or `+91`).
  final String? prefixText;
  final IconData? prefixIcon;
  final int? maxLength;
  final int maxLines;
  final TextCapitalization textCapitalization;
  final ValueChanged<String>? onChanged;
  final VoidCallback? onTap;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    final hasError = errorText != null && errorText!.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: AppType.bodyMedium.copyWith(
            color: AppColors.textSecondary,
            fontWeight: FontWeight.w500,
            fontSize: 13,
          ),
        ),
        const SizedBox(height: AppSpacing.x8),
        TextField(
          controller: controller,
          enabled: enabled,
          readOnly: readOnly,
          obscureText: obscure,
          keyboardType: keyboardType,
          inputFormatters: inputFormatters,
          maxLength: maxLength,
          maxLines: obscure ? 1 : maxLines,
          minLines: 1,
          autofocus: autofocus,
          textCapitalization: textCapitalization,
          onChanged: onChanged,
          onTap: onTap,
          style: AppType.bodyMedium.copyWith(color: AppColors.textPrimary),
          decoration: InputDecoration(
            counterText: '',
            isDense: true,
            hintText: hint,
            hintStyle:
                AppType.bodyMedium.copyWith(color: AppColors.textSecondary),
            prefixText: prefixText,
            prefixStyle:
                AppType.bodyMedium.copyWith(color: AppColors.textPrimary),
            prefixIcon: prefixIcon == null
                ? null
                : Icon(prefixIcon, size: 18, color: AppColors.brandGreen),
            filled: true,
            fillColor: Colors.white,
            contentPadding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.x16, vertical: AppSpacing.x16),
            border: _border(AppColors.borderSubtle, 1),
            enabledBorder:
                _border(hasError ? AppColors.destructiveRed : AppColors.borderSubtle,
                    hasError ? 2 : 1),
            focusedBorder: _border(
                hasError ? AppColors.destructiveRed : AppColors.brandGreen, 2),
            disabledBorder: _border(AppColors.borderSubtle, 1),
          ),
        ),
        if (hasError) ...[
          const SizedBox(height: AppSpacing.x4),
          Text(
            errorText!,
            style: AppType.bodySmall.copyWith(color: AppColors.destructiveRed),
          ),
        ],
      ],
    );
  }

  OutlineInputBorder _border(Color color, double width) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadii.control),
        borderSide: BorderSide(color: color, width: width),
      );
}
