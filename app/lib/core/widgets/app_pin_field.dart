import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

/// 6-box OTP input — spec §1.6 / screen 06.
/// Filled boxes show the digit with a default border; the next box to fill has
/// a green 2px border. Error state paints all boxes red. Backed by one hidden
/// field so paste + keyboard behave normally.
class AppPinField extends StatefulWidget {
  const AppPinField({
    super.key,
    this.length = 6,
    this.onChanged,
    this.onCompleted,
    this.hasError = false,
    this.autofocus = true,
  });

  final int length;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onCompleted;
  final bool hasError;
  final bool autofocus;

  @override
  State<AppPinField> createState() => AppPinFieldState();
}

class AppPinFieldState extends State<AppPinField> {
  final _controller = TextEditingController();
  final _focus = FocusNode();

  void clear() {
    _controller.clear();
    setState(() {});
  }

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final text = _controller.text;
    return Stack(
      children: [
        // Hidden input that actually holds the value.
        Opacity(
          opacity: 0,
          child: TextField(
            controller: _controller,
            focusNode: _focus,
            autofocus: widget.autofocus,
            keyboardType: TextInputType.number,
            maxLength: widget.length,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            onChanged: (v) {
              setState(() {});
              widget.onChanged?.call(v);
              if (v.length == widget.length) widget.onCompleted?.call(v);
            },
          ),
        ),
        GestureDetector(
          onTap: () => _focus.requestFocus(),
          child: Row(
            children: [
              for (var i = 0; i < widget.length; i++) ...[
                if (i > 0) const SizedBox(width: AppSpacing.x12),
                Expanded(child: _box(i, text)),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _box(int i, String text) {
    final filled = i < text.length;
    final isActive = i == text.length && _focus.hasFocus;
    final Color border;
    double width = 1;
    if (widget.hasError) {
      border = AppColors.destructiveRed;
      width = 2;
    } else if (isActive) {
      border = AppColors.brandGreen;
      width = 2;
    } else {
      border = AppColors.borderSubtle;
    }
    return AspectRatio(
      aspectRatio: 1,
      child: Container(
        constraints: const BoxConstraints(maxHeight: 52),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(AppRadii.field),
          border: Border.all(color: border, width: width),
        ),
        child: Text(
          filled ? text[i] : '',
          style: AppType.headingLarge.copyWith(
            fontWeight: FontWeight.w800,
            fontSize: 26,
            color: AppColors.textPrimary,
          ),
        ),
      ),
    );
  }
}
