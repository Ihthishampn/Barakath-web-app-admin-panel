# Barkath — Customer App

Flutter mobile client (India-only, INR). Shares one Firebase backend
(**barkath-25607**) with the admin panel and web storefront. Not a pnpm
workspace member (kept out of `pnpm-workspace.yaml`).

## Status — Part 0 (Foundation) ✅

- **Stack:** Flutter 3.44 / Dart 3.12, `provider` + `go_router`, Firebase
  (core/auth/firestore/storage), `google_fonts`, `intl`.
- **Design system** (`lib/core/theme/`): colours, typography (Inter), spacing,
  radii, assembled `ThemeData` — all from spec §1.
- **Core widgets** (`lib/core/widgets/`): `AppButton` (7 variants),
  `AppTextField`, `AppChip`, `AppToggle`, `AppQuantityStepper`,
  `AppCircleIconButton`, `AppIconTile`, `AppMedallion`, `AppCouponCodeChip`,
  `AppDialog`, `AppBottomSheet`, `AppToast`, `AppShimmer`, `AppErrorState`,
  `AppEmptyState`, `AppBottomNavBar`.
- **Shell + routing** (`lib/core/router/`, `lib/features/shell/`): 5-tab
  bottom-nav `StatefulShellRoute` (Home · Category · Bag · Wallet · Profile),
  auth + affiliate guard scaffolding, path constants.
- **Services:** `AuthProvider` (Firebase auth state + affiliate claim).

Subsequent parts (1–8) replace the placeholder screens with real UI + logic,
built against Figma per part.

## Run

```bash
export PATH="$HOME/flutter/bin:$PATH"
cd app
flutter pub get
flutter analyze          # → No issues found
flutter test             # → money-format unit tests pass
flutter run              # needs `flutterfire configure` first (see below)
```

## Before running on a device

`lib/firebase_options.dart` reuses the web appId as a placeholder. Register the
Android/iOS apps for **barkath-25607** (or run `flutterfire configure`) to mint
platform appIds + `google-services.json` / `GoogleService-Info.plist`.

Auth is gated behind `kEnforceAuth` (in `app_router.dart`), currently `false` so
the shell is browsable before the OTP screens land in Part 1. Part 1 flips it on.
