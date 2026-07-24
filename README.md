# Barkath — Multi-category e-commerce ecosystem

Premium multi-category commerce (perfumes, books, clothing, Islamic essentials). **India-only, INR.**

Three clients + one shared Firebase backend, one Firebase project (`barkath-prod`).

## Monorepo layout

```
barkath/
├── admin/            # Enterprise admin panel — React 18 + Vite + TS
├── web/              # Customer website — Next.js 14 (App Router) + TS   [placeholder]
├── app/              # Customer app — Flutter (Provider)                 [placeholder]
├── packages/
│   └── shared/       # Cross-TS-client contracts: collections, enums, types, money, keywordsBuilder
├── functions/        # Cloud Functions v2 (Node 20, TS) — the trust boundary
└── firebase/         # firestore.rules, firestore.indexes.json, storage.rules
```

`app/` (Flutter) consumes the same Firestore/Functions contract but is not a pnpm workspace member — it re-expresses the shared enums/collections in Dart.

## Ground rules (from the specs — do not drift)

- **Brand spelling: `Barkath`** everywhere. Never "Barakath".
- **Money:** integer **paise**, field names end in `Paise`. Never floats, never rupees in storage.
- **Time:** Firestore `Timestamp` + `serverTimestamp()`. Business tz = `Asia/Kolkata`.
- **ID invariant:** every doc has an `id` field equal to its Firestore doc ID.
- **Trust boundary:** money / privileged / cross-user writes go through authenticated Cloud Functions only. Clients never write `orders`, `payments`, `walletTransactions`, `commissions`, `withdrawalRequests`, `coupons` (global), `spinHistory`, `orderRequests`, `reviews`.
- **Returns only** — no "Replacement" feature (project correction). `orderRequests.type = 'return'`.
- **Pagination:** cursor-based, 25/page (web "Load more", app infinite scroll, admin "Load more").
- **Search:** Firestore-native prefix n-gram `searchIndex` arrays. No Algolia.
- **Order statuses:** `accepted · packing · packed · shipped · out_for_delivery · delivered · cancelled`.
- **Mobile bottom nav (exactly 5):** Home · Category · Bag · Wallet · Profile.
- **COD** is a first-class payment method (checkout radio + admin reconciliation).

## Design tokens (token → hex contract, all clients implement identically)

| Token | Hex | Meaning |
|---|---|---|
| green | #059669 | Primary brand — CTAs, active, positive |
| amber | #F59E0B | Money / reward — prices, wallet, spin, affiliate |
| blue | #0EA5E9 | Informational — in-transit |
| red | #F44559 | Destructive — cancelled, delete, error |
| gray | #6B7280 | Neutral / muted |
| brownDark | #2A1F10 | Immersive — Spin & Win, affiliate hero |

Two admin-picked hex exceptions (stored as raw hex, not tokens): `categories.categoryTint`, `settings/variables` Color unit `hex`.

## Getting started

```bash
pnpm install
pnpm --filter @barkath/shared build
# emulators
firebase emulators:start
```

See `firebase/` for rules & indexes, `packages/shared/` for the contract, `functions/` for server logic.
