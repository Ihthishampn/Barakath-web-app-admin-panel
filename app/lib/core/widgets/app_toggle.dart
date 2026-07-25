import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// Green-when-ON switch — spec §1.6 / §14.
class AppToggle extends StatelessWidget {
  const AppToggle({super.key, required this.value, this.onChanged});

  final bool value;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    return Switch(
      value: value,
      onChanged: onChanged,
      activeThumbColor: Colors.white,
      activeTrackColor: AppColors.brandGreen,
      inactiveThumbColor: Colors.white,
      inactiveTrackColor: const Color(0xFFCBD5E1),
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
    );
  }
}
