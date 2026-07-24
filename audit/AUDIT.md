# Barkath audit — 110 confirmed of 180 raw (70 refuted)

Severity: {'critical': 16, 'high': 48, 'medium': 43, 'low': 3}

## [CRITICAL][incomplete] Approved return refunds the customer but never reverses the affiliate commission that delivery already confirmed
**functions/src/returns/decisions.ts:116** (area: admin-orders)

functions/src/orders/status.ts:98-101 calls confirmCommissionsForOrder(orderId) the moment an order reaches 'delivered', which moves the commission row to status 'confirmed' and increments affiliate.confirmedBalancePaise — the withdrawable balance (commissions.ts:128-133). The docblock at functions/src/affiliate/commissions.ts:11-14 justifies clearing at delivery on the grounds that "Returns are handled by the return flow". They are not: adminApproveOrderRequest (decisions.ts) contains zero references to 'commission' or 'affiliate' (grep -i returns nothing in the whole file). Its order write at line 116-122 only touches refundedPaise / paymentStatus / items[].returnStatus. Only performCancellation (cancel.ts:73-75) reverses commissions, and it deliberately skips rows that are no longer 'pending' — and cancellation is impossible after delivery anyway (TRANSITIONS.delivered = []). So once an order is delivered there is no code path anywhere that can claw a commission back.

**Failure:** Customer C was referred by affiliate A (5% rate). C places a Rs 10,000 order -> commissions doc created with commissionPaise=50000, A.pendingBalancePaise +50000. Admin marks the order 'delivered' -> row becomes 'confirmed', A.confirmedBalancePaise +50000, lifetimeEarningsPaise +50000. C returns the goods; admin approves the return, Rs 10,000 is refunded to C's wallet. The commission row stays 'confirmed' and A withdraws Rs 500 of real money on a fully refunded order. Repeatable at will by a colluding referrer/customer pair.

**Fix:** In adminApproveOrderRequest's transaction (or a helper mirroring cancel.ts:129-143), read the commissions rows for r.orderId up front and, for the refunded proportion, decrement affiliate.confirmedBalancePaise + lifetimeEarningsPaise and mark the row 'cancelled' (or write a negative clawback row when the balance has already been withdrawn). Alternatively delay confirmation past the return window instead of clearing at delivery.

---

## [CRITICAL][dead-button] Affiliate toggle on both customer screens always fails — the callable requires commissionRate that the client never sends
**admin/src/features/customers/api/customers.ts:59** (area: admin-customers)

setAffiliateEnabled() calls httpsCallable('adminAllocateAffiliate') with the payload `{ uid }` only (customers.ts:57-60). The callable's zod schema in functions/src/affiliate/withdrawals.ts:20 is `z.object({ uid: z.string().min(1), commissionRate: z.number().nonnegative(), walletEnabled: z.boolean().optional() })` — `commissionRate` is REQUIRED, not optional. safeParse therefore fails and line 22 throws HttpsError('invalid-argument','Invalid payload.'). The other caller, admin/src/features/affiliate/api/affiliate.ts:63, does send commissionRate, so only the customers-module toggle is broken. The revoke direction ('adminRevokeAffiliate') parses `{ uid }` only and works, so the toggle is one-way-broken.

**Failure:** Admin opens Customers list (or a customer profile) and flips the Affiliate toggle ON for Yusuf Ali. The CF rejects with invalid-argument; the UI shows the cfError toast, `customer.affiliate` is never created, no referral code is allocated, and the toggle snaps back. Affiliate access can only ever be granted from the separate Allocate Affiliate page.

**Fix:** Either send a rate from the customers screens (e.g. `call({ uid, commissionRate: settings.defaultCommissionRate })`) or make the CF field optional with a server-side default: `commissionRate: z.number().nonnegative().optional()` and `const rate = normalise(parsed.data.commissionRate ?? DEFAULT_RATE)` — while preserving an existing affiliate's rate on re-enable.

---

## [CRITICAL][cross-surface-mismatch] autoBestOffer reads promo-coupon field names the admin never writes, so the percent cap, min-cart and expiry are all silently unenforced on real money
**functions/src/orders/checkout.ts:228** (area: admin-growth)

`placeOrder` calls `autoBestOffer` whenever the client sends no coupon code (checkout.ts:349). For promotional `coupons` docs it reads `c.minOrderPaise` (line 228), `c.maxDiscountPaise` (line 233), `c.expiresAt` (line 226-227) and `c.noExpiry`. The admin writer (admin/src/features/coupons/api/coupons.ts:120-138) writes `minCartValuePaise`, `discountMaxCapPaise` and `validUntil`, and never writes `expiresAt`, `noExpiry`, `minOrderPaise`, `maxDiscountPaise` or `autoApply`. Every one of those reads is therefore `undefined`, so `Number(undefined ?? 0) === 0` disables the check. The sibling `computeCouponDiscount` (lines 143/172/140) uses the correct names — the bug is isolated to the auto-apply path. Note the code-comment at checkout.ts:131 says this class of mismatch was already fixed once for computeCouponDiscount; autoBestOffer was missed.

**Failure:** Admin creates coupon SAVE25: percent, 25%, Max discount ₹200 (discountPercent=25, discountMaxCapPaise=20000), Min cart ₹1500, targetUsers 'all'. A customer checks out a ₹10,000 cart with no coupon code. autoBestOffer sees minOrderPaise=undefined→0 (min cart bypassed) and maxDiscountPaise=undefined→0 (cap skipped), so it grants Math.round(1000000*25/100) = ₹2,500 instead of the capped ₹200. The order is written and charged with a ₹2,300 over-discount. The same undefined `expiresAt` means a coupon that expired hours ago (status still 'active' until the next 00:15 IST sweep) is still auto-applied.

**Fix:** In autoBestOffer read the same fields computeCouponDiscount does: `c.minCartValuePaise`, `c.discountMaxCapPaise`, `c.validUntil` (plus `validFrom`), and drop `noExpiry`/`minOrderPaise`/`maxDiscountPaise`. Better: extract one shared `evaluatePromoCoupon(c, subtotal)` helper used by both paths so they cannot drift again.

---

## [CRITICAL][cross-surface-mismatch] Web checkout offer list uses the same wrong coupon field names, so it auto-applies coupons that placeOrder then rejects
**web/src/components/checkout/offers.ts:42** (area: admin-growth)

`PromoCoupon` (lines 20-34) declares `minOrderPaise`, `maxDiscountPaise`, `expiresAt`, `noExpiry` — none of which admin/src/features/coupons/api/coupons.ts writes. `promoDiscount` (line 42) therefore treats every promo coupon as min-cart-₹0, (line 47) uncapped, and (line 41) never expired. `listAvailableOffers` repeats it at lines 114-115 and `promoHeadline` at line 84 hides the cap. checkout/page.tsx:90 auto-applies `bestOfferForCart` into the draft and page.tsx:99 renders the list, while `placeOrder` re-validates with the CORRECT field names (checkout.ts:143/172) and throws HttpsError on mismatch.

**Failure:** Coupon SAVE25 = 25% off, max ₹200, min cart ₹1500. Customer with a ₹500 cart opens /checkout: the offer renders as "25% off · On any order", qualifies=true, and is auto-applied showing a ₹125 discount. They press Pay and placeOrder throws 'Your cart does not meet this coupon's minimum' — checkout is hard-blocked and nothing in the UI explains why. On a ₹10,000 cart the page shows a ₹2,500 discount but the server caps it at ₹200, so the amount charged is ₹2,300 more than the total displayed a moment earlier.

**Fix:** Change PromoCoupon to `minCartValuePaise`, `discountMaxCapPaise`, `validUntil` and update promoDiscount/listAvailableOffers/promoHeadline accordingly (the Flutter app already reads both names defensively — see app/lib/features/checkout/data/offers.dart:55-56,65). Ideally type it as the shared `Coupon` instead of a hand-rolled loose interface.

---

## [CRITICAL][cross-surface-mismatch] Web banner query filters placement == 'web' but the enum value and every writer use 'website', so no admin banner ever appears on the storefront
**web/src/lib/banners.ts:20** (area: admin-growth)

`useWebBanners` queries `where('placement','==','web')`. The canonical enum is `BANNER_PLACEMENTS = ['app','website']` (packages/shared/src/enums.ts:207), the seed writes 'app'/'website' (scripts/seed.ts:783-788), and the admin writes `placement: placementRef.current` which is only ever 'app' or a value loaded from an existing doc (admin/src/features/banner/routes/BannerFormPage.tsx:41,66,129). Nothing in the repo ever writes the literal 'web', so the query returns an empty set permanently. The Flutter app uses the correct literal ('app', app/lib/features/catalog/data/catalog_repository.dart:100).

**Failure:** Admin uploads a hero banner, sets Publish live, saves. The seeded 'website' banner also exists. Load the storefront home page: `banners.length === 0` at web/src/app/(shop)/page.tsx:48, so the hardcoded gradient fallback hero renders forever and HeroBanner is dead code. No error is shown, so the admin believes the banner is live.

**Fix:** Change web/src/lib/banners.ts:20 to `where('placement','==','website')` (matching BANNER_PLACEMENTS), or better, import the enum constant rather than a string literal.

---

## [CRITICAL][dead-button] Customers-page "affiliate" toggle always fails: adminAllocateAffiliate is called without the required commissionRate
**admin/src/features/customers/api/customers.ts:59** (area: admin-affiliate)

`setAffiliateEnabled(uid, true)` invokes the `adminAllocateAffiliate` callable with `await call({ uid })` — no `commissionRate`. The callable's zod schema at functions/src/affiliate/withdrawals.ts:19-22 is `z.object({ uid: z.string().min(1), commissionRate: z.number().nonnegative(), walletEnabled: z.boolean().optional() })` and `safeParse` failure throws `HttpsError('invalid-argument', 'Invalid payload.')`. `commissionRate` is NOT optional, so every enable-side call is rejected server-side before touching Firestore. Two admin surfaces use this helper: CustomersListPage.tsx:54 (`onToggleAffiliate`) and CustomerProfilePage.tsx:62. Only the revoke branch (`adminRevokeAffiliate`, schema `{ uid }`) actually works. The only working grant path is AllocateAffiliatePage.tsx:55, which passes `commissionRate: Number(rate)`.

**Failure:** Admin opens Customers → clicks the affiliate toggle on a non-affiliate customer. The callable rejects with invalid-argument; `cfError` renders "Couldn't enable affiliate". The customer is never granted `affiliate.enabled`, no referral code is minted, and no commission can ever accrue for them. Toggling OFF an existing affiliate works, so the control looks half-broken (one-way).

**Fix:** Pass a rate: `await call(enabled ? { uid, commissionRate: DEFAULT_RATE } : { uid })` (or prompt for the rate), or make `commissionRate` optional in the callable schema and default it server-side (e.g. `settings/affiliate.defaultCommissionRate`) when omitted.

---

## [CRITICAL][crash-risk] Auth listener has no error path — a failed admins-doc read locks the whole panel on a permanent spinner
**admin/src/stores/../features/auth/stores/authStore.ts:33** (area: admin-settings-auth)

`initAuthListener` does `const admin = await loadAdminDoc(user.uid)` with no try/catch, and `useAuthStore.setState({..., ready: true})` is only reached after that await resolves. `loadAdminDoc` (admin/src/features/auth/api/auth.ts:54) does `getDoc(doc(db,'admins',uid))`, and firebase/firestore.rules:190 only permits that read when the caller's token carries `role == 'super_admin'` or `role == 'sub_admin' && uid == adminUid`. Any signed-in Firebase user without an admin role claim therefore gets a `permission-denied` rejection, the async callback rejects unhandled, `ready` stays `false` forever, and RequireAuth (admin/src/features/auth/RequireAuth.tsx:10) renders the full-screen spinner with no logout affordance. The same unguarded read exists on the login path (auth.ts:39) — it sits OUTSIDE the try/catch that wraps signInWithEmailAndPassword, and unlike the `!snap.exists()` branch at line 41 it never calls `fbSignOut`, so the failed sign-in leaves a live persisted Firebase session behind.

**Failure:** A Firebase Auth account exists without admin claims — e.g. `createSubAdmin` (functions/src/admin/subAdmins.ts:34-38) succeeds at `auth.createUser` but throws at `setCustomUserClaims`, leaving an orphan account, or someone signs in at /login with any non-admin email/password account. Login shows a generic 'Could not sign in.' toast but the session persists. On the next visit/reload of the admin panel, onAuthStateChanged fires with that user, loadAdminDoc rejects with permission-denied, `ready` is never set, and the panel shows the boot spinner forever on every reload. There is no UI to sign out of that state.

**Fix:** Wrap the listener body in try/catch (and the getDoc in `signInAdmin`): on any error set `{admin: null, ready: true}` and call `signOutAdmin()` so the user lands back on /login instead of an unrecoverable spinner.

---

## [CRITICAL][broken-crud] OTP verify calls registerUser on every login; the `users/{phoneKey}` rule forbids updates, so every returning user is stuck on the OTP screen
**app/lib/features/auth/otp_screen.dart:102** (area: app-auth-profile)

`_verify()` unconditionally runs `await repo.registerUser(e164)` after a successful verification. `AuthRepository.registerUser` (app/lib/features/auth/data/auth_repository.dart:116) does `_db.doc('users/${digits}').set({...}, SetOptions(merge: true))`. On a doc that already exists, a merge-set is evaluated as an **update** by security rules, and firebase/firestore.rules:185 says `allow update, delete: if false;` (only `create` is allowed, line 184). So the write throws PERMISSION_DENIED, which is caught by the `catch (_)` at otp_screen.dart:106 -> the screen shows "Couldn't verify the code. Please try again." and never navigates. The web deliberately avoids this: web/src/components/auth/authActions.ts:89 calls `registerUser` only `if (mode === 'signup')`.

**Failure:** Customer registers once (users/919876543210 created). Next day they open the app, enter the same number, enter the correct dev OTP. Firebase sign-in succeeds, ensureCustomerDoc succeeds, then registerUser is denied -> error toast, still on the OTP screen. Tapping "Verify & continue" again now fails with "Incorrect code" because `_pending.remove(e164)` (auth_repository.dart:80) already consumed the code, and each resend repeats the same denial. The only escape is force-quitting the app so Splash restores the (already valid) session.

**Fix:** Only write the directory entry for a first-time registration: check `await repo.userExists(e164)` (or the `snap.exists` result already fetched in ensureCustomerDoc) and skip registerUser for existing numbers, and/or move it out of the navigation try-block so a directory failure can never block sign-in.

---

## [CRITICAL][cross-surface-mismatch] Quick-add "+" on the product card drops the variant, producing a cart line the checkout function always rejects as out of stock
**app/lib/core/widgets/product_card.dart:306** (area: app-catalog)

`_AddButton.onTap` calls `cart.addProduct(product)` with no `variant:` argument. `CartLine.fromProduct` (app/lib/features/cart/data/cart_line.dart:70-81) then writes `variantId: null` and `pricePaise: p.sellingPaise`. The gating above it (`if (!product.inStock)`, line 284) uses `Product.inStock` (app/lib/features/catalog/data/product.dart:87), which for `hasVariants` products returns true from `variants.any((v) => v.inStock)` — i.e. the button is enabled precisely for variant products whose stock lives on the variants. But `functions/src/orders/checkout.ts:431-443` branches on `l.variantId`: with a null variantId it falls to `if (Number(p.stock ?? 0) < l.qty) throw HttpsError('failed-precondition', `${l.name} is out of stock.`)`. Product-level `stock` is 0 for every variant product — admin writes `stock: 0` on create (admin/src/features/products/api/products.ts:146), admin inventory adjusts only the `variants[]` entries (functions/src/catalog/inventory.ts:76-83), and the seed sets `stock: hasVar ? 0 : ...` (scripts/seed.ts:360). The web card does this correctly: `variantId: product.variants?.[0]?.id ?? null` (web/src/components/product/ProductCard.tsx:32).

**Failure:** Customer opens Home, taps "+" on a perfume that has 50ml/100ml variants (variant stock 10, product-level stock 0). A line `{productId:'p1', variantId:null, pricePaise:<variant-0 price>}` is written into the shared `customers/{uid}.cart` array. The bag shows the item with no size label. At checkout the `placeOrder` callable throws `failed-precondition: "<name> is out of stock."` and the ENTIRE order fails — no combination of retries can clear it, because the customer cannot see or edit the missing variantId. The same product added from the web produces `variantId:'v0'`, so the two clients also create two duplicate lines for the same product.

**Fix:** In `_AddButton.onTap`, resolve a variant before adding: `final v = product.hasVariants ? product.variants.firstWhereOrNull((x) => x.inStock) : null; cart.addProduct(product, variant: v);` — mirroring web ProductCard.tsx:32. Better still, for `hasVariants` products navigate to the details screen so the customer picks the size explicitly.

---

## [CRITICAL][cross-surface-mismatch] offers.ts reads coupon fields that nothing ever writes (minOrderPaise / maxDiscountPaise / expiresAt), so every promo constraint is ignored on the web
**web/src/components/checkout/offers.ts:42** (area: web-catalog-cart)

promoDiscount() gates on `c.minOrderPaise` (line 42), caps with `c.maxDiscountPaise` (line 47) and expires on `c.expiresAt`/`c.noExpiry` (lines 40-41). The only writers of the `coupons` collection are admin/src/features/coupons/api/coupons.ts (lines 126-135) and scripts/seed.ts (lines 715-725), and both write `minCartValuePaise`, `discountMaxCapPaise` and `validUntil`. `minOrderPaise`, `maxDiscountPaise`, `expiresAt`, `noExpiry` and `autoApply` do not exist on any coupon doc, so `Number(undefined ?? 0)` = 0 → the minimum always passes, the percent cap is never applied, and expired coupons never drop out. listAvailableOffers (lines 115-123) has the same bug, so it marks every promo `qualifies: true`. The authoritative server path computeCouponDiscount() (functions/src/orders/checkout.ts:143-174) reads the correct names and enforces all three.

**Failure:** Seeded promo WELCOME30 (flat ₹30, minCartValuePaise ₹150). Customer's cart is ₹100. Checkout auto-applies it (offers.ts sees min 0) and shows −₹30. Pressing "Place order" calls placeOrder with couponCode 'WELCOME30' → computeCouponDiscount throws 'Your cart does not meet this coupon's minimum.' The order can never be placed until the user notices the Remove link. Cap case: admin coupon 15% off, discountMaxCapPaise ₹200, cart ₹5000 → web shows −₹750 / "To pay ₹4250", server caps at ₹200 and charges ₹4800.

**Fix:** Rename the reads in promoDiscount/listAvailableOffers/promoHeadline to the fields the admin actually writes: `minCartValuePaise`, `discountMaxCapPaise`, `validFrom`/`validUntil` (and drop `noExpiry`/`autoApply`, or add them to the admin writer). Same rename is needed in functions/src/orders/checkout.ts autoBestOffer(), which has the identical wrong names.

---

## [CRITICAL][cross-surface-mismatch] computeSummary has no free_shipping waiver, so the web total diverges from summarise() for any free-delivery coupon
**web/src/components/checkout/checkout.ts:105** (area: web-catalog-cart)

Server summarise() takes a `waiveDelivery` flag (functions/src/orders/checkout.ts:280) and computes `freeDelivery = waiveDelivery || subtotal<=0 || net>=threshold` (line 286); computeCouponDiscount sets it for `discountType === 'free_shipping'` (lines 165, 202) while returning discountPaise 0. Web computeSummary (line 105) only knows the threshold rule and has no waiveDelivery input at all — nor does AppliedCoupon (lines 69-73) carry the flag, and callApplyCoupon (line 183) only returns `{discountPaise, label}`, so the free_shipping signal is dropped end to end. free_shipping coupons exist in both `coupons` (seed.ts:704 'FREESHIP') and personal spin coupons (functions/src/spin/execute.ts:126).

**Failure:** Delivery settings: standardFeePaise ₹49, freeDeliveryOverPaise ₹999. Cart ₹500. Customer types FREESHIP → applyCoupon returns discountPaise 0, web shows "FREESHIP applied −₹0.00", Delivery ₹49, To pay ₹549. placeOrder waives delivery and charges ₹500 (and the Razorpay modal opens for ₹500, not the ₹549 just shown).

**Fix:** Return the coupon's discountType (or a waiveDelivery boolean) from applyCoupon, store it on AppliedCoupon, and add a `waiveDelivery` term to computeSummary's freeDelivery expression so it mirrors summarise() exactly.

---

## [CRITICAL][broken-crud] Checkout clears the idempotency nonce before payment finishes, so any Razorpay failure/cancel + retry places a second order
**web/src/app/(shop)/checkout/page.tsx:180** (area: web-catalog-cart)

placeOrder() sets `nonceRef.current = null` immediately after callPlaceOrder resolves (line 180), before createRazorpayOrder / openRazorpayCheckout / verifyPayment. Every failure branch after that point (throw at line 184 → catch at 215, dismissal at 193, unverified at 204) leaves the cart unchanged (`clear()` only runs at line 213) and leaves the CTA enabled. The next click generates a fresh crypto.randomUUID() (line 167), so the server's idempotencyKeys guard (functions/src/orders/checkout.ts:370-390) sees a brand-new key and places a whole new order.

**Failure:** Wallet ₹500, cart ₹1200, Razorpay selected with useWallet on. Order placed → wallet debited ₹500, stock decremented. checkout.razorpay.com fails to load → openRazorpayCheckout throws 'razorpay-script-failed' → toast. User clicks "Place order" again → second order created, wallet debited another ₹500 (or as much as remains), stock decremented twice, two pending orders under My orders.

**Fix:** Only null the nonce on the success path (right before `clear()`), so every retry of the same attempt reuses the same placementNonce and the server returns the already-placed order instead of creating another.

---

## [CRITICAL][cross-surface-mismatch] Web return window is admin-configurable but the Cloud Function hardcodes 3 days, so in-window requests are rejected
**web/src/components/account/orders.ts:261** (area: web-orders-returns-reviews)

`returnWindow()` computes eligibility from `settings/returns.windowDays` (default `DEFAULT_RETURN_WINDOW_DAYS = 7`, line 246) measured from `order.deliveredAt ?? order.placedAt` (line 263). The server, `functions/src/returns/requests.ts:42-46`, ignores `settings/returns` entirely: `const RETURN_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;` and additionally hard-requires `o.deliveredAt` (`if (!deliveredAtMs || Date.now() - deliveredAtMs > RETURN_WINDOW_MS) throw ...`). scripts/seed.ts:208 seeds `windowDays: 7` and admin/src/features/settings/routes/StorefrontTab.tsx:279 defaults the field to 7, so the shipped configuration is guaranteed to disagree with the server. The Flutter app (app/lib/features/orders/data/order.dart:202 `returnWindowDays = 3`) matches the CF; only web is the outlier.

**Failure:** Order delivered 5 days ago, `settings/returns.windowDays = 7` (the seeded/default value). The order detail page renders an enabled "Return item · 2 days left" button, the return page renders the full form, the customer picks a reason and submits -> requestReturnOrReplacement throws `failed-precondition: The 3-day return window for this order has closed.` -> the UI shows the generic "We couldn't submit your return just now. Please try again." and the customer retries indefinitely. Same failure for any delivered order whose `deliveredAt` is absent (legacy orders), where web falls back to `placedAt` and the CF hard-fails.

**Fix:** Make the CF read `settings/returns.windowDays` (falling back to 7) instead of the hardcoded `RETURN_WINDOW_MS`, and apply the same `deliveredAt ?? placedAt` fallback the web/app clients use — or, if 3 days is authoritative, drop the settings-driven `returnWindow()` on web and read the same constant.

---

## [CRITICAL][cross-surface-mismatch] autoBestOffer reads promotional-coupon field names that nothing ever writes, so minimum-cart, percent cap and expiry are all silently unenforced on auto-applied coupons
**functions/src/orders/checkout.ts:228** (area: backend-functions)

`autoBestOffer` (checkout.ts:215-259) evaluates docs from the top-level `coupons` collection using `c.minOrderPaise` (line 228), `c.maxDiscountPaise` (line 233), `c.expiresAt` (line 226), `c.noExpiry` (line 227) and `c.autoApply` (line 225). The only writer of that collection is `admin/src/features/coupons/api/coupons.ts:120-152` (`saveCoupon`), which writes `minCartValuePaise`, `discountMaxCapPaise`, `validUntil`, `active`, `status`, `maxUsesTotal`, `maxUsesPerUser`, `firstOrderOnly` — and never writes `minOrderPaise`, `maxDiscountPaise`, `expiresAt`, `noExpiry` or `autoApply`. Every one of those reads therefore resolves to `undefined` and the guard collapses to `Number(undefined ?? 0) === 0`. The sibling function in the same file, `computeCouponDiscount` (lines 143, 173, 140), reads the correct names, so the two code paths for the same collection disagree. `autoBestOffer` additionally never checks `maxUsesTotal`, `maxUsesPerUser`, `firstOrderOnly` or `usesCount` at all, yet placeOrder still increments the redemption counters at lines 604-614 — so the counters climb while the limits never bind.

**Failure:** Admin creates coupon MEGA20 = 20% off, `discountMaxCapPaise` = 20000 (₹200 cap), `minCartValuePaise` = 500000 (₹5,000 minimum), `maxUsesPerUser` = 1, `targetUsers` = 'all'. A customer checks out with a ₹50,000 cart and enters NO coupon code. placeOrder (line 349) falls through to `autoBestOffer`, which reads `minOrderPaise` → undefined → 0 (minimum skipped) and `maxDiscountPaise` → undefined → 0 → `cap > 0` false → cap skipped. Discount = ₹10,000 instead of the intended ₹200. The same customer repeats it on every subsequent order because the per-user limit is never consulted on this path. A ₹100 cart likewise auto-receives a coupon whose ₹5,000 minimum it does not meet.

**Fix:** In `autoBestOffer`, read the same field names `computeCouponDiscount` uses: `minCartValuePaise`, `discountMaxCapPaise`, `validUntil` (with `validFrom`), and drop `noExpiry`/`autoApply`/`minOrderPaise`/`maxDiscountPaise`. Better: have `autoBestOffer` build its candidate list by delegating each candidate to the same validation helper as `computeCouponDiscount` (catching the HttpsError to mean 'does not qualify'), so the two paths cannot drift again, and include the `maxUsesTotal` / `maxUsesPerUser` / `firstOrderOnly` checks.

---

## [CRITICAL][security] Any signed-in customer can read every other customer's invoice, and invoice filenames are sequential
**firebase/storage.rules:20** (area: backend-rules-indexes)

`match /invoices/{fileName} { allow read: if request.auth != null; ... }` grants read on the whole invoices prefix to every authenticated user, with no ownership check. The object name is fully predictable: functions/src/orders/invoice.ts:54 writes ``const path = `invoices/${o.shortId ?? parsed.data.orderId}.html`;`` and shortId is a monotonically increasing counter value — functions/src/orders/checkout.ts:422-425 reads `counters/orders` and builds ``const shortId = `#BRK-${seq}`;``. The rendered HTML (functions/src/orders/invoice.ts:43+) contains the buyer's name, full delivery address, phone, line items and totals. Clients never actually need this rule: the CF hands back a tokenised `https://firebasestorage.googleapis.com/...?alt=media&token=...` download URL (invoice.ts:61) which bypasses rules entirely, so the permissive read grant buys nothing.

**Failure:** Customer A signs in (any real account) and calls `getDownloadURL(ref(storage, 'invoices/#BRK-1041.html'))`, then 1042, 1043 … Because shortIds are sequential and the rule only checks `request.auth != null`, A downloads every other customer's invoice — name, phone, home address, and purchase history for the entire store.

**Fix:** Deny direct client reads on `invoices/**` (`allow read: if false`) and keep serving the tokenised download URL the CF already returns; or, if direct reads are wanted, store invoices under `invoices/{uid}/{orderId}.html` and gate on `request.auth.uid == uid`.

---

## [CRITICAL][cross-surface-mismatch] Server auto-apply reads promo-coupon fields the admin never writes (minOrderPaise/expiresAt/maxDiscountPaise)
**functions/src/orders/checkout.ts:228** (area: cross-surface-shapes)

`autoBestOffer()` (lines 221-238) — the path `placeOrder` takes whenever the client sends no explicit `couponCode` — reads promotional `coupons` docs using `c.minOrderPaise`, `c.expiresAt`, `c.maxDiscountPaise` and `c.discountValue`. The only writer of that collection, `admin/src/features/coupons/api/coupons.ts` `saveCoupon()`, writes `minCartValuePaise`, `validUntil`, `discountMaxCapPaise`, `discountValuePaise`/`discountPercent`. Every guard therefore reads `undefined`: `minOrderPaise ?? 0` → the minimum-cart rule is skipped, `expiresAt` is never set → the expiry check is skipped (`validUntil` is what the sweep in functions/src/scheduled/sweeps.ts:37 uses, and that sweep only runs daily so `status` is stale for up to 24h), and `maxDiscountPaise ?? 0` → the percent cap is never applied. The explicit-code path (`computeCouponDiscount`, lines 143/140/172) uses the correct names, so only the auto-apply path is wrong. `autoBestOffer` also never checks `maxUsesPerUser`/`maxUsesTotal`/`firstOrderOnly` even though placeOrder still increments the counters at lines 604-613.

**Failure:** Admin creates SAVE50: 50% off, discountMaxCapPaise = ₹200, minCartValuePaise = ₹5,000, validUntil = yesterday (status still 'active' because the daily sweep hasn't run). A customer checks out a ₹1,000 cart with no coupon entered. autoBestOffer sees minOrderPaise=undefined→0 (min ignored), expiresAt=undefined (expiry ignored), maxDiscountPaise=undefined→0 (cap ignored) and applies ₹500 off. The order is placed at ₹500 instead of ₹1,000 and coupons/{id}.usesCount is incremented for an expired, unqualified coupon.

**Fix:** In `autoBestOffer` read the same field names `computeCouponDiscount` uses: `minCartValuePaise`, `validUntil` (null = no expiry), `discountMaxCapPaise`, `discountValuePaise`. Also run the same `maxUsesTotal`/`maxUsesPerUser`/`firstOrderOnly` guards before auto-applying, or factor both paths through one shared validator.

---

## [HIGH][cross-surface-mismatch] publishedAt is never stamped when a product goes draft → published, so "New arrivals" is broken for the create-draft-then-publish workflow
**admin/src/features/products/api/products.ts:165** (area: admin-catalog)

Both storefronts derive New Arrivals from publishedAt: web/src/lib/catalog.ts:43-56 (`liveAtMillis` = publishedAt ?? createdAt, window = 3 days) and app/lib/features/catalog/data/product.dart:120-124 (same fallback). The only writes to publishedAt in the whole repo are products.ts:160 (`serverTimestamp()` at create, regardless of the chosen status), products.ts:209 (duplicate → null) and products.ts:294 (CSV import → null). `grep -rn publishedAt admin/src functions/src` shows no other writer. The edit path (`updateDoc(doc(db,'products',values.id), base)` at line 165) writes `base`, which contains `status` but no `publishedAt`, and `setProductArchived` (line 52) flips status to 'published' without touching it either. So flipping status from draft to published never moves publishedAt.

**Failure:** Admin creates a product on 1 Jul with Status = Draft (publishedAt = 1 Jul). Photos and copy are finished on 20 Jul and the admin sets Status = Published and saves. publishedAt stays 1 Jul, so `isNewArrival` is false immediately and the product never appears in the web home "New arrivals" rail or the app's newArrivals list. Same for CSV-imported products (publishedAt null → falls back to the import-day createdAt).

**Fix:** In `saveProduct`, when `!isNew` and the status is transitioning to 'published' while the stored doc's publishedAt is null or the stored status was not 'published', include `publishedAt: serverTimestamp()` in the update (the form already holds `existingRef.current`). Do the same in `setProductArchived` when restoring to 'published'.

---

## [HIGH][broken-crud] Removing a sub-category chip in the category form skips the in-use guard that the sub-categories screen enforces, stranding products
**admin/src/features/categories/routes/CategoryFormPage.tsx:266** (area: admin-catalog)

SubCategoriesPage.tsx:60-67 guards deletion: `askDelete` calls `countSubCategoryProducts(category.id, s.id)` and refuses when any product is attached ("Deleting a sub-category strands its products outside every storefront query"). CategoryFormPage performs the exact same mutation on the same embedded `subCategories` array — line 266 `setSubs((arr) => arr.filter((x) => x.id !== s.id))` — with no count check at all, and `onSave` (line 139) writes the whole array through `saveCategory` → `updateDoc`. Products keep their `subCategoryId`/`subCategorySlug`, but the sub no longer exists on the category doc.

**Failure:** Category "perfumes" has sub "attar" with 12 published products. Admin opens Edit category to change the tint, clicks the × on the "attar" chip (a stale chip they think is a typo), and saves. The 12 products are untouched but 'attar' is gone from `categories/perfumes.subCategories`, so: web ListingView's sub-category facet (ListingView.tsx:58-80) no longer lists it, the admin Product form's Sub-category dropdown (ProductFormPage.tsx:333) can no longer select it — so re-saving any of those 12 products fails required-field validation — and the app's `productsInCategory(subCategorySlug: 'attar')` path is unreachable from the UI.

**Fix:** Make the chip's × call the same `countSubCategoryProducts(id, s.id)` guard used in SubCategoriesPage.askDelete (await it, toast and abort when > 0), or drop sub-category editing from the category form entirely and route it to the guarded screen.

---

## [HIGH][crash-risk] Save handler throws an uncaught TypeError (dead Save button) when a bumped SKU disappears from the live product snapshot
**admin/src/features/inventory/routes/AdjustStockPage.tsx:62** (area: admin-inventory)

`deltas` is keyed by `SkuRow.key` (`${p.id}` or `${p.id}_${v.id}`, api/inventory.ts:183/198) and is never reconciled against `rows`, which is recomputed from the live `useInventoryProducts()` subscription on every snapshot. Line 62 does `const r = rowByKey.get(key)!;` with a non-null assertion, and the whole `payload` build (lines 58-64) sits OUTSIDE the `try` block that starts on line 65. If a key in `deltas` no longer has a row, `r` is `undefined` and `r.productId` throws. Nothing catches it: the `catch` on line 75 is never reached, no toast fires, `setSaving` was never called, and `changedCount` (line 46) still counts the stale key so the button keeps showing e.g. "Save adjustments (1)".

**Failure:** Admin A opens /inventory/adjust and clicks + on variant SKU `p9_v2`. Admin B (or the same admin in another tab) deletes product p9, or edits p9 to drop variant v2, or flips a simple product to hasVariants (which changes its key from `p9` to `p9_v1`). The live listener pushes the new snapshot, the row vanishes from the table, but `deltas['p9_v2']` remains. Admin A clicks Save -> TypeError: Cannot read properties of undefined (reading 'productId'). No error toast, no navigation, no adjustment saved, and every subsequent click on Save does the same nothing.

**Fix:** Build the payload inside the try block and skip/report unknown keys: `const r = rowByKey.get(key); if (!r) return null;` then filter nulls (and prune `deltas` of keys missing from `rows` in an effect, warning the admin that a SKU changed).

---

## [HIGH][broken-crud] Stock is committed by the callable before the ledger batch, so a ledger failure reports total failure and the retry double-applies the stock delta
**admin/src/features/inventory/api/inventory.ts:115** (area: admin-inventory)

`adjustStock` first awaits the `adminAdjustStock` callable (line 84), which transactionally commits the stock change, and only then builds and commits the client-side `stockAdjustments` batch (line 115). There is no compensation. Any rejection after line 88 - `batch.commit()` failing on a network blip/offline/rules denial, or the callable itself rejecting *after* the transaction because `writeAudit` on functions/src/catalog/inventory.ts:90 throws - propagates to AdjustStockPage.tsx:75, which shows the generic `toast.error('Could not save adjustments.')`, keeps the page mounted and keeps `deltas` fully populated. The callable is a relative `+delta` mutation with no idempotency key, so pressing Save again applies the delta a second time.

**Failure:** Admin sets +50 on SKU BRK-77 (stock 10) and clicks Save. The transaction commits stock 10 -> 60, then `batch.commit()` rejects (Wi-Fi drops for two seconds, or writeAudit throws). Toast says "Could not save adjustments." The +50 stepper is still on screen, so the admin clicks Save again. Stock is now 110, and only one ledger row (before 60, after 110) exists. Real stock is inflated by 50 with no record of why.

**Fix:** Either move the stockAdjustments ledger writes into the same Cloud Function transaction (the CF already computes before/after), or send a client-generated idempotency key with the callable so a retry is a no-op; at minimum clear `deltas` / block the retry and surface "stock was adjusted but history could not be written" instead of a blanket failure.

---

## [HIGH][broken-crud] adminAdjustStock silently skips SKUs it cannot resolve, and the client's no-results fallback then writes a fabricated history row and toasts success
**functions/src/catalog/inventory.ts:60** (area: admin-inventory)

Inside the transaction, a missing product doc is skipped with `if (!snap.exists) return;` (line 60) and a variant id not present in `p.variants` is skipped by `if (!d) return v;` (line 78). In both cases nothing is pushed to `results`, yet the function still returns `{ ok: true, count: adjustments.length }` (line 98) - `count` is the number of SKUs *requested*, not applied, so the caller cannot detect the skip from it either. On the client, api/inventory.ts:102-110 treats a missing entry in `moved` as "an older callable build is still deployed" and falls back to `known`/`Math.max(0, known + a.delta)` computed from the stale local `products` array, writing a stockAdjustments row that asserts a stock change which never occurred. AdjustStockPage.tsx:73 then toasts "Stock adjusted for N SKUs" and navigates away. The legacy-build fallback and the real-skip case are indistinguishable, so a genuine no-op is never reported.

**Failure:** Admin opens Adjust stock, sets +10 on product p12. Before the save round-trip lands, p12 is deleted (or its variant v3 is removed by a concurrent product edit). The transaction hits `!snap.exists` / `!d` and does nothing; `results` is empty. The client writes stockAdjustments {productId:'p12', before:4, delta:10, after:14} and shows "Stock adjusted for 1 SKU". Inventory is unchanged, and the Stock history modal now shows a change that never happened.

**Fix:** Have the CF report skips explicitly (e.g. return `skipped: [{productId, variantId, reason}]` and/or throw `not-found` when nothing was applied), and on the client only emit a ledger row for SKUs present in `results`; surface any skipped SKU to the admin instead of falling back to locally-cached stock.

---

## [HIGH][broken-crud] Commission confirmation on 'delivered' runs outside the status transaction and can never be retried
**functions/src/orders/status.ts:98** (area: admin-orders)

The status transition commits in db.runTransaction (lines 63-95). Only afterwards, on a separate round trip, does line 99 call confirmCommissionsForOrder(orderId) and line 100 stamp affiliateCommissionStatus. confirmCommissionsForOrder itself opens a second transaction (commissions.ts:112) that can fail with ABORTED/DEADLINE_EXCEEDED. If it throws, the callable rejects — but the order is already status 'delivered' and TRANSITIONS.delivered === [] (line 20), so a retry of adminChangeOrderStatus throws 'Cannot move delivered -> delivered'. There is no scheduled reconciliation either: functions/src/index.ts exports only couponExpirySweep, and sweeps.ts has no commission logic. The audit log at line 103 is also skipped on that path, so the transition leaves no trace. Secondary issue on line 100: the affiliateCommissionStatus write is fired for every delivered order, including ones with no referrer (checkout.ts:518 initialises it to null), and its error is swallowed by .catch(() => undefined).

**Failure:** Admin marks order #BRK-48219 delivered. The status transaction commits; the follow-up commission transaction hits contention on customers/{affiliateUid} (that doc is also written by every other order of that affiliate) and fails after retries. The admin sees "Couldn't update the status" and clicks Delivered again -> failed-precondition. The commission row stays 'pending' forever, the affiliate's pendingBalancePaise is permanently inflated and the money is never withdrawable, with no admin UI or job able to fix it.

**Fix:** Move the commission clearance into the same transaction as the status write (read the commission rows and affiliate docs before any write), or make the transition idempotent — allow 'delivered' -> 'delivered' as a no-op re-entry that re-runs confirmCommissionsForOrder — and only stamp affiliateCommissionStatus when the order actually carries a commission.

---

## [HIGH][dead-button] Invoice button is permanently dead for an orders-only sub-admin: adminGenerateInvoice is gated on payments.view, not orders
**functions/src/orders/invoice.ts:19** (area: admin-orders)

Every other action on the Order detail screen requires the orders module: adminChangeOrderStatus (status.ts:31) and adminAssignRider (shipment.ts:22) both call requireModule(req, 'orders', 'edit'). adminGenerateInvoice instead calls requireModule(req, 'payments', 'view'). 'orders' and 'payments' are separate keys in MODULE_KEYS (packages/shared/src/enums.ts:258-259), and the admin UI gates the Orders screen on the orders module only (Sidebar.tsx:12 checks modulePermissions[item.module].view). The mismatch cuts both ways: it is also a 'view' permission authorising two writes — ref.update on the CF-only-write orders collection (invoice.ts:62) and a publicly tokened Storage object (line 57).

**Failure:** A sub-admin is created with orders {view,edit} and no payments permission — the normal fulfilment operator. They open /orders/{id}, click Invoice, and get 'Missing payments.view permission.' every time, with no other way to produce an invoice for the customer. Conversely a read-only analyst with payments.view (and nothing else) can call adminGenerateInvoice directly and mutate invoiceUrl/invoiceGeneratedAt on any order plus publish its customer name, phone and address to a public Storage URL.

**Fix:** Change line 19 to requireModule(req, 'orders', 'edit') (or accept either orders.edit or payments.edit), matching the module the screen is gated on and the write the function performs.

---

## [HIGH][broken-crud] adminAllocateAffiliate / adminRevokeAffiliate rewrite the whole affiliate map outside a transaction, clobbering concurrent commission increments
**functions/src/affiliate/withdrawals.ts:32** (area: admin-customers)

Both callables do a plain `ref.get()` (line 27 / 53) and then `ref.update({ affiliate: { ...existing, ... } })` (line 32-42 and line 55) — a non-atomic read-modify-write of the entire `affiliate` map. Every other writer of that map uses field-path increments: accrueCommission (functions/src/affiliate/commissions.ts:93-97) does `'affiliate.pendingBalancePaise': FieldValue.increment(...)`, confirmCommissionsForOrder does the same for pending/confirmed/lifetime (commissions.ts:129-134). A whole-map set based on a stale read silently reverts any increment that landed in between.

**Failure:** Affiliate has pendingBalancePaise = 0. Admin taps the affiliate toggle (revoke) at the same moment a referred customer places an order: the checkout transaction increments pendingBalancePaise to 25000, then adminRevokeAffiliate writes back `{...existing(stale, pending=0), enabled:false}` — the ₹250 commission row exists in `commissions` but the affiliate's pending balance is 0, so it can never be confirmed into confirmedBalancePaise (the withdrawable balance).

**Fix:** Wrap both callables in db.runTransaction (read the customer doc inside the tx) and/or write only the fields that change using field paths — `'affiliate.enabled': false`, `'affiliate.commissionRate': rate` — instead of replacing the whole map.

---

## [HIGH][broken-crud] The `payments` collection has no writer — the admin Payments page and GST-invoice export are permanently empty in production
**admin/src/features/payments/api/payments.ts:10** (area: admin-returns-payments)

`usePaymentsList()` subscribes to `collection(db,'payments')`. A full grep of `functions/src` for `payments` returns exactly one hit — `requireModule(req,'payments','view')` in `orders/invoice.ts:19` — i.e. no Cloud Function ever creates or updates a `payments/{id}` document. `placeOrder` (functions/src/orders/checkout.ts:504-509) and `verifyRazorpayPayment` (checkout.ts:726-729) only stamp `paymentStatus`/`amountPaidPaise`/`razorpayPaymentId` on the ORDER doc. `firestore.rules:76-79` makes `payments` `allow write: if false`, so no client can write it either. The only writer in the whole repo is `scripts/seed.ts:684` (`db.doc('payments/'+orderId).set(...)`). Consequently the `partial_refund`/`refunded` branches in `paymentStatusPill` (payments.ts:23-26) are dead — `adminApproveOrderRequest` increments `orders.refundedPaise` and flips `orders.paymentStatus`, never the payment doc.

**Failure:** On a real (non-seeded) project: a customer completes a Razorpay checkout, `verifyRazorpayPayment` sets order.paymentStatus='captured'. An admin opens /payments -> the table renders 'No payments yet.' and the header reads '₹0 this month · 0 failed'. Clicking 'GST invoices' toasts 'Nothing to export.' Every captured payment in the business is invisible to the admin.

**Fix:** Write a `payments/{orderId}` doc from `placeOrder` (status 'pending'/'captured' for fully-wallet orders) and update it in `verifyRazorpayPayment` (status 'captured', gatewayRef=razorpayPaymentId); update it to 'refunded'/'partial_refund' inside the `adminApproveOrderRequest` transaction alongside the `orders.refundedPaise` increment.

---

## [HIGH][cross-surface-mismatch] Return window is hardcoded to 3 days server-side but the storefront gates on the admin-configurable `settings/returns.windowDays` (default 7)
**functions/src/returns/requests.ts:42** (area: admin-returns-payments)

`requestReturnOrReplacement` hardcodes `RETURN_WINDOW_MS = 3 * 24 * 60 * 60 * 1000` and rejects anything older with 'The 3-day return window for this order has closed.' The web return page (web/src/app/(shop)/account/orders/[id]/return/page.tsx:23-25) gates on `returnWindow(order, returnSettings?.windowDays)` where `DEFAULT_RETURN_WINDOW_DAYS = 7` (web/src/components/account/orders.ts:246), and the admin writes that value in admin/src/features/settings/routes/StorefrontTab.tsx:296. Both `scripts/seed.ts:208` and `scripts/bootstrap-real.ts:117` seed `windowDays: 7`. The CF also hard-requires `o.deliveredAt` while `returnWindow()` falls back to `order.placedAt` when `deliveredAt` is missing, widening the gap. The admin's 'Return window (days)' input therefore controls nothing on the server, and nothing at all on the app (app/lib/features/orders/data/order.dart:202 hardcodes 3 too).

**Failure:** Order delivered 5 days ago, settings/returns.windowDays = 7 (the seeded default). Web /account/orders/{id}/return renders the full form and says returns can be raised within 7 days. The customer picks a reason and submits -> the CF throws failed-precondition -> `requestReturn` returns ok:false -> the page shows the generic "We couldn't submit your return just now. Please try again." The customer retries forever and never learns the real reason.

**Fix:** Read `settings/returns.windowDays` inside `requestReturnOrReplacement` (falling back to 7, treating <=0 as returns-disabled) instead of the 3-day constant, and mirror the `deliveredAt ?? placedAt` fallback the web uses; make app/lib/.../order.dart read the same setting.

---

## [HIGH][dead-button] Coupon 'Category restriction' is written to Firestore but no surface enforces it, so a category-limited coupon discounts any cart
**admin/src/features/coupons/api/coupons.ts:130** (area: admin-growth)

CouponFormPage.tsx:328-349 renders category chips and saveCoupon persists `applicableCategories: values.applicableCategories` (coupons.ts:130) as category slugs. Grepping every consumer of that field across the repo returns exactly one hit — app/lib/features/checkout/data/offers.dart:108, which uses it only to build a display string ('Perfume only'). `computeCouponDiscount` and `autoBestOffer` in functions/src/orders/checkout.ts never read it, and web/src/components/checkout/offers.ts never reads it. Also note the admin stores `c.slug` while products carry `categoryId`/`categorySlug`, so even a future check would need the slug form.

**Failure:** Admin creates PERFUME20 (20% off) and restricts it to the 'perfume' category to clear that stock. A customer puts only ₹5,000 of dates and dry fruits (categoryId 'grocery') in the cart and enters PERFUME20. computeCouponDiscount validates code, active, min cart, uses, and applies ₹1,000 off with no category check. The margin-protecting restriction the admin configured is a no-op.

**Fix:** Enforce it server-side in computeCouponDiscount/autoBestOffer: `priceLines` already resolves each product, so reject (or restrict the discount base to) lines whose `categorySlug`/`categoryId` is not in `applicableCategories` when that array is non-empty. Mirror the check in web offers.ts.

---

## [HIGH][dead-button] Admin "Grant spins" is cosmetic — executeSpin never gates on spinsRemaining
**functions/src/spin/execute.ts:93** (area: admin-spin-notif)

executeSpin reads `spinsRemaining` (line 93) and decrements it with a `Math.max(0, remaining - 1)` floor (line 110), but never blocks when it is 0 — the only gate is the campaign-level `spinsPerDay` daily cap counted from spinHistory (lines 74-88). The comment on line 108 admits it: "the daily cap above is the real gate, so this never blocks". adminGrantSpins (functions/src/spin/grant.ts:31) is the sole writer, and both clients ignore the field: app/lib/features/spin/data/spin_repository.dart:37 derives spins left purely from `spinsPerDay - usedToday`, and web/src/app/(shop)/account/rewards/page.tsx:66-75 does the same. Every customer doc is created with `spinsRemaining: 0` (web/src/lib/customerDoc.ts:51, app/lib/features/auth/data/auth_repository.dart:233), yet all of them can still spin.

**Failure:** Campaign has spinsPerDay=1. Admin opens a customer, types 5, clicks "Grant spins" (admin/src/features/customers/routes/CustomerProfilePage.tsx:175); the card shows 5 and toasts "Granted 5 spins". The customer still gets exactly 1 spin today, and the balance silently drops to 4. Conversely "Clear balance" (line 181) sets it to 0 and the customer still spins normally — the privileged action changes nothing.

**Fix:** Either enforce the granted balance in executeSpin (treat spinsRemaining as bonus spins beyond spinsPerDay, and reject when both the daily cap and the balance are exhausted), or remove the grant/revoke UI and the adminGrantSpins callable so admins are not told they changed something they did not.

---

## [HIGH][security] Campaign `eligibility` is written by admin but never enforced by executeSpin
**functions/src/spin/execute.ts:56** (area: admin-spin-notif)

Both admin screens persist `eligibility` (admin/src/features/spinner/api/spinner.ts:123 on create, :145 on save) with options all/new/existing/affiliates/segment (CreateCampaignPage.tsx:14-20). executeSpin validates only `status` (line 56) and the date window (line 59) — it never loads the customer's affiliate flag, order count or signup date. A repo-wide grep for `eligibility` returns only the shared type, the two admin files and seed.ts: no function, no web page, no Dart file ever reads it.

**Failure:** Admin creates an "Affiliates only" wheel with a ₹500-off slice and activates it. Any signed-in customer opens Rewards (web) or the Spin screen (app) — activeCampaign() filters on status only — calls executeSpin and wins the affiliate-only coupon, which checkout then honours from customers/{uid}/coupons.

**Fix:** In executeSpin, after the status/window checks, load customers/{uid} and reject with failed-precondition when camp.eligibility is 'affiliates' and `affiliate.enabled != true`, 'new' and stats.totalOrders > 0, 'existing' and stats.totalOrders == 0; the clients should apply the same filter when choosing the active campaign.

---

## [HIGH][cross-surface-mismatch] Campaigns past their end date stay status 'active', so every client spin fails
**admin/src/features/spinner/api/spinner.ts:75** (area: admin-spin-notif)

deriveSpinStatus computes "Ended"/"Scheduled" purely from startsAt/endsAt (lines 72-76) but nothing ever persists status='ended' — the only status writer is setCampaignStatus (line 154), driven by the single Pause/Activate button (CampaignDetailPage.tsx:296), and grep shows no 'ended' write in functions/ or admin/ at all. Both clients select the campaign by status only: app/lib/features/spin/data/spin_repository.dart:22 (`where('status','==','active').limit(1)`) and web/src/app/(shop)/account/rewards/page.tsx:52. executeSpin, however, does enforce the window (functions/src/spin/execute.ts:57-59).

**Failure:** A 30-day campaign created with "Activate immediately" reaches its end date. Admin list shows it as "Ended" so nobody touches it. The app Spin screen still renders the wheel and says "1 spin left today"; every tap of "Spin now" round-trips to executeSpin and comes back failed-precondition "This spin campaign is not active right now" — a permanently broken screen with no way for the customer to know why.

**Fix:** Have the clients filter the window too (startsAt <= now <= endsAt), and/or flip status to 'ended' — either in a scheduled sweep like couponExpirySweep, or lazily in executeSpin when it detects now > endsAt.

---

## [HIGH][broken-crud] Approved returns refund the customer but never reverse the affiliate's confirmed commission
**functions/src/returns/decisions.ts:103** (area: admin-affiliate)

`adminApproveOrderRequest` credits the refund to the wallet, writes the ledger row and stamps the request/item — the whole file contains zero references to `commissions` or `affiliate` (grep count 0 across all 182 lines). Meanwhile functions/src/affiliate/commissions.ts:11-14 documents the design as: "Commission clears at delivery rather than after `commissionClearanceDays` … Returns are handled by the return flow, which is the case the clearance delay was protecting against." That claim is false — the return flow does nothing. `confirmCommissionsForOrder` (commissions.ts:107) has already moved the commission from `pendingBalancePaise` into `confirmedBalancePaise` on delivery, and `confirmedBalancePaise` is the withdrawable balance (requests.ts:39-40), so the money is immediately payable. cancel.ts:71-74 deliberately only reverses rows still `pending`, so no other path claws it back either.

**Failure:** Customer B (referred by affiliate A at 5%) orders ₹20,000 of merchandise. Admin marks it delivered → A's confirmedBalancePaise += ₹1,000. B raises a return; admin approves it → B is refunded ₹20,000 to wallet. A still holds ₹1,000 withdrawable and can immediately call requestWithdrawal for it. The business pays commission on goods it took back, with no ledger trace.

**Fix:** In the approve transaction, read `commissions` for `orderId` (query before the transaction, re-read each ref inside it), and for rows with status 'confirmed' write `status:'reversed'`/`cancellationReason` and `FieldValue.increment(-amount)` on `affiliate.confirmedBalancePaise` (and `lifetimeEarningsPaise`), pro-rating by the refunded fraction of the order for partial returns. Clamp at zero and record a shortfall if the affiliate already withdrew it.

---

## [HIGH][security] Review moderation is gated only by isAdmin() in rules — the reviews module permission is client-side hiding with no server backing
**firebase/firestore.rules:113** (area: admin-settings-auth)

The rules file explicitly states (lines 15-19) that every collection admins write directly is gated by `canWrite(module)`. `/reviews/{id}` breaks that contract: `allow update: if hasAppCheck() && isAdmin() && affectedKeys().hasOnly(['status','moderatedBy','moderatedAt','updatedAt','helpfulCount'])` — any sub-admin passes, with no `reviews` module check. `allow read` is likewise `isAdmin()` for every doc. Nothing else stops this: admin/src/app/router.tsx:79 registers `/reviews` under `RequireAuth` only, and RequireAuth performs no module check — Sidebar.tsx:11-12 merely hides the nav link. admin/src/features/reviews/api/reviews.ts:50 writes the review status directly from the client (no callable, so no `requireModule`). Conversely the same transaction does `tx.update(pRef, {ratingCount, rating})` at reviews.ts:64 against `/products/{id}`, which rules gate with `canWrite('products')`.

**Failure:** A sub-admin is created with only `dashboard.view` enabled. The Reviews link is hidden, but typing /reviews in the URL loads the full moderation queue (read allowed by isAdmin()) and 'Reject' on any pending review succeeds — no product write is needed for pending→rejected, so the rules accept it. Symmetrically, a sub-admin granted the whole `reviews` module but not `products` clicks 'Approve' and the transaction is rejected with permission-denied, because approving must write products.rating.

**Fix:** Change the reviews rule to `allow update: if canWrite('reviews') && affectedKeys().hasOnly([...])` (and read to `isAdmin()` is fine), and allow the ratingCount/rating aggregate write on products when `can('reviews','approve')` — or move the aggregate update into a callable guarded by `requireModule(req,'reviews','approve')`.

---

## [HIGH][cross-surface-mismatch] Settings → Storefront return window is ignored by the server, which hardcodes 3 days
**functions/src/returns/requests.ts:42** (area: admin-settings-auth)

Admin writes `settings/returns.windowDays` via admin/src/features/settings/routes/StorefrontTab.tsx:296 → saveReturns (api/settings.ts:84). The storefront honours it: web/src/components/account/orders.ts:261 `returnWindow(order, returnSettings?.windowDays)` with a 7-day fallback, used to show/hide the Return button (web/src/app/(shop)/account/orders/[id]/page.tsx:71). But the callable that actually creates the return hardcodes `const RETURN_WINDOW_MS = 3 * 24 * 60 * 60 * 1000` and rejects anything older, and the Flutter app hardcodes its own value too (app/lib/features/orders/data/order.dart:202 `returnWindowDays = 3`). Nothing anywhere reads `settings/returns` on the server or in the app. Even the seeded default (scripts/seed.ts:208, `windowDays: 7`) already disagrees with the CF.

**Failure:** With the seeded default of 7 days (or an admin setting 14), a customer opens a delivered order 5 days after delivery. The web order page computes `open: true, daysLeft: 2` and renders 'Request return'. Submitting calls requestReturnOrReplacement, which throws failed-precondition 'The 3-day return window for this order has closed.' The customer sees a dead button; the admin's configured window has no effect at all.

**Fix:** Have requestReturnOrReplacement read `settings/returns` inside the transaction and use `windowDays` (falling back to 7) instead of the hardcoded 3 days, and make app/lib/.../order.dart read the same doc rather than the `returnWindowDays = 3` constant.

---

## [HIGH][cross-surface-mismatch] Top-products report reads itemsSummary, which checkout truncates to the first 4 line items
**admin/src/features/reports/api/reports.ts:228** (area: admin-dashboard-reports)

computeTopProducts iterates `o.itemsSummary ?? []`. The only writer of orders, functions/src/orders/checkout.ts:492, writes `itemsSummary: priced.slice(0, 4).map(...)` — it is an explicitly capped thumbnail strip, not the line-item list. The full line items are written on the same doc as `items` (checkout.ts:474-482, typed `Order.items` in packages/shared/src/types/orders.ts:47) and older orders keep them in the orders/{id}/items subcollection. The reports module never reads either. admin/src/features/orders/api/orders.ts:35 already implements the correct embedded-array + subcollection fallback; reports does not use it.

**Failure:** A customer checks out with 6 distinct products (A..F). checkout writes itemsSummary=[A,B,C,D] and items=[A..F]. On Reports, products E and F contribute ₹0 revenue and never appear in Top products, no matter how expensive they are. Every order with >4 distinct products silently under-reports.

**Fix:** Iterate the canonical line items instead: `const lines = o.items ?? []` (plus the legacy orders/{id}/items fallback used by useOrderItems), and accumulate per productId from those. Never use itemsSummary for analytics.

---

## [HIGH][cross-surface-mismatch] Top-products revenue is priced from the live catalog price, not the order's line totals
**admin/src/features/reports/api/reports.ts:229** (area: admin-dashboard-reports)

`const priceOf = new Map(products.map(p => [p.id, p.offerPricePaise ?? 0]))` (line 223) and `revenue = (item.quantity ?? 0) * (priceOf.get(item.productId) ?? 0)` (line 229). The order line already carries the realised amount: OrderItem.lineTotalPaise / offerPricePaise, written at checkout (checkout.ts:479). Worse, for a variant product the product-level offerPricePaise is just the FIRST variant row's price — admin/src/features/products/routes/ProductFormPage.tsx:205,235 sets `baseRow = variantRows[0]` and writes `offerPricePaise: toPaise(offerOf(baseRow))`. Coupon/spin discounts on the order are also ignored.

**Failure:** An abaya sold in S/M/L at ₹1,200/₹1,400/₹1,600 (S is variant row 0). 100 units of L sold last month → Top products reports 100 × ₹1,200 = ₹1,20,000 instead of ₹1,60,000. If an admin then edits the price to ₹999, the report for the ALREADY-CLOSED period retroactively drops to ₹99,900 — historical revenue changes when a price is edited. A product deleted from the catalog reports ₹0.

**Fix:** Compute revenue from the order line itself: `row.paise += item.lineTotalPaise ?? (item.quantity * item.offerPricePaise)`, using o.items (with the legacy subcollection fallback). Drop the products→price map entirely; the products query is then only needed for names.

---

## [HIGH][perf] Dashboard revenue trend caps at 2000 oldest orders, zeroing out the most recent months
**admin/src/features/dashboard/api/dashboard.ts:248** (area: admin-dashboard-reports)

`query(ordersCol(), where('createdAt','>=',from), orderBy('createdAt','asc'), limit(2000))`. The sort is ASCENDING, so the limit keeps the OLDEST 2000 documents in the window and discards everything after them. The result is then bucketed into the 12 monthly / 30 daily bars. There is no indication to the user that the series is truncated.

**Failure:** Store does 300 orders/month. On the 12M range the query window holds ~3600 orders; the ascending limit(2000) returns only the first ~6.7 months. The bars for the last ~5 months — including the current month — render at heightPct 2 with ₹0, so the dashboard shows revenue having collapsed to zero. Growth makes the problem worse, not better.

**Fix:** Either aggregate server-side per bucket (getAggregateFromServer with sum('totalPaise') per month/day range, same pattern already used by sumTotalPaise at line 43), or page through the window with startAfter until exhausted. If a cap must stay, order DESCENDING so the newest data survives and label the chart as partial.

---

## [HIGH][cross-surface-mismatch] Dashboard counts cancelled orders as revenue; Reports excludes them — the two screens disagree
**admin/src/features/dashboard/api/dashboard.ts:110** (area: admin-dashboard-reports)

dashboard.ts sums totalPaise with no status filter: today's revenue (line 85), yesterday (86), lifetime for AOV (87), the 30/60-day AOV windows (90-93) and the trend bars (line 255) all include status=='cancelled' orders. reports.ts:100-101 does the opposite — `sumRevenue` filters `o.status !== 'cancelled'` and computeTrend skips them (reports.ts:194) — with the comment "Cancelled orders never realised revenue". Same collection, same field, two different answers in the same admin panel.

**Failure:** On a day with ₹1,00,000 booked and ₹40,000 cancelled, Dashboard "Today's revenue" shows ₹1.0L while Reports (7D) attributes ₹60,000 to that day. "Avg order value" on the dashboard is inflated further because the cancelled orders are in both the numerator (lifetime sum) and the denominator (countOrders([]) with no status filter).

**Fix:** Apply the reports rule to the dashboard: add `where('status','!=','cancelled')` (or subtract a cancelled-only aggregate) to every sumTotalPaise/countOrders call and to the trend reducer, so both surfaces use one definition of realised revenue.

---

## [HIGH][perf] Reports opens four unbounded real-time listeners over entire collections with no limit or date filter
**admin/src/features/reports/api/reports.ts:46** (area: admin-dashboard-reports)

useReportOrders subscribes to `query(collection(db,'orders'), orderBy('createdAt','desc'))` — the whole orders collection, live, no limit; useReportProducts (line 52) reads all products; useReportCustomers (line 57) all customers; useReportOrderRequests (line 64) all orderRequests. Every order document now embeds its full `items` array (checkout.ts:495), so each doc is large. All KPI/trend/top-product maths is then done client-side in render (ReportsPage.tsx:70-72) over the full arrays on every keystroke-free re-render. The snapshots are held forever in the module-level `cache` map in hooks/firestoreCache.ts:32 — the listener detaches on unmount but the data is never evicted.

**Failure:** At 50,000 lifetime orders, opening Reports downloads 50,000 documents (tens of MB, 50k billed reads) before the first KPI appears, and the tab keeps that array resident for the session. Selecting the 7D preset still reads all 50,000 docs to compute a 7-day number, and every new order pushed by the listener re-runs computeKpis/computeTrend/computeTopProducts over the whole set.

**Fix:** Scope the queries to the active range (`where('createdAt','>=', rangeStart(range))`) so the read grows with the window, not the store's lifetime; use getDocs rather than onSnapshot for a report; and memoise the compute functions with useMemo on [data, range].

---

## [HIGH][cross-surface-mismatch] App's add/edit address screen has no state or pincode input, so app-created addresses persist `state: ''` and `pincode: ''`
**app/lib/features/checkout/add_address_screen.dart:90** (area: app-auth-profile)

The screen only collects a label, `Flat / building` (-> line1) and `Area` (-> city). At save it hardcodes `state: widget.existing?.state ?? ''` and `pincode: widget.existing?.pincode ?? ''` (lines 90-91), so any address created in the app has empty state/pincode forever (editing it in the app can never fill them either). The web form writing the same `customers/{uid}.addresses` array validates both as required — web/src/app/(shop)/account/addresses/new/page.tsx:15 `PIN_RE = /^\d{6}$/` and errors.state/errors.pincode. functions/src/orders/checkout.ts:511 embeds the chosen address verbatim as `deliveryAddress`, and functions/src/orders/invoice.ts:44 renders `${addr.city} ${addr.pincode}`.

**Failure:** An app-only customer adds "Apt 1204" / "Kakkanad" and checks out. The order's `deliveryAddress.pincode` is "", `state` is ""; the generated invoice's Bill-to block prints the city with no pincode, the admin order screen shows an address with no PIN, and the parcel cannot be routed. The same customer's address created on the web has a valid pincode — the two surfaces produce structurally different records in the same array.

**Fix:** Add State and Pincode fields (6-digit validation, mirroring PIN_RE) plus name/phone as on the web form, and require them before enabling Save.

---

## [HIGH][cross-surface-mismatch] Edit profile never sets `profileComplete`, so a customer who skipped signup is sent back to Create Profile forever (including on the web)
**app/lib/features/profile/edit_profile_screen.dart:77** (area: app-auth-profile)

`_save()` updates only `name`, `email` and `updatedAt`. It does not set `profileComplete: true` (nor recompute `searchIndex`), unlike both `AuthRepository.completeProfile` (auth_repository.dart:138-143) and the web's `completeCustomerProfile` (web/src/lib/customerDoc.ts). Every downstream router decision keys off `profileComplete`: app splash via `isProfileComplete()` (auth_repository.dart:100-110), the app OTP screen via `ensureCustomerDoc`, and the web via `needsProfile: !profileComplete` -> `router.replace('/create-profile')` (web/src/app/(auth)/signin/page.tsx:72).

**Failure:** User taps "Skip" at signup, then later fills in their full name and email on Profile -> Edit profile and saves. `profileComplete` stays false. On their next app login the OTP screen routes them to Create Profile again with empty fields, and signing in on the web immediately redirects them to /create-profile even though the account already has a name and email.

**Fix:** Have `_save()` write `profileComplete: true` and the recomputed `searchIndex` alongside name/email (both fields are permitted by the customers update rule at firebase/firestore.rules:135-136), or reuse `AuthRepository.completeProfile`.

---

## [HIGH][dead-button] Reviews screen is unreachable for any product with zero reviews, so no product can ever receive its first app review
**app/lib/features/catalog/product_details_screen.dart:188** (area: app-catalog)

`_reviewsSummary(context)` is the ONLY place in the whole app that pushes `/product/:id/reviews` (line 484 — confirmed by grep across app/lib), and it is rendered behind `if (p.ratingCount > 0)` at line 188. Inside it, line 488-489 reads `p.ratingCount > 0 ? 'See all N' : 'Write a review'` — the `'Write a review'` branch is unreachable dead code, because the widget only renders when ratingCount > 0. `products.ratingCount` is only ever incremented when an admin APPROVES a review (admin/src/features/reviews/api/reviews.ts:59-64) or typed by hand in the product form (ProductFormPage.tsx:223); nothing else writes it, and the web has no review form at all.

**Failure:** Admin publishes a new product; `ratingCount` is 0 (admin/src/features/products/api/products.ts:200). A customer opens the product in the app — there is no 'Ratings & reviews' section and no link to `/product/{id}/reviews`, so `ReviewsScreen` and its fully-working `_WriteReviewSheet` are dead. Because ratingCount only rises after an approved review exists, and the only way to submit one is through that unreachable screen, the product is permanently stuck at 0 reviews. The entire reviews feature is inert for every new product.

**Fix:** Render the reviews section unconditionally (drop the `p.ratingCount > 0` guard at line 188) so the `'Write a review'` label at line 489 becomes reachable; keep the numeric summary block (lines 497-527) behind the ratingCount check if a zero-star block is undesirable.

---

## [HIGH][crash-risk] Timeout-recovery path touches BuildContext after an await with no mounted check, and throws from inside a catch block
**app/lib/features/checkout/checkout_screen.dart:147** (area: app-cart-checkout)

`_placeOrder` awaits `_repo.placeOrder` with a 120s callable timeout (checkout_repository.dart:274). On `deadline-exceeded`/`unavailable` it calls `_recoverTimedOutOrder`, whose FIRST statement is `final uid = context.read<AuthProvider>().uid;` (line 147) — before any `mounted` check (the only `if (!mounted)` is at line 153, after the await). `State.context` dereferences `_element!`, which is null once the element is unmounted, so this throws. Worse, it throws from inside the `on FirebaseFunctionsException catch` block, so the following `catch (_)` at line 134 does NOT catch it — the error escapes `_placeOrder` entirely as an unhandled async exception and `_placing` is never reset. Unlike PaymentScreen (payment_screen.dart:218 wraps the body in `PopScope(canPop: !_processing)`), CheckoutScreen has no pop guard, so the user can freely back out during the 120s window.

**Failure:** User taps 'Place order · ₹1,299' on Checkout; the callable stalls (cold start + poor network). While it is in flight the user taps the back arrow (checkout_screen.dart:227 `context.pop()`), unmounting `_CheckoutScreenState`. 120s later the call fails with `deadline-exceeded`; `_recoverTimedOutOrder` runs, `context.read<AuthProvider>()` dereferences a null element and throws a TypeError that no handler catches. The order may in fact have committed server-side, but the recovery lookup never runs, so nothing tells the user and nothing clears the bag.

**Fix:** Capture the uid before the await (alongside `cart`/`draft` in `_placeOrder`) and pass it into `_recoverTimedOutOrder`, or add `if (!mounted) return false;` as the first line of `_recoverTimedOutOrder`. Additionally wrap the checkout body in `PopScope(canPop: !_placing, ...)` the way PaymentScreen already does.

---

## [HIGH][cross-surface-mismatch] placeOrder auto-applies the best coupon server-side, but the app never applies it to the draft — displayed total is higher than what is charged and a spin coupon is silently consumed
**app/lib/features/checkout/checkout_screen.dart:108** (area: app-cart-checkout)

`_placeOrder` sends `couponCode: draft.coupon?.code` (line 108), which is null whenever the customer has not tapped 'Apply'. Server-side, `placeOrder` treats a null code as an instruction to auto-apply: `couponCode ? computeCouponDiscount(...) : await autoBestOffer(uid, subtotalPaise)` (functions/src/orders/checkout.ts:347-349). `autoBestOffer` scans `customers/{uid}/coupons` and marks the winner used (`status:'used'`, checkout.ts:567-572) and increments promo counters. The web client compensates for this: checkout/page.tsx:84-95 has a `useEffect` that auto-applies `bestOfferForCart` into the draft on mount ('Auto-applied best offer'), so its summary matches. The app only renders a passive `CouponRewardBanner` that requires an explicit tap (coupon_apply.dart:85-95); nothing writes the auto-offer into `CheckoutDraft`, so `computeSummary` shows no discount.

**Failure:** Customer holds a spin reward 'SPIN200 · ₹200 off · min ₹500'. They open Checkout on a ₹1,000 COD cart and ignore the gold banner. The pay bar reads 'Place order · ₹1,000' and the summary shows no Discount row. `placeOrder` runs `autoBestOffer`, applies SPIN200, creates the order at ₹800, and flips the spin coupon to `status:'used'`. The customer sees ₹1,000 on checkout, ₹800 on confirmation, and their one-time spin reward is gone without them ever choosing to spend it.

**Fix:** Mirror the web behaviour: on Checkout, once offers have loaded and `draft.coupon == null` and subtotal > 0, auto-apply `listAvailableOffers(...).firstWhere(qualifies && discount>0)` into `CheckoutDraft` once (guarded by a `_autoTried` flag so a manual removal is respected). Alternatively send an explicit `couponCode: ''`/opt-out flag so the server does not auto-apply behind the UI.

---

## [HIGH][cross-surface-mismatch] findOrderByNonce returns totalPaise as the order amount while the normal path returns payablePaise — recovered orders overstate the COD amount due by the wallet amount
**app/lib/features/checkout/data/checkout_repository.dart:313** (area: app-cart-checkout)

The normal `placeOrder` return maps `amountPaise` from the callable's `summary.payablePaise` (functions/src/orders/checkout.ts:619, i.e. total AFTER the wallet debit). The just-added recovery path builds `PlacedOrder` from the order document with `amountPaise: (data['totalPaise'] as num?)?.toInt() ?? 0` (line 313) — `totalPaise` is the pre-wallet total (checkout.ts:503; the post-wallet figure is `totalPaise - walletUsedPaise`). `OrderConfirmationScreen` renders this value verbatim as '₹X due on delivery' / '₹X paid' (order_confirmation_screen.dart:92, 204-205). The CF's own idempotency replay has the same defect: it returns `prior.amountPaise`, which was stored as `summary.totalPaise` (checkout.ts:555 vs 619), so payment_screen's retry path is affected too.

**Failure:** COD order: subtotal ₹1,000, wallet balance ₹400 applied → totalPaise ₹1,000, walletUsedPaise ₹400, payablePaise ₹600. `placeOrder` times out but commits. `_recoverTimedOutOrder` finds it via `findOrderByNonce` and routes to confirmation, which displays '₹1,000 due on delivery' instead of ₹600 — telling the customer to hand the delivery agent ₹400 more than they owe. Same wrong figure appears after a cancelled-then-retried Razorpay payment, where the CF replay returns totalPaise.

**Fix:** In `findOrderByNonce`, compute `amountPaise: (totalPaise - walletUsedPaise).clamp(0, totalPaise)` reading both fields from the order doc. Also change the CF replay return (checkout.ts:386) to store/return `payablePaise` so the replay shape matches the first-placement shape.

---

## [HIGH][cross-surface-mismatch] Spin-coupon discount is counted twice in the order detail and invoice totals
**app/lib/features/orders/data/order.dart:189** (area: app-orders-returns)

`placeOrder` derives spinRewardPaise FROM discountPaise, it is not an additional reduction: functions/src/orders/checkout.ts:352-353 `const spinRewardPaise = userCouponId && userCouponSource === 'spin' ? Math.max(0, discountPaise) : 0;` and the order doc is then written with `discountPaise: summary.discountPaise` (checkout.ts:497) and `spinRewardPaise` (checkout.ts:498), where `summarise()` returns the same discountPaise it was given unchanged (checkout.ts:302). The app treats them as two independent reductions and adds them: `deductionPaise => discountPaise + spinRewardPaise + walletUsedPaise` (order.dart:189) and `discountsExWalletPaise => discountPaise + spinRewardPaise` (order.dart:194). Those getters drive the only money-reduction line on both money screens: order_detail_screen.dart:396-400 ("Discounts applied") and invoice_screen.dart:179-180 (the single deduction line on the tax invoice).

**Failure:** Customer wins a spin coupon and redeems it for Rs 100 off a Rs 1000 order. Firestore stores discountPaise=10000 and spinRewardPaise=10000 (same money). Order detail shows 'Discounts applied -Rs 200.00' and the invoice shows 'Discount + Spin reward -Rs 200.00', i.e. double the discount the customer actually received, while 'Total paid' still shows the real total - the invoice no longer reconciles.

**Fix:** Treat spinRewardPaise as a labelling flag, not an amount: make `deductionPaise => discountPaise + walletUsedPaise` and `discountsExWalletPaise => discountPaise`, and use `spinRewardPaise > 0` only to choose the label ('Spin reward' vs 'Discount'). Alternatively stop writing the duplicate value in checkout.ts and make spinRewardPaise a disjoint component.

---

## [HIGH][cross-surface-mismatch] seed writes spin-slice `discountPercent` as a fraction (0.15) while admin/app/web/CF all treat it as an integer percent
**scripts/seed.ts:747** (area: app-rewards)

scripts/seed.ts:747 seeds slice `s2` as `{ prizeType:'percent_discount', discountPercent: 0.15, displayLabel:'15% off' }`. Every reader treats the field as whole percent: admin/src/features/spinner/routes/CampaignDetailPage.tsx:73 (`percent: s.discountPercent`) and rowToSlice writes `Number(r.percent)` straight from a `%` number input; functions/src/orders/checkout.ts:170-171 computes `Math.round(subtotal * pct / 100)`; web/src/components/wallet/actions.ts:122 renders `${c.discountPercent}% off`; and the app parses it through `_int()` (app/lib/features/spin/data/spin_campaign.dart:48 and app/lib/features/coupons/data/user_coupon.dart:102), where `(0.15).toInt() == 0`. `executeSpin` copies the slice value verbatim onto the issued coupon (functions/src/spin/execute.ts:132).

**Failure:** On the seeded dataset a customer spins and lands on the '15% off' slice. `executeSpin` writes `customers/{uid}/coupons/{id}` with `discountPercent: 0.15`. My Coupons renders `UserCoupon.headline` as "0% off" (0.15 truncated by `_int`), the checkout offer list (app/lib/features/checkout/data/offers.dart:63) computes `pct = 0` so the coupon shows a ₹0 discount, and the server applies `Math.round(subtotal * 0.15 / 100)` ≈ ₹0.15 on a ₹1000 cart instead of ₹150. Web shows "0.15% off".

**Fix:** Change scripts/seed.ts:747 to `discountPercent: 15` (and audit any other seeded percent fields for the same 0..1 vs 0..100 scale). Optionally have `SpinSlice.fromMap`/`UserCoupon.fromDoc` round rather than truncate so bad data degrades visibly instead of silently becoming 0.

---

## [HIGH][dead-button] Wishlist grid renders every saved product as "Out of stock" and its quick-add button is permanently inert
**app/lib/features/wishlist/data/wishlist.dart:81** (area: app-affiliate-notif)

`WishlistItem.toProduct()` (wishlist.dart:81-95) rebuilds a `Product` from the denormalised wishlist snapshot but never passes `stock`, `hasVariants` or `variants`. `Product`'s constructor defaults them to `stock = 0`, `hasVariants = false`, `variants = const []` (app/lib/features/catalog/data/product.dart:50-53), and `Product.inStock` is `hasVariants ? variants.any(...) : stock > 0` (product.dart:85) — so every wishlist-derived Product is `inStock == false`. WishlistScreen feeds exactly this object to `ProductCard` (wishlist_screen.dart:83-88). ProductCard reacts to `!product.inStock` by painting the white dimming scrim + red "Out of stock" badge (product_card.dart:181-207) and `_AddButton` short-circuits to an inert `Icons.block_rounded` container with NO onTap (product_card.dart:281-292). The wishlist snapshot doc genuinely has no stock field (web writes the same shape, web/src/lib/wishlist.ts:38-55), so the data must be re-read from `products/{id}` — the web wishlist page sidesteps this by using its own WishlistCard that has no stock state at all.

**Failure:** Customer taps the heart on an in-stock perfume (stock 40), opens Profile ▸ Wishlist. The card is greyed out with an "Out of stock" badge and the green quick-add `+` is replaced by a dead block icon. Tapping it does nothing — the item can only be bought by opening the detail page. The same product on Home/Category shows in-stock and adds to bag fine.

**Fix:** Either persist `stock`/`hasVariants` in the wishlist snapshot payload (both app and web writers) and pass them through `toProduct()`, or have WishlistScreen resolve each id against the live `products` docs (e.g. `CatalogRepository.productsByIds`) before handing them to ProductCard.

---

## [HIGH][perf] Categories tab re-subscribes an unbounded whole-catalog listener on every keystroke of the category search box
**app/lib/features/catalog/categories_screen.dart:97** (area: app-core)

Both `stream: _repo.categories()` (line 73) and the nested `stream: _repo.categoryCounts()` (line 97) are constructed inside `build()`. The search field's `onChanged: (v) => setState(() => _query = v)` (line 178) rebuilds the whole screen on every character typed, producing new Stream objects each time, so both StreamBuilders tear down and re-listen. `CatalogRepository.categoryCounts()` (app/lib/features/catalog/data/catalog_repository.dart:65) is `products.where('status','published').snapshots()` with NO `limit` — a full-collection real-time listener over the entire published catalog. Filtering is purely in-memory (`_filter`, line 53), so re-subscribing gains nothing.

**Failure:** User opens Categories, taps search and types 'sweets' (6 characters). Each keystroke re-issues both listens; the app performs 6 extra full reads of the `categories` collection AND 6 extra full reads of every published product document just to filter a locally-held list. On a 2,000-product catalog that is ~12,000 extra document reads for one search term, plus the grid flashing back to `_CategoriesSkeleton` (line 79) each time `snap.hasData` resets to false.

**Fix:** Make both streams `late final` fields (as `SearchScreen` already does at app/lib/features/search/search_screen.dart:49-50) so they are created once per State, and add a bounded/aggregate strategy for `categoryCounts()` instead of listening to the whole `products` collection.

---

## [HIGH][dead-button] Rewards coupon "Apply" is a dead button — /bag never reads the ?coupon= param
**web/src/app/(shop)/account/rewards/page.tsx:98** (area: web-auth-account)

`applyCode()` navigates to `/bag?coupon=<CODE>`. It is wired to both the manual code input (Apply button + Enter key, lines 227/232) and to every `CouponCard`'s Apply button (line 266). But `web/src/app/(shop)/bag/page.tsx` never calls `useSearchParams()` — a repo-wide grep for `useSearchParams`/`searchParams.get` returns only spin/result, addresses/new and orders/[id]/return. The bag page's only coupon path is its own local `code` state + `applyCoupon()` (bag/page.tsx:47-63), which is seeded from an empty `useState('')`. The query string is therefore parsed by nothing and silently discarded.

**Failure:** Customer wins SPIN-7Q2KX on the wheel, opens Account ▸ Rewards, taps Apply on the coupon card. The browser navigates to /bag?coupon=SPIN-7Q2KX, the bag renders with an empty "Enter coupon code" field, no coupon banner, and the order summary shows no discount. The coupon appears to have been applied (the click did something) but no `applyCoupon` callable ever ran.

**Fix:** In bag/page.tsx read the param (`const preset = useSearchParams().get('coupon')`) inside a `<Suspense>` boundary and, on mount, run the existing `callApplyCoupon(preset, lines)` path (or at minimum `setCode(preset)`), then strip the param via `router.replace('/bag')`.

---

## [HIGH][cross-surface-mismatch] Wallet history rows render a blank title for top-ups, cancellation refunds and spin cashback
**web/src/app/(shop)/account/wallet/page.tsx:188** (area: web-auth-account)

The row is rendered with `title={tx.title}` and `TxRow` prints it raw (components/wallet/TxRow.tsx:44). `WalletTransaction.title` is declared non-optional (packages/shared/src/types/customers.ts:162), but three of the six writers never set it: functions/src/wallet/topup.ts:97-101 (source 'topup') writes only `description: 'Wallet top-up'`; functions/src/orders/cancel.ts:116-126 (source 'refund') writes only `description: 'Refund for cancelled order …'`; functions/src/spin/execute.ts:143-147 (source 'spin_reward' cashback) writes only `description: 'Spin & Win cashback'`. Only checkout.ts, adjust.ts and returns/decisions.ts set `title`. The Flutter app handles this explicitly — app/lib/features/wallet/data/wallet.dart:71-86 has `displayTitle` with a per-source fallback ('Added to wallet', 'Refund · #ORD-…', etc.) — so the two surfaces disagree on the same collection.

**Failure:** Customer tops up ₹500 (verifyTopUp writes the ledger row) and opens Account ▸ Wallet. The row shows the icon and "+₹500.00" with an empty bold title line and only the date underneath; the same transaction reads "Added to wallet" in the app. Identical blank rows appear for every wallet refund from a cancelled order and every spin cashback credit.

**Fix:** Mirror the app's fallback in the web reader — add a `txTitle(tx)` helper in components/wallet/actions.ts switching on `tx.source` (topup/refund/spin_reward/cashback/order_payment/withdrawal/admin_adjust) with `tx.title || tx.description || <source label>` — and/or add the missing `title` field to the three Cloud Function writers.

---

## [HIGH][broken-crud] Web withdrawal always pays the first bank account; no way to pick, default or delete one
**web/src/app/(shop)/account/affiliate/withdraw/page.tsx:29** (area: web-auth-account)

The payout bank is fixed: `bankAccounts.find(b => b.isDefault) ?? bankAccounts[0]`, and `bank.id` is what gets sent to `requestWithdrawal` (line 66). The only bank write in the whole web app is banks/new/page.tsx:61, which hardcodes `isDefault: banks.length === 0` and appends. A repo-wide grep for `bankAccounts` in web/src returns only these three read sites plus affiliate/page.tsx:103 — there is no set-default, no delete, and no selector. Yet the UI offers "Change" (withdraw/page.tsx:156) and "Add new bank account" (affiliate/referral/page.tsx:111), both of which link to /account/banks/new. The Flutter app does have a picker: app/lib/features/affiliate/affiliate_withdraw_screen.dart:266 opens `_pickBank` whenever `banks.length > 1`.

**Failure:** Affiliate saves HDFC ••4821 (becomes isDefault), later closes that account and taps "Change" → adds ICICI ••9930. The new record is written with isDefault:false, so `find(isDefault)` still resolves to HDFC. The withdraw screen keeps showing HDFC, and Confirm withdrawal files a payout to the closed account. The customer can never route money to the new bank from the web.

**Fix:** Add a bank list/selector on the withdraw screen (local `selectedBankId` state seeded from the default, like the app), plus set-default and delete actions that rewrite the `bankAccounts` array — the customers update rule already whitelists `bankAccounts` (firebase/firestore.rules:135).

---

## [HIGH][cross-surface-mismatch] Removing an applied coupon is a no-op server-side — placeOrder auto-applies the best offer anyway and burns a one-time reward
**web/src/app/(shop)/checkout/page.tsx:176** (area: web-catalog-cart)

placeOrder sends `couponCode: draft.coupon?.code ?? null` (line 176). On the server, a null couponCode does not mean "no discount" — it triggers autoBestOffer() (functions/src/orders/checkout.ts:349), which scans promo + personal coupons and applies the largest one, marks a personal coupon `status: 'used'` (line 567) and writes the spin-reward ledger row. The web "Remove" button (line 337) just clears the local draft, and the auto-apply effect is one-shot (`autoTried`, line 89), so the UI then shows and charges no discount while the server does.

**Failure:** Customer has a spin coupon SPIN100 (₹100 off, single use). Checkout auto-applies it, user presses Remove because they want to save it for a bigger order. Summary shows To pay ₹1000. placeOrder sends couponCode null → autoBestOffer picks SPIN100 → order total ₹900 and the coupon is flipped to 'used'. For Razorpay the modal then asks for ₹900, not the ₹1000 shown; the reward the customer explicitly declined is consumed permanently.

**Fix:** Send an explicit "no coupon" signal (e.g. a `noCoupon: true` flag or an empty-string sentinel the server treats as 'skip autoBestOffer'), so an intentional removal suppresses the server-side auto-apply.

---

## [HIGH][cross-surface-mismatch] Web never checks firstOrderOnly / maxUsesPerUser / maxUsesTotal / active, so it auto-applies coupons that placeOrder hard-rejects
**web/src/components/checkout/offers.ts:36** (area: web-catalog-cart)

promoDiscount() (lines 36-51) and listAvailableOffers() (lines 110-126) filter only on status/targetUsers/autoApply/expiry/min. The server's authoritative computeCouponDiscount() additionally rejects on `active === false` (functions/src/orders/checkout.ts:135), `usesCount >= maxUsesTotal` (line 149), per-user redemptions via customers/{uid}/couponUsage (lines 152-155) and `firstOrderOnly` against stats.totalOrders (lines 156-161) — each as a thrown HttpsError, not a silent skip. Because the checkout page auto-applies the best offer into draft.coupon (line 92) and then passes that code explicitly, the strict path always runs.

**Failure:** Seeded WELCOME30 has firstOrderOnly: true and maxUsesPerUser: 1. A returning customer with 3 past orders opens /checkout: WELCOME30 is auto-applied and shown as "Best offer applied". Every "Place order" click fails with 'This coupon is for first orders only.' — the customer cannot check out at all until they discover the Remove link, and the toast never says which coupon is at fault.

**Fix:** Mirror the server's eligibility rules client-side (skip coupons with active===false, usesCount>=maxUsesTotal, firstOrderOnly when the customer has prior orders), and on a placeOrder coupon error clear draft.coupon automatically so the retry can succeed.

---

## [HIGH][broken-crud] Return item picker silently submits the first eligible item when the customer never selects a radio
**web/src/app/(shop)/account/orders/[id]/return/page.tsx:93** (area: web-orders-returns-reviews)

`itemId` initialises to `preItemId ?? ''` (line 84). When the customer arrives via the OrderCard "Return" link there is no `?itemId=` param, so `preItemId` is null and `itemId` is `''`. With more than one eligible item `showPicker` is true (line 125) and every radio renders unchecked. `submit()` then does `const targetItemId = itemId || selectedItem?.id;` (line 93), and `selectedItem` falls through to `eligible[0]` (line 90). Nothing forces a selection and no validation error is raised for an unpicked item — only the reason is validated (line 98).

**Failure:** Delivered order with 3 items. Customer clicks "Return" on the order card, the picker lists all 3 with none selected, they scroll past it, choose reason "Item damaged", and hit Submit. A return request is created against item #1 (the first in the array) instead of the item they meant. The toast says "Return request submitted." and the wrong item is stamped `returnStatus: 'requested'`, blocking a fresh request for it while the actually-damaged item is still marked returnable.

**Fix:** When `showPicker` is true, require an explicit selection: default `itemId` to `eligible[0].id` (and render that radio checked) or add `if (!itemId) { toast.error('Select an item to return.'); return; }` before the reason check.

---

## [HIGH][broken-crud] Return page treats items with a missing returnStatus as already-returned, dead-ending legacy orders
**web/src/app/(shop)/account/orders/[id]/return/page.tsx:80** (area: web-orders-returns-reviews)

`eligible` is `items.filter((it) => it.returnStatus === 'none' || it.returnStatus === 'rejected')` — an item whose `returnStatus` field is absent is excluded. Every other surface treats absent as eligible: `hasReturnableItem` in web/src/components/account/orders.ts:242 is `!x.returnStatus || x.returnStatus === 'none' || x.returnStatus === 'rejected'`, and the server (functions/src/returns/requests.ts:64) gates on `if (it.returnStatus && it.returnStatus !== 'none' && it.returnStatus !== 'rejected')`. The legacy `orders/{id}/items` subcollection path in `useOrderItems` exists precisely for pre-migration orders, which are the ones most likely to lack the field.

**Failure:** A pre-migration delivered order whose subcollection items have no `returnStatus` key. `useOrderItems` loads 2 items from the subcollection; `eligible` is empty while `items.length > 0`, so the page renders the terminal message "Every item in this order already has a return in progress. Check the order for its status." (line 117-123). No form, no way forward — even though the server would happily accept the request and the order detail badge shows no active return.

**Fix:** Change the filter to `!it.returnStatus || it.returnStatus === 'none' || it.returnStatus === 'rejected'`, reusing the existing `hasReturnableItem` predicate so all three surfaces agree.

---

## [HIGH][broken-crud] placeOrder writes the `variants` array twice from the same pre-write snapshot when a cart holds two variants of one product, dropping the first variant's stock decrement
**functions/src/orders/checkout.ts:437** (area: backend-functions)

`priced` maps 1:1 to the client's `lines`, and the cart keys lines by (productId, variantId) — see `web/src/lib/cart.ts:42-43` (`sameLine = a.productId === productId && a.variantId === variantId`) — so two variants of the same product are two separate lines with the same `productId`. Line 403 then does `Promise.all(priced.map(l => tx.get(db.doc('products/'+l.productId))))`, producing two independent snapshots of the *same* document, both holding the pre-transaction `variants` array. The forEach at 428-442 rebuilds `variants` from its own snapshot each iteration (line 433 `((p.variants) ?? []).map(v => ({...v}))`) and issues a second full-array `tx.update` at line 437. The two writes target one document in one transaction: the later whole-array write overwrites the earlier one, so only the last variant's decrement survives (and if the backend instead rejects two writes to one doc per transaction, checkout fails outright for such carts). Meanwhile `stock: FieldValue.increment(-qty)` is a transform and accumulates for both lines, so the top-level aggregate and the variants array also diverge. `orders/cancel.ts:88-96` restocks with the identical pattern and has the same defect in reverse.

**Failure:** Product P has variants S (stock 1) and M (stock 1). Customer adds 1× S and 1× M to the bag (two cart lines, same productId) and checks out. Both stock checks pass (each reads the original snapshot). The write for line S sets variants=[S:0, M:1]; the write for line M then sets variants=[S:1, M:0] and wins. Variant S is still shown as in stock and can be sold again — oversell of a physically shipped unit. Top-level `stock` drops by 2 while the variants array only reflects 1.

**Fix:** Deduplicate by productId before the transaction: group all lines of a product, read the doc once, apply every line's decrement to a single `variants` copy, and issue exactly one `tx.update` per product document (the same grouping `catalog/inventory.ts:35-41` already does). Apply the identical fix to the restock loop in `orders/cancel.ts:82-103`.

---

## [HIGH][broken-crud] placeOrder validates and consumes coupons outside the transaction, so a single-use spin coupon can be spent on two concurrent orders
**functions/src/orders/checkout.ts:347** (area: backend-functions)

`computeCouponDiscount` / `autoBestOffer` run at lines 347-349, before `db.runTransaction` opens at line 372. They read `customers/{uid}/coupons/{id}` (line 180-186: `status !== 'active'` check) and the promotional coupon's `usesCount` / per-user counter (lines 149-155) with plain non-transactional gets. Inside the transaction the coupon documents are never re-read: line 568 does a blind `tx.update(...{status:'used'...})` on the personal coupon, and lines 605-613 blindly increment `coupons/{id}.usesCount` and `customers/{uid}/couponUsage/{id}.count`. Because neither coupon doc is part of the transaction's read set, two overlapping placeOrder invocations do not contend on it and both commit. The idempotency key at line 370 does not help — it is derived from the cart/addressId or a client nonce, and two different carts (or two different client nonces) produce different keys.

**Failure:** Customer wins SPIN-ABCDE (flat ₹500 off, `maxUsesPerCoupon: 1`, status 'active') from the wheel. They open the web checkout in two tabs with different carts, enter SPIN-ABCDE in both, and press Place order within the same second. Both calls read status 'active' at line 184 and both pass; both transactions commit; both orders receive the ₹500 discount and both write `status:'used'` on the same coupon doc. ₹500 is given away twice. The same window lets a promotional coupon with `maxUsesTotal: 100` be redeemed past 100, since `usesCount` is read at line 149 outside the transaction.

**Fix:** Move the coupon document read inside the transaction: after resolving the coupon id outside (a query cannot run in a transaction), `tx.get` the coupon doc (`customers/{uid}/coupons/{id}` or `coupons/{id}` plus `customers/{uid}/couponUsage/{id}`) as part of the read phase, re-assert `status === 'active'` / `usesCount < maxUsesTotal` / per-user count against those fresh values, and recompute the discount from them before any write.

---

## [HIGH][broken-crud] createRazorpayOrder and verifyPayment never check the order's status, so a gateway payment can be captured against an already-cancelled order
**functions/src/orders/checkout.ts:713** (area: backend-functions)

`createRazorpayOrder` (lines 654-682) validates only `snap.exists`, `o.customerId === uid` and `amount > 0`; it never inspects `o.status` or `o.paymentStatus`. `verifyPayment` (lines 692-734) validates ownership, that `razorpayOrderId` matches, and short-circuits only when `paymentStatus === 'captured'` (line 713) — a cancelled order carries `status: 'cancelled'` and `paymentStatus: 'refunded'` or `'pending'` (set by `orders/cancel.ts:151`), neither of which is caught. verifyPayment then unconditionally stamps `paymentStatus: 'captured'` and `amountPaidPaise: totalPaise` (lines 725-731) on the cancelled order. Nothing anywhere reverses that: `performCancellation` refuses to run again (`cancel.ts:56-58` throws 'already cancelled'), so the gateway money has no path back to the customer.

**Failure:** Customer places a ₹4,000 razorpay order; `placeOrder` returns with paymentStatus 'pending' and the Razorpay sheet opens. The customer leaves the sheet open. An admin, seeing an unpaid order, cancels it from the Orders screen — `adminChangeOrderStatus` → `performCancellation` restores stock, refunds only the wallet portion, sets status 'cancelled'. The customer then completes payment in the still-open sheet; the client calls `verifyPayment`, the signature is valid, and the function writes paymentStatus 'captured' / amountPaidPaise 400000 onto the cancelled order. The customer is charged ₹4,000, receives nothing, and no refund is ever triggered. The same gap lets `createRazorpayOrder` be called again on an already-captured order and charge the customer a second time.

**Fix:** In `createRazorpayOrder`, reject when `o.status === 'cancelled'` or `o.paymentStatus === 'captured'/'refunded'`, and reuse an existing `o.razorpayOrderId` instead of overwriting it. In `verifyPayment`, reject (or auto-refund via the Razorpay refunds API) when `o.status === 'cancelled'` or `o.paymentStatus === 'refunded'` before writing the capture.

---

## [HIGH][incomplete] adminChangeOrderStatus confirms affiliate commissions after the transaction commits, and the delivered→delivered transition is illegal, so a failure strands the commission as 'pending' forever
**functions/src/orders/status.ts:99** (area: backend-functions)

The status transition commits in the transaction at lines 63-95. Only afterwards, at line 99, does the handler call `await confirmCommissionsForOrder(orderId)` — outside that transaction and with no try/catch. `confirmCommissionsForOrder` (affiliate/commissions.ts:107-136) performs its own query plus a second transaction that touches the affiliate's customer doc, so it can fail on contention, a Firestore deadline, or a missing index. When it throws, the error propagates out of the callable, `ref.update({affiliateCommissionStatus:'confirmed'})` at line 100 never runs, and `writeAudit` at line 103 never runs either. The admin sees the call fail and retries — but the order is already 'delivered' and `TRANSITIONS.delivered = []` (line 20), so the retry throws 'Cannot move delivered → cancelled/delivered'. There is no other caller of `confirmCommissionsForOrder` anywhere in the codebase and no scheduled reconciliation (scheduled/sweeps.ts only sweeps coupons), so the commission has no second chance.

**Failure:** Admin marks order #BRK-48123 (₹10,000, referred by affiliate A, ₹500 pending commission) delivered. The status transaction commits; `confirmCommissionsForOrder` then contends with a concurrent `placeOrder` accruing on the same affiliate doc and aborts. The admin sees 'internal error', clicks Delivered again and gets 'Cannot move delivered → delivered'. Affiliate A's ₹500 stays in `affiliate.pendingBalancePaise` and never reaches `confirmedBalancePaise` — the withdrawable balance — so it can never be withdrawn, and no audit log records the delivery.

**Fix:** Either fold the commission clearance into the same transaction as the status flip (read the pending commission docs before opening it, as `performCancellation` already does at cancel.ts:37-40), or wrap line 99 in a try/catch that logs and still writes the audit entry, and add a self-transition or a reconciliation sweep so 'delivered' orders with `affiliateCommissionStatus === 'pending'` can be re-confirmed.

---

## [HIGH][broken-crud] Review moderation writes products/{id}, which is gated by the products module, so a reviews-only sub-admin cannot approve anything
**admin/src/features/reviews/api/reviews.ts:64** (area: backend-rules-indexes)

`moderateReview` runs one transaction that updates BOTH the review (line 50, `tx.update(rRef, {status, moderatedBy, moderatedAt, updatedAt})`) and the product aggregate (line 64, `tx.update(pRef, { ratingCount: newCount, rating: newRating })`). firebase/firestore.rules:51 gates `products` writes on `canWrite('products')` — i.e. products.create|edit|delete — while `reviews` moderation is a separate module (`reviews` is its own MODULE_KEY, packages/shared/src/enums.ts:258). A Firestore transaction is all-or-nothing: if the product write is denied the review status update is rolled back too. The catch in the caller surfaces only a generic toast, so the moderator sees a failure with no explanation and the review stays pending.

**Failure:** Sub-admin granted `reviews: view/edit/approve` but not `products: edit` opens /reviews and clicks Approve on a pending review. The transaction commit is rejected with permission-denied on `products/{productId}`; the review remains 'pending' and the product rating never updates. Approving reviews is impossible for that admin.

**Fix:** Either move the rating-aggregate write server-side into a `moderateReview` callable that uses `requireModule(req,'reviews','approve')`, or extend the products rule to also accept `canWrite('reviews')` when the diff is limited to `['rating','ratingCount']`.

---

## [HIGH][cross-surface-mismatch] Web checkout offer list uses the same wrong promo-coupon field names, so applying an offer makes placeOrder fail
**web/src/components/checkout/offers.ts:42** (area: cross-surface-shapes)

`promoDiscount()` (line 42) and `listAvailableOffers()` (line 115) gate on `c.minOrderPaise`, `c.expiresAt`, `c.maxDiscountPaise` — none of which the admin writes (see `saveCoupon`, which writes `minCartValuePaise`, `validUntil`, `discountMaxCapPaise`). So every promo coupon is displayed as `qualifies: true` with `sub: 'On any order'` regardless of its real minimum, and expired ones are still listed. `web/src/app/(shop)/checkout/page.tsx:103` (`applyOffer`) then stuffs that offer straight into the local draft with no server round-trip, and `placeOrder` re-validates through `computeCouponDiscount`, which DOES read `minCartValuePaise` (checkout.ts:143) and throws. The Flutter app's equivalent (app/lib/features/checkout/data/offers.dart:53) reads both name variants, so app and web disagree about the same coupon doc.

**Failure:** Coupon FEST20 has minCartValuePaise = ₹2,000. Customer with a ₹600 cart opens web checkout: FEST20 is listed as qualifying with the full discount and is even auto-applied by `bestOfferForCart`. Tapping 'Place order' calls placeOrder, which throws failed-precondition 'Your cart does not meet this coupon's minimum.' The order can never be placed until the customer manually removes the auto-applied coupon.

**Fix:** Change `PromoCoupon` and both readers to `minCartValuePaise`, `validUntil`, `discountMaxCapPaise` (keeping the legacy names only as fallbacks, as offers.dart does), and validate a tapped offer through `callApplyCoupon` before storing it in the draft.

---

## [HIGH][cross-surface-mismatch] Return window is hardcoded to 3 days server-side, ignoring settings/returns.windowDays that the admin sets and the web enforces
**functions/src/returns/requests.ts:42** (area: cross-surface-shapes)

`requestReturnOrReplacement` hardcodes `RETURN_WINDOW_MS = 3 * 24 * 60 * 60 * 1000` and rejects anything older (line 44). It never reads `settings/returns`. Meanwhile admin/src/features/settings/routes/StorefrontTab.tsx:295 lets an admin save `settings/returns.windowDays` (0-90, default 7) via `saveReturns`, and web/src/components/account/orders.ts:261 `returnWindow()` uses that value — falling back to `DEFAULT_RETURN_WINDOW_DAYS = 7` (line 246) — to decide whether to show the 'Return item' button and the 'N days left' copy (web/src/app/(shop)/account/orders/[id]/page.tsx:71). The Flutter app hardcodes its own third value, `returnWindowDays = 3` (app/lib/features/orders/data/order.dart). So three surfaces disagree, and the admin setting is write-only.

**Failure:** Admin sets the return window to 7 days (or leaves settings/returns unset, so the web default of 7 applies). An order delivered 5 days ago shows 'Return item · 2 days left' on the web account page. The customer fills in the reason and submits; requestReturnOrReplacement throws failed-precondition 'The 3-day return window for this order has closed.' No return can ever be created between day 3 and day 7. Conversely, setting windowDays = 0 to disable returns still lets the CF accept returns for 3 days.

**Fix:** Read `settings/returns.windowDays` inside `requestReturnOrReplacement` (defaulting to the same 7 the web uses) and use it for the window check; have the Flutter `Order.canReturn` fetch the same setting instead of its hardcoded 3.

---

## [HIGH][broken-crud] The `payments` collection is never written by any Cloud Function — the admin Payments module only ever shows seeded rows
**admin/src/features/payments/api/payments.ts:9** (area: cross-surface-shapes)

`usePaymentsList()` subscribes to `collection(db,'payments')` and PaymentsListPage renders/exports from it (including the 'GST invoices' CSV of captured payments, PaymentsListPage.tsx:56). Nothing writes that collection: grepping functions/src for `payments` yields only `requireModule(req,'payments','view')` in orders/invoice.ts. `placeOrder` (functions/src/orders/checkout.ts:546) writes only the order doc, `verifyPayment` (line 725) only patches the order, and `topUpWallet`/`verifyTopUp` only write walletTransactions. The single writer in the repo is scripts/seed.ts:684. The shared `Payment` type and the read rule `match /payments/{id} … isOwner(resource.data.customerId)` (firebase/firestore.rules:76) exist for documents nothing creates.

**Failure:** On a fresh (unseeded) project, a customer places and pays for 50 razorpay orders. The admin opens Payments: the list is empty, month-to-date total is ₹0 and 'failed' is 0, and 'Export GST invoices' reports 'Nothing to export' — while Orders shows all 50 as Paid.

**Fix:** Write a `payments/{id}` doc inside the placeOrder transaction and update it in verifyPayment (id/orderId/customerId/method/gateway/status/amountPaise/gatewayRef/createdAt), or drop the Payments module and derive it from `orders`.

---

## [HIGH][cross-surface-mismatch] firstOrderOnly coupon check reads customers.stats.totalOrders, a field no surface writes
**functions/src/orders/checkout.ts:158** (area: cross-surface-shapes)

`computeCouponDiscount` gates first-order-only coupons on `Number((cust.get('stats'))?.totalOrders ?? 0) > 0`. The shared `CustomerStats` type (packages/shared/src/types/customers.ts:93) and every writer — web/src/lib/customerDoc.ts:62, app/lib/features/auth/data/auth_repository.dart:244, scripts/seed.ts:465 — use `ordersCount`. `totalOrders` only exists as a locally-computed dashboard field (admin/src/features/dashboard/api/dashboard.ts:23), never on a customer doc, so the expression is always 0 and the guard never trips. Compounding it, nothing ever increments `stats.*` after signup either (no `stats.` write exists anywhere in functions/src), so even the correctly-named `ordersCount` stays 0 — which is why admin/src/features/customers/routes/CustomersListPage.tsx:125 shows 'Orders: 0' for every real customer.

**Failure:** Admin creates WELCOME15 with targetUsers = 'new' (saveCoupon sets firstOrderOnly: true, maxUsesPerUser: 1). A customer with 40 previous orders enters WELCOME15 at checkout: the firstOrderOnly guard reads undefined → 0 → passes, and the discount is granted. Separately, that customer's row in the admin Customers list and its CSV export both report 0 orders.

**Fix:** Read `stats.ordersCount` in the guard, and increment `stats.ordersCount`/`ordersDelivered`/`totalSpentPaise`/`lastOrderAt` on the customer doc inside the placeOrder and adminChangeOrderStatus transactions.

---

## [MEDIUM][perf] Variant delete-safety downloads the entire products collection once per unit, so deleting a group with N units triggers N full-collection reads
**admin/src/features/settings/api/variables.ts:67** (area: admin-catalog)

`countProductsUsingUnit` does `getDocs(collection(db, 'products'))` — an unbounded, unfiltered read of every product document — and then scans `variants[].attributes` client-side. VariablesTab.tsx:119-126 calls it in a serial `for (const u of delTarget.units)` loop before deleting a variant, and AddUnitsModal.tsx:77 calls it again on every individual chip removal. There is no caching, no `limit`, and no reuse of the already-live products listener (`useProductsList` / PRODUCTS_KEY) that the admin app maintains elsewhere.

**Failure:** With a 2,000-product catalogue, an admin deletes the "Size" group which holds 8 units (XS…XXL). VariablesTab.confirmDelete awaits 8 sequential full-collection downloads = 16,000 document reads and tens of seconds of blocked UI before the delete happens (and it aborts on the first in-use unit, after already paying for the earlier scans). Removing 3 colour chips one at a time costs another 6,000 reads.

**Fix:** Fetch the products once (or read from the already-subscribed PRODUCTS_KEY cache via `getCachedList<Product>`), build a Set of all attribute values in use, and answer every unit check from that one pass; pass the whole unit-id list to a single `countUnitsInUse(ids)` helper for the group-delete case.

---

## [MEDIUM][broken-crud] Saving a product writes back the rating aggregate captured when the form opened, silently reverting review approvals
**admin/src/features/products/routes/ProductFormPage.tsx:222** (area: admin-catalog)

`rating`/`ratingCount` are initialised once from the seed/loaded doc (lines 96-97, 126-127) and unconditionally written on every save (lines 222-223 → products.ts:130-131, included in `base` for the `updateDoc` path). But those same two fields are a derived aggregate maintained transactionally by review moderation: admin/src/features/reviews/api/reviews.ts:59-64 recomputes `ratingCount` and `rating` inside `runTransaction` on approve/reject. The product form's blind overwrite is not part of that transaction and has no read-back, so it is a classic lost update.

**Failure:** Product has 12 approved reviews (rating 4.3, ratingCount 12). Admin A opens the product edit form. Admin B approves a 5-star review → the transaction writes rating 4.36→4.4, ratingCount 13. Admin A fixes a typo in the description and clicks Save → rating 4.3 / ratingCount 12 are written back, dropping the new review from the aggregate. If B later rejects that review, `moderateReview` subtracts it a second time, leaving rating/ratingCount permanently below the true value.

**Fix:** Drop `rating`/`ratingCount` from `ProductFormValues` and from `base` in `saveProduct` on the edit path (leave them only in the `isNew` seed block), or make the fields write-only-when-dirty and perform the write inside a transaction that re-reads the current aggregate.

---

## [MEDIUM][cross-surface-mismatch] bestSellerOrder is re-stamped with Date.now() on every save, reshuffling the storefront Best-sellers rail on unrelated edits
**admin/src/features/products/api/products.ts:132** (area: admin-catalog)

`bestSellerOrder: values.isBestSeller ? Date.now() : null` sits in `base`, which is written on BOTH the create and the edit path (lines 138 and 165). The comment three lines above says "Order stamped when first flagged", but the code re-stamps unconditionally. web/src/app/(shop)/page.tsx:28-29 renders the rail as `products.filter(p => p.isBestSeller).sort((a,b) => (a.bestSellerOrder ?? 1e9) - (b.bestSellerOrder ?? 1e9))` — ascending, i.e. earliest-stamped first — and firestore.indexes.json carries a dedicated `status + isBestSeller + bestSellerOrder ASC` index for it.

**Failure:** Five best sellers are curated in a deliberate order. The merchandiser opens the first one (bestSellerOrder = 1 Jun) to fix a spelling mistake in its description and saves. Its bestSellerOrder becomes today's epoch — the largest value — so on the next home-page load it jumps from position 1 to position 5. Any routine edit silently reorders the rail, and there is no UI to restore the intended order.

**Fix:** Only stamp when the flag transitions off→on: `bestSellerOrder: values.isBestSeller ? (existing?.bestSellerOrder ?? Date.now()) : null`, passing the loaded product's current value through `ProductFormValues` (the form already keeps it in `existingRef.current`).

---

## [MEDIUM][security] stockAdjustments create rule only checks isAdmin(), bypassing the inventory.edit module gate the rest of the file enforces
**firebase/firestore.rules:215** (area: admin-inventory)

Every other directly-written admin collection is gated with `can(module, action)` / `canWrite(module)` (e.g. products on line 51 uses `canWrite('products')`), and the comment on lines 15-19 states this is deliberate so "a sub-admin with only dashboard.view" cannot write. The stockAdjustments rule requires only `isAdmin() && request.resource.data.adminUid == uid()` - no `can('inventory','edit')` check and no validation of before/delta/after/productId. The stock mutation itself is correctly protected (requireModule(req,'inventory','edit') in functions/src/catalog/inventory.ts:26), but the audit trail that admins read in StockHistoryModal is not. The collection is append-only (`allow update, delete: if false`), so forged rows can never be removed.

**Failure:** A sub_admin whose modulePermissions contain only {dashboard:{view:true}} opens the browser console and writes to stockAdjustments with their own uid: {productId:'p1', before:200, delta:-180, after:20, reason:'Damage', adminName:'Someone Else'}. The write succeeds. The Stock history modal for p1 now permanently shows a fabricated 180-unit shrinkage attributed to a chosen name, and it can never be deleted.

**Fix:** Change the rule to `allow create: if can('inventory','edit') && request.resource.data.adminUid == uid();` and add shape validation (numeric before/delta/after, adminName matching adminDoc().name).

---

## [MEDIUM][cross-surface-mismatch] Seeded ops sub-admin is granted a non-existent `returns` module, so the real `refunds` module is all-false — Refunds is hidden and approve/reject is permission-denied
**scripts/seed.ts:121** (area: admin-returns-payments)

`scopedPerms(['dashboard','orders','customers','payments','returns'])` builds permissions by iterating `MODULE_KEYS` and testing `modules.includes(m)` (seed.ts:46-50). `MODULE_KEYS` contains `'refunds'`, not `'returns'` (packages/shared/src/enums.ts:262, with the comment "was 'replacement', then 'returns' — renamed"). So the doc gets `modulePermissions.refunds = ALL_ACTIONS_FALSE` and the `'returns'` string is silently dropped. The admin sidebar gates on `admin?.modulePermissions?.[item.module]?.view === true` (admin/src/components/layout/Sidebar.tsx:12), and both callables call `requireModule(req,'refunds','approve')` (functions/src/returns/decisions.ts:15 and :133).

**Failure:** Sign in to the admin panel as ops@barkath.app (sub_admin). The 'Refunds' nav item is missing entirely. Navigating directly to /refunds still renders the page (there is no route-level permission guard) and the list loads because firestore.rules:90-92 only requires isAdmin(); clicking 'Approve & refund' then fails with 'Missing refunds.approve permission.' The operator role intended to handle returns cannot handle any return.

**Fix:** Change the seeded module list to `'refunds'` (and add a route-level permission guard so a module the sidebar hides is not reachable by URL with working-looking buttons).

---

## [MEDIUM][dead-button] `settings/returns.autoRefundToWallet` is a dead toggle — no code ever reads it
**admin/src/features/settings/routes/StorefrontTab.tsx:329** (area: admin-returns-payments)

The Storefront settings tab renders a Toggle bound to `autoRefundToWallet` and persists it via `saveReturns({ id:'returns', windowDays: days, autoRefundToWallet })` (StorefrontTab.tsx:296). Grepping the entire repo for `autoRefundToWallet` yields only: the shared type (packages/shared/src/types/settings.ts:84), this component, and the two seed scripts. `functions/src/returns/decisions.ts` never reads `settings/returns`; it always branches on `const toWallet = (r.refundMethod ?? 'wallet') === 'wallet'` (decisions.ts:77), and `requestReturnOrReplacement` hardcodes `refundMethod: 'wallet'` on every request (requests.ts, orderRequests payload). So `toWallet` is always true.

**Failure:** An admin turns 'Auto-refund to wallet' OFF and saves (toast confirms success). They then approve a return: `adminApproveOrderRequest` still credits `customers/{uid}.wallet.balancePaise` and writes a `walletTransactions` credit exactly as before. The setting has zero effect and there is no other refund path in the codebase.

**Fix:** Either have `adminApproveOrderRequest` read `settings/returns.autoRefundToWallet` and, when false, leave the request at an 'approved, awaiting manual payout' state without crediting the wallet, or remove the toggle.

---

## [MEDIUM][incomplete] GST invoice omits the COD surcharge line, so the printed line items do not sum to the printed Total
**functions/src/orders/invoice.ts:46** (area: admin-returns-payments)

The totals table emits only Subtotal, Discount, Delivery, GST and Total (invoice.ts:46-50). The order total is computed as `totalPaise = net + deliveryPaise + codSurchargePaise + taxPaise` (functions/src/orders/checkout.ts:291) and `codSurchargePaise` is persisted on the order (checkout.ts:504-ish, `codSurchargePaise: summary.codSurchargePaise`). Because the surcharge is never printed, a COD invoice's visible arithmetic is off by exactly `codSurchargePaise`. This document is shipped to the customer as a tax invoice via `invoiceUrl` (web/src/app/(shop)/account/orders/[id]/invoice/page.tsx:108 and app/lib/features/orders/invoice_screen.dart:24).

**Failure:** settings/delivery.codSurchargePaise = 3000. A COD order: subtotal ₹890, discount ₹0, delivery ₹50, GST ₹0, codSurcharge ₹30 -> totalPaise = ₹970. The generated invoice prints Subtotal ₹890.00, Discount -₹0.00, Delivery ₹50.00, GST ₹0.00, Total ₹970.00 — the lines add to ₹940 and the customer/auditor sees an unexplained ₹30.

**Fix:** Add `<tr><td>COD charges</td><td class="r">${inr(o.codSurchargePaise)}</td></tr>` (rendered only when > 0) before the GST row, and consider an informational 'Paid by wallet' line for `o.walletUsedPaise`.

---

## [MEDIUM][missing-state] publishedAt is stamped at product creation even for drafts, so a product drafted more than 3 days before going live never enters New Arrivals
**admin/src/features/products/api/products.ts:160** (area: admin-growth)

On create, saveProduct writes `publishedAt: serverTimestamp()` unconditionally (line 160) regardless of `values.status` ('draft' or 'published'). On update the `base` payload (lines 100-134) contains `status` but never `publishedAt`, so publishing a draft never refreshes it. Both storefronts derive New Arrivals purely from that timestamp: web/src/lib/catalog.ts:44-63 (`publishedAt ?? createdAt`, 3-day window) and app/lib/features/catalog/data/catalog_repository.dart:190-194 (`publishedAtMillis >= now - 3d`). The comment at products.ts:120-122 states new arrivals is automatic with no admin flag, so there is no manual override.

**Failure:** Buyer creates 20 Eid products as drafts on 1 July (each gets publishedAt = 1 July), finishes photography and flips them all to Published on 10 July. On both web and app the New Arrivals rail stays empty — the products are already 9 days past their recorded publish date and aged out before they were ever visible. There is no admin control to fix it short of deleting and recreating each product.

**Fix:** Write `publishedAt: values.status === 'published' ? serverTimestamp() : null` on create, and in the update path set `publishedAt: serverTimestamp()` when the status transitions from a non-published state to 'published' (leave it untouched otherwise).

---

## [MEDIUM][cross-surface-mismatch] Deep-link type "Custom URL" is offered and required by admin but is a no-op in the app inbox
**admin/src/features/notifications/api/notifications.ts:123** (area: admin-spin-notif)

DEEP_LINK_TYPES exposes `url`, and NotificationCreatePage.tsx:80 hard-requires a value for it ("Enter a URL to link to.") before the broadcast can be sent; the CF stores it as deepLink {type:'url', target:'https://…'} (functions/src/notifications/broadcast.ts:57). The app inbox parses the object correctly (app/lib/features/notifications/data/app_notification.dart:55-72) but its tap handler only switches on 'product', 'category' and 'home' — 'url' falls into `default: break;` (app/lib/features/notifications/notifications_screen.dart:179-181). No other surface consumes the notification deep link.

**Failure:** Admin sends "Eid sale is live" with deep link Custom URL → https://barkath.in/eid. A customer taps the notification card in the app: it is marked read and absolutely nothing else happens — no navigation, no browser, no error.

**Fix:** Either handle type 'url' in _onTap (url_launcher is already a dependency, used by the Help centre) or drop 'url' from DEEP_LINK_TYPES so admins cannot pick a destination that no client can open.

---

## [MEDIUM][missing-state] broadcasts.opened is written once as 0 and never updated, so the Opened column is always 0
**functions/src/notifications/broadcast.ts:46** (area: admin-spin-notif)

The CF sets `opened: 0` at create; firestore.rules:221 makes broadcasts CF-write-only (`allow write: if false`) and no function ever updates the doc afterwards. The per-user inbox docs carry `broadcastId` (line 58) but the app's read-receipt path only flips `read` on customers/{uid}/notifications (app/lib/features/notifications/notifications_screen.dart:165 → markRead, permitted by firestore.rules:166-169) and never touches the broadcast aggregate. The admin list renders an "Opened" column from this field (NotificationsListPage.tsx:101).

**Failure:** Admin sends a broadcast to 12,000 users; 4,000 open it in the app. The Push-notifications table permanently shows Sent 12,000 / Opened 0, so campaign effectiveness reads as zero for every broadcast ever sent.

**Fix:** Either aggregate opens server-side (a Firestore trigger on customers/{uid}/notifications update that increments broadcasts/{broadcastId}.opened when read flips to true) or remove the Opened column rather than displaying a metric that is structurally always 0.

---

## [MEDIUM][cross-surface-mismatch] Spin cashback wallet ledger row records balanceAfterPaise: 0
**functions/src/spin/execute.ts:144** (area: admin-spin-notif)

Every other writer of customers/{uid}/walletTransactions stores the real post-transaction balance — wallet/topup.ts:98, wallet/adjust.ts:57, orders/cancel.ts:121, orders/checkout.ts:581, returns/decisions.ts:89. executeSpin hardcodes `balanceAfterPaise: 0` on the spin_reward credit even though it increments wallet.balancePaise by the same amount two lines earlier (line 114). The value is computable here: the transaction already has custSnap, so `Number(custSnap.get('wallet.balancePaise') ?? 0) + cashbackAmt` is available.

**Failure:** Customer with ₹800 in wallet wins ₹50 spin cashback. The wallet balance correctly becomes ₹850, but the ledger row for that credit claims the running balance was ₹0 — any reconciliation, export or future running-balance display over walletTransactions breaks at every spin-reward row, and the ledger contradicts the customer doc.

**Fix:** Compute the post-credit balance from the customer snapshot already read in the transaction and store it, matching the other five wallet writers.

---

## [MEDIUM][dead-button] "Enable affiliate wallet access" toggle is a no-op — walletEnabled is sent, validated, then discarded
**admin/src/features/affiliate/routes/AllocateAffiliatePage.tsx:115** (area: admin-affiliate)

The Toggle drives `walletEnabled` state (line 33), which is forwarded through `allocateAffiliate({ uid, commissionRate, walletEnabled })` (line 55, api/affiliate.ts:58-65) into the callable. functions/src/affiliate/withdrawals.ts:20 accepts `walletEnabled: z.boolean().optional()` in the schema but line 23 destructures only `{ uid, commissionRate }` — the value is never written to the affiliate map (lines 32-42) and no field named `walletEnabled` exists anywhere on customer docs (repo-wide grep only hits `settings/paymentGateway.walletEnabled`, an unrelated checkout flag). The confirm dialog at line 130 even promises "and affiliate wallet access".

**Failure:** Admin allocates an affiliate with the wallet toggle OFF and confirms a dialog saying wallet access is withheld. The server grants full affiliate access anyway; the affiliate's wallet screen and requestWithdrawal work exactly as if it were ON. There is no state at all that reflects the toggle.

**Fix:** Either persist it (`affiliate.walletEnabled: parsed.data.walletEnabled ?? true` in adminAllocateAffiliate, and gate requestWithdrawal on it) or remove the toggle and the payload field plus the dialog copy that references it.

---

## [MEDIUM][dead-button] 'Auto-refund to wallet' toggle in Settings writes a field no code ever reads
**admin/src/features/settings/routes/StorefrontTab.tsx:296** (area: admin-settings-auth)

`saveReturns({ id: 'returns', windowDays: days, autoRefundToWallet })` persists `settings/returns.autoRefundToWallet`. Grepping every surface (functions/src, web/src, app/lib) for `autoRefund` returns only this writer, the type declaration (packages/shared/src/types/settings.ts:84) and the seeds. functions/src/returns/decisions.ts — the approval path — never loads `settings/returns`; it unconditionally takes `const toWallet = (r.refundMethod ?? 'wallet') === 'wallet'` (line 77) and `refundMethod` is itself hardcoded to `'wallet'` when the request is created (functions/src/returns/requests.ts:113). So the toggle can only ever be 'on' in effect.

**Failure:** An admin turns 'Auto-refund to wallet' off, expecting approved returns to stop crediting the wallet and to be settled manually. They see 'Return settings saved'. The next approved return still credits the customer's wallet and writes a walletTransactions ledger entry (decisions.ts:84-98), because no code path consults the flag.

**Fix:** Either read `settings/returns.autoRefundToWallet` in adminApproveOrderRequest and branch the refund method on it, or remove the toggle from the Storefront tab until the server honours it.

---

## [MEDIUM][missing-state] admins.lastActiveAt / lastLoginAt are rendered but nothing ever updates them
**admin/src/features/subadmin/routes/SubAdminListPage.tsx:144** (area: admin-settings-auth)

The Sub Admin table shows `timeAgo(a.lastActiveAt?.toDate?.())` and the profile sheet shows `Last login: {dateShort(admin.lastLoginAt?.toDate?.())}` (admin/src/features/account/AccountDialogs.tsx:95). Both fields are written exactly once, at creation: functions/src/admin/subAdmins.ts:44 sets `lastLoginAt: null, lastActiveAt: now`, and scripts/seed.ts:88-89 does the same. A full grep of admin/src, functions/src and scripts finds no other writer. The client cannot patch them either — firebase/firestore.rules:192 makes `/admins/{uid}` `write: if false` — and `signInAdmin` (admin/src/features/auth/api/auth.ts:18) performs no write on a successful login.

**Failure:** A sub-admin created six months ago and signing in daily still shows 'Last active: 6 months ago' in the Sub Admin table, and their Profile dialog shows 'Last login: —' forever. A super admin auditing who is still using the console gets data that is guaranteed wrong, and cannot tell a dormant account from an active one.

**Fix:** Stamp `lastLoginAt`/`lastActiveAt` server-side — e.g. a small `touchAdminSession` callable guarded by requireAdmin that updates the caller's own admins doc, invoked from signInAdmin (and on route changes if 'last active' is meant to be live).

---

## [MEDIUM][missing-state] Dashboard KPI aggregate fallback silently caps at 500/1000 docs, producing wrong lifetime revenue and AOV
**admin/src/features/dashboard/api/dashboard.ts:49** (area: admin-dashboard-reports)

sumTotalPaise catches ANY error from getAggregateFromServer and falls back to `getDocs(query(..., limit(500)))` (line 49); countOrders falls back to `limit(1000)` (line 59). The catch is unqualified, so a transient failure, an unsupported aggregate path, or the emulator case named in the comment all silently return a partial number with no error surfaced. The two fallbacks use different caps, so the AOV numerator and denominator are truncated inconsistently at line 110 (`lifetimeRevenue / totalOrders`). Note the fallback for the lifetime sum has no orderBy, so the 500 documents it picks are arbitrary.

**Failure:** Store has 3,000 orders averaging ₹2,000. Aggregates fail once → lifetimeRevenue = sum of an arbitrary 500 orders (~₹10,00,000), totalOrders = 1,000 (capped). Avg order value renders ₹1,000 — half the true value — and "Total orders" reads 1,000 instead of 3,000, with no error indicator anywhere on the page.

**Fix:** Only fall back for the specific unimplemented-aggregate error; otherwise rethrow so react-query surfaces isError. If a fallback runs, page through with startAfter until exhausted rather than truncating, or mark the KPI as approximate in the returned object so the card can say so.

---

## [MEDIUM][incomplete] Category performance panel is hardcoded to four seed category ids and ignores the categories collection
**admin/src/features/dashboard/api/dashboard.ts:162** (area: admin-dashboard-reports)

CATEGORY_META hardcodes exactly `perfumes | clothing | books | islamic`, and categoryPerformance returns `Object.entries(CATEGORY_META).map(...)` (line 176) — it iterates the hardcoded map, not the totals actually accumulated from `p.categoryId` (line 173). Category ids are admin-authored slugs: saveCategory writes `setDoc(doc(db,'categories', slug), { id: slug, ... })` with `slug = slugify(values.name)` (admin/src/features/categories/api/categories.ts:71,89). The four literals only match because scripts/seed.ts:269-272 seeds those ids. The panel also uses lifetime `soldCount` (units, not revenue) and ignores the 12M/30D/7D range selector sitting next to it.

**Failure:** Admin creates "Dates & Gifts" (id `dates-gifts`) and it becomes the best seller, then deletes the seeded `books` category. Dashboard still lists Perfumes/Clothing/Books/Islamic; Books shows 0% for a category that no longer exists, and the top-selling real category is never displayed at all. On any store not built from the seed, all four bars read 0%.

**Fix:** Drive the panel from the live `categories` collection (useCategories, CATEGORIES_KEY) joined to the per-categoryId totals, taking label/tint from the category doc, and aggregate order line revenue over the selected range instead of lifetime soldCount.

---

## [MEDIUM][broken-crud] Reports CSV export writes rounded display strings instead of numeric amounts
**admin/src/features/reports/api/reports.ts:259** (area: admin-dashboard-reports)

downloadReportCsv emits `formatMoneyCompact(kpis.totalRevenuePaise)` (line 259), `formatMoneyInt(b.paise)` for every trend row (line 265) and `formatMoneyCompact(r.revenuePaise)` per product (line 268). packages/shared/src/money.ts formatMoneyCompact returns `₹X.XL` / `₹X.XX Cr` — 1–2 significant decimals — and formatMoneyInt returns Indian-grouped digits with commas, which the escaper at line 252 then wraps in quotes. The CSV therefore contains currency-symbol text, not numbers.

**Failure:** Total revenue of 123456700 paise (₹12,34,567) exports as the cell `₹12.3L`, losing ₹4,567. A month bar of ₹1,23,456 exports as `"₹1,23,456"`. Opening the file in Excel/Sheets gives text columns that cannot be summed, charted or reconciled against the ledger — the export is unusable for its only purpose.

**Fix:** Export raw values (paise, or rupees as `paise/100` with 2dp) in dedicated numeric columns — e.g. `Total revenue,${kpis.totalRevenuePaise / 100}` — and keep formatted strings out of the file, or add them as a separate human-readable column alongside the numeric one.

---

## [MEDIUM][missing-state] "Skip" on Create Profile writes only a device-local pref; `customers.profileSkipped` is never written and the flag is never cleared on sign-out
**app/lib/features/auth/create_profile_screen.dart:64** (area: app-auth-profile)

`_skip()` calls `AppPrefs.setProfileSkipped()` (SharedPreferences, device-wide, not per-uid) and nothing else. The `profileSkipped` field that scripts/seed.ts:422 seeds and packages/shared/src/types/customers.ts:116 declares is written only as `false` by `_defaultCustomer` (auth_repository.dart:215) — no code anywhere ever sets it true, so it is a field nothing writes. AppPrefs also has no clear-on-sign-out: `AuthProvider.signOut()` (core/services/auth_provider.dart:64) just calls FirebaseAuth.signOut, and the log-out handler in profile_screen.dart:372 does no prefs cleanup.

**Failure:** Customer A signs in on a shared/handed-down phone and taps Skip (`profileSkipped=true` on the device). They log out; customer B signs in with a different number. Splash (splash_screen.dart:53-56) reads `complete=false, skipped=true` and sends B straight to Home with a blank profile — B is never asked for a name, and Profile shows "Your account". Meanwhile admin/web see `profileSkipped: false` for both, so they cannot distinguish a skipped profile from an abandoned one.

**Fix:** Persist `profileSkipped: true` on `customers/{uid}` in `_skip()` (the field is allowed by the update rule) and read it from the doc in splash; if the local pref is kept, key it by uid and clear it in the sign-out path.

---

## [MEDIUM][broken-crud] Pull-to-refresh during an in-flight page load silently drops the first page and leaves the cursor mid-catalogue
**app/lib/features/catalog/product_list_screen.dart:112** (area: app-catalog)

`_refresh()` clears `_items`, nulls `_cursor` and resets `_hasMore`, then awaits `_loadMore()`. But `_loadMore` opens with `if (_loading || !_hasMore) return;` (line 78), so when a prefetch triggered by `_onScroll` (line 71-75) is still in flight, `_refresh`'s call is a no-op and the RefreshIndicator completes with an empty grid. The still-running prefetch captured `var cursor = _cursor` at line 88 BEFORE the reset, and on completion does `_items.addAll(gained); _cursor = cursor;` (lines 98-99), repopulating the list from where the old cursor left off.

**Failure:** Catalogue has 90 published products. User scrolls the 'All products' grid; the prefetch for page 2 (products 31-60) fires and `_loading` is true. Mid-flight the user pulls to refresh. `_items` is cleared but `_loadMore` bails. The in-flight page then lands: the grid now contains only products 31-60 and `_cursor` points at product 60, so products 1-30 are permanently missing from the list and further scrolling appends 61-90 after them. A second pull-to-refresh is required to recover.

**Fix:** Make `_refresh` cancel/ignore in-flight work: bump a generation counter in `_refresh`, capture it in `_loadMore`, and discard the result in the `setState` at line 96-102 if the counter changed. Also drop the `_loading` early-return for the refresh path (or `await` the in-flight future before resetting).

---

## [MEDIUM][cross-surface-mismatch] Payment-gateway settings default to disabled in the app but enabled on web — a partially configured settings doc hides wallet and online payment only in the app
**app/lib/features/checkout/data/checkout_repository.dart:181** (area: app-cart-checkout)

`fetchSettings` reads `walletEnabled: (g['walletEnabled'] as bool?) ?? false` (line 181) and `onlinePaymentEnabled: (g['onlinePaymentEnabled'] as bool?) ?? false` (line 182), and the `StoreSettings` defaults used when the fetch throws are also `false` (lines 21-22). The web reads the same doc with the opposite fallback: `onlineEnabled = gateway?.onlinePaymentEnabled ?? true` and `walletEnabled = gateway?.walletEnabled ?? true` (web/src/app/(shop)/checkout/page.tsx:117-118), documented there as 'A missing settings doc means "everything on"'. checkout_screen.dart:250 carries that same comment ('missing settings ⇒ everything on') while the code does the opposite. Only `onlinePaymentEnabled` has an accidental rescue (`|| s.razorpayKeyId.isNotEmpty`, line 254); the wallet has none.

**Failure:** `settings/paymentGateway` exists but predates the wallet toggle (or `_loadSettings` throws once on a flaky first load, falling back to `const StoreSettings()`). On web the customer sees the 'Use wallet balance' switch and can spend their ₹500 wallet; in the app the wallet card never renders (`walletEnabled = false && ...`) and `draft.useWallet` is force-reset to false by the post-frame callback at line 279-282, so the same customer cannot spend their wallet at all and is charged the full amount.

**Fix:** Change the fallbacks in `fetchSettings` and the `StoreSettings` field defaults for `walletEnabled`, `onlinePaymentEnabled` (and `codEnabled`, already true) to `true`, matching the web's documented 'missing settings ⇒ everything on' contract.

---

## [MEDIUM][incomplete] Applied coupon discount is a frozen snapshot — editing quantities after applying shows a wrong discount and can make placeOrder hard-fail
**app/lib/features/checkout/widgets/coupon_apply.dart:87** (area: app-cart-checkout)

`CouponRewardBanner`'s Apply writes `AppliedCoupon(code: best.code, discountPaise: best.discountPaise, ...)` (lines 87-92) where `best.discountPaise` was computed by `listAvailableOffers` against the subtotal at that instant; `CouponScreen._applyOffer` does the same (coupon_screen.dart:69-73). Nothing recomputes it when the cart changes — `CheckoutDraft.coupon` is a plain field (checkout_draft.dart:13) and `computeSummary` only clamps it with `.clamp(0, subtotalPaise)` (checkout_repository.dart:196). The app makes this trivially reachable because the Bag screen renders the quantity steppers and `CouponRewardBanner`/`CouponRow` in the same scrolling list (bag_screen.dart:110-115), so applying and then editing quantities is a two-tap sequence on one screen. `placeOrder` re-derives the discount from the live cart and throws `failed-precondition` if the minimum is no longer met (functions/src/orders/checkout.ts:143-145, 187).

**Failure:** Customer with a ₹1,200 bag taps Apply on 'SPIN200 · ₹200 off · min cart ₹1,000'. Still on the Bag screen, they decrement a ₹400 item to bring the bag to ₹800. The bag total and the checkout summary still show '−₹200' and the pay bar still reads 'Place order · ₹600'. Tapping it calls placeOrder, which rejects with 'Your cart does not meet this coupon’s minimum.' — an error toast with no indication that the coupon is the problem and no way forward except guessing to clear the coupon. A percent coupon shows the wrong amount instead (10% applied at ₹1,000 stays '−₹100' after the cart grows to ₹5,000, while the server charges −₹500).

**Fix:** Store only the coupon code/metadata in `CheckoutDraft` and recompute `discountPaise` from the current `subtotalPaise` on every build (re-running the same `offers.dart` math for the applied code), clearing the coupon with a toast when the cart drops below its minimum.

---

## [MEDIUM][missing-state] CartProvider resets _inFlight to 0 while a write is in flight, underflowing the counter and permanently disabling snapshot suppression
**app/lib/core/services/cart_provider.dart:227** (area: app-cart-checkout)

`_onAuthChanged` unconditionally does `_inFlight = 0;` (line 227) without waiting for outstanding `_flush` calls. Any `_flush` already past its `_inFlight++` (line 180) still runs its `finally { _inFlight--; }` (line 198), taking the counter to -1. `_busy` is defined as `_inFlight > 0 || (_debounce?.isActive ?? false)` (line 74), so from that point on a write in flight leaves `_inFlight` at 0 and `_busy` false. The whole optimistic-write design depends on `_busy` being true during a write to ignore the stale server echo (lines 238-241); with the counter offset by -1 that protection is silently off for the rest of the process's life, and `_maybeReconcile`'s `!_busy` guard (line 214) also misfires.

**Failure:** User taps '+' on a bag line (immediate `_flush`, `_inFlight == 1`), then signs out from Settings before the write returns. `_onAuthChanged` zeroes `_inFlight`; the in-flight flush settles afterwards and decrements it to -1. The user signs back in (or the write settles after the sign-in `_onAuthChanged`). Now every subsequent '+' tap runs with `_busy == false`, so the pre-write `customers/{uid}` snapshot is applied over the optimistic state: the quantity visibly jumps back to the old value for a moment on every tap, and a debounced multi-tap sequence can end up reconciled to a stale value.

**Fix:** Track outstanding writes with a generation/epoch token instead of resetting the counter — e.g. bump an `_epoch` in `_onAuthChanged` and have `_flush` skip its `_inFlight--`/reconcile work when its captured epoch is stale, or guard with `_inFlight = _inFlight < 0 ? 0 : _inFlight` and never reset it from outside `_flush`.

---

## [MEDIUM][cross-surface-mismatch] App tax invoice omits delivery and COD surcharge, so the printed figures never add up
**app/lib/features/orders/invoice_screen.dart:179** (area: app-orders-returns)

The invoice card renders line items, then only a deduction line (invoice_screen.dart:179-183) and a tax line (invoice_screen.dart:184-186), then 'Total paid' (invoice_screen.dart:193-206). `order.deliveryPaise` and `order.codSurchargePaise` are parsed in the model (order.dart:229-230) but are never rendered anywhere in the app. The web invoice for the same order DOES render a Delivery row (web/src/app/(shop)/account/orders/[id]/invoice/page.tsx:78-83), so the two surfaces print different invoices for the same document.

**Failure:** COD order: subtotal Rs 500, delivery Rs 49, COD surcharge Rs 20, no tax, total Rs 569. The app invoice lists 'Item x 1  Rs 500.00' and then 'Total paid  Rs 569.00' with Rs 69 completely unexplained; the same order viewed on the web shows the Rs 49 delivery row.

**Fix:** Add the missing rows to the invoice card (delivery when `order.deliveryPaise > 0`, COD charge when `order.codSurchargePaise > 0`), matching the web invoice's row set so both surfaces reconcile to Total paid.

---

## [MEDIUM][dead-button] App shows a spinnable wheel for campaigns outside their startsAt/endsAt window, so 'Spin now' always fails
**app/lib/features/spin/data/spin_repository.dart:21** (area: app-rewards)

`activeCampaign()` filters only on `status == 'active'` (spin_repository.dart:21-26). `executeSpin` additionally rejects the spin when `now < startsAt || now > endsAt` with `failed-precondition` (functions/src/spin/execute.ts:57-59). Nothing ever flips a spin campaign's `status` — functions/src/scheduled/sweeps.ts contains only `couponExpirySweep`, and the `flashSaleStatusFlip` mentioned in functions/src/index.ts:71 is not implemented or exported. The admin explicitly models this state: admin/src/features/spinner/api/spinner.ts:73-75 derives the labels 'Scheduled' (startsAt in future) and 'Ended' (endsAt past) for campaigns whose stored `status` is still 'active', and `createCampaign` (spinner.ts:113-118) will happily write `status:'active'` with a future `startsAt` when 'Activate immediately' is ticked.

**Failure:** Admin creates a campaign starting next Monday with 'Activate immediately' ticked → `status:'active'`, `startsAt` = next Monday. Today a customer opens Spin & Win: the wheel renders, the copy says 'You have 3 free spins today', and 'Spin now' is enabled. Tapping it calls `executeSpin`, which throws `failed-precondition`, and the customer just gets an error toast — with no way to succeed. The same happens indefinitely after `endsAt` passes, because nothing ever moves the status off 'active'.

**Fix:** Filter the window client-side in `activeCampaign()` (drop campaigns whose `startsAt > now` or `endsAt < now`) so the screen falls through to the existing 'No spins available right now' state, and/or add a scheduled function that flips `spinCampaigns.status` to 'ended' past `endsAt`.

---

## [MEDIUM][dead-button] Notification deep links of type 'url' are a silent no-op — the admin's "Custom URL" broadcast option produces a dead card
**app/lib/features/notifications/notifications_screen.dart:181** (area: app-affiliate-notif)

`_onTap` switches on `n.deepLinkType` and handles only `product`, `category`, `home`; `default: break; // url / none — no in-app destination` (lines 167-183). The admin panel offers `url` as a first-class deep-link type (`DEEP_LINK_TYPES` in admin/src/features/notifications/api/notifications.ts:118-123, with a "Enter a URL to link to" validation at NotificationCreatePage.tsx:81) and `adminSendBroadcastNotification` persists it verbatim as `deepLink: {type:'url', target:'https://…'}` (functions/src/notifications/broadcast.ts:55-58). The app model parses it correctly (app_notification.dart:55-62) but nothing consumes it — the whole card is a `GestureDetector` with `onTap` (notifications_screen.dart:196), so it looks tappable and does nothing. `url_launcher` is not used anywhere for this.

**Failure:** Marketing sends a broadcast "Diwali sale — see the lookbook" with a Custom URL deep link. Every app customer taps the notification card; the row just turns from unread to read and nothing opens. The campaign link is unreachable from the app.

**Fix:** Handle `case 'url'` by launching the target with `url_launcher` (`launchUrl(Uri.parse(target), mode: LaunchMode.externalApplication)`), guarding against malformed/non-http targets, or remove `url` from the admin's deep-link options.

---

## [MEDIUM][crash-risk] markAllRead reads the whole unread set and commits one batch — >500 unread rows makes the badge impossible to clear
**app/lib/features/notifications/data/notifications_repository.dart:40** (area: app-affiliate-notif)

`markAllRead` does an unbounded `.get()` of every `read == false` doc and puts one `batch.update` per doc into a single `WriteBatch` (lines 40-49). Firestore caps a batch at 500 writes, so with 501+ unread rows `batch.commit()` rejects with INVALID_ARGUMENT and *no* row is marked read (batches are atomic). The failure is invisible: it is invoked fire-and-forget from `dispose()` (notifications_screen.dart:36) and from the "Mark all read" tap (notifications_screen.dart:107) with no `catch`, so the Future error is unhandled and the user sees nothing. `all(uid)` (line 29) is likewise an unbounded read of the entire inbox with no `limit`, since inbox rows are never deleted (rules forbid client delete, firestore.rules:170).

**Failure:** A long-standing customer accumulates 600 unread broadcast/order notifications. They open the inbox and tap "Mark all read"; the commit is rejected, every row stays unread, and the home bell dot plus the profile unread pill are stuck at 9+ forever — repeating the action can never succeed.

**Fix:** Chunk the updates into batches of ≤450 docs (and/or query with `.limit(450)` in a loop) and add a `.catchError` so failures are at least logged; add a `limit` to `all()` (e.g. newest 100 with paging).

---

## [MEDIUM][cross-surface-mismatch] Content page detail ignores `published`, so unpublished/draft policy pages still render
**app/lib/features/settings/data/content_repository.dart:27** (area: app-affiliate-notif)

`watchPage(id)` maps on `d.exists` only and never checks `published` (lines 27-30), while the list query filters `where('published', isEqualTo: true)` (line 17). ContentPageScreen consequently renders any `content/{id}` doc it is handed, and its own "Not available / This page is no longer published" empty state (content_page_screen.dart:80-84) is unreachable — it only fires when the doc is deleted, and admin content pages are created-then-edited, never deleted (admin/src/features/settings/api/content.ts writes `published: false` for drafts, line 134-149). Firestore rules allow any authenticated client to read every `content` doc (firestore.rules:49), so drafts are fetchable. The web deliberately resolves pages only from the published list (`useContentPageBySlug` → `useContentPages`, web/src/lib/siteSettings.ts:91-95) and shows "It may have been unpublished".

**Failure:** Admin unpublishes the Refund Policy while drafting a new version. A customer with the page open (live stream) keeps reading the withdrawn text, and anyone navigating to /content/{id} — a route reachable from a stale back-stack entry — renders the unpublished draft as if it were live policy.

**Fix:** Filter in `watchPage`: `.map((d) => d.exists && (d.data()?['published'] == true) ? ContentPage.fromDoc(d) : null)` so the existing "no longer published" empty state does its job.

---

## [MEDIUM][dead-button] "Skip for now" on Create profile persists nothing — the user is forced back to it on every sign-in
**web/src/app/(auth)/create-profile/page.tsx:123** (area: web-auth-account)

The Skip button's only action is `router.replace('/')`. It writes nothing, so `customers/{uid}.profileComplete` stays false. Sign-in routing is driven purely by that flag: authActions.ts:88-90 returns `needsProfile: !profileComplete`, and signin/page.tsx:72 does `router.replace(needsProfile ? '/create-profile' : '/')`. The `profileSkipped` field exists in the seeded doc (lib/customerDoc.ts:38), in the shared type (packages/shared/src/types/customers.ts:116) and in the rules' allowed-update list (firestore.rules:134) — but a grep across web/, app/lib, functions/src and admin/src shows nothing ever writes it to Firestore. The app solves the same problem locally (app/lib/core/services/app_prefs.dart:25, honoured at splash_screen.dart:54); the web has no equivalent.

**Failure:** New customer verifies their OTP, taps "Skip for now", shops as a guest-named account. They sign out and back in the next day: verifyOtp returns needsProfile=true and they land on /create-profile again. Every subsequent sign-in repeats this, forever, with no way to dismiss it permanently.

**Fix:** Have Skip write `{ profileSkipped: true, updatedAt: serverTimestamp() }` to customers/{uid} (already permitted by the rules) and change the signin route condition to `needsProfile && !customer.profileSkipped`.

---

## [MEDIUM][incomplete] Wallet top-up accepts any amount above ₹0 while the server rejects anything under ₹100
**web/src/app/(shop)/account/wallet/page.tsx:59** (area: web-auth-account)

`submitTopUp` validates only `Number.isFinite(rupees) && rupees > 0`; the numeric input is free-form (line 136 strips non-digits but imposes no bounds). The callable enforces `MIN_TOPUP = 100_00` and `MAX_TOPUP = 100_000_00` (functions/src/wallet/topup.ts:20-31) and throws `failed-precondition` with the real message before Razorpay is ever opened. The client's `catch` (line 79-81) discards `e` entirely and toasts the fixed `WALLET_CF_MSG` = "This goes live once the rewards/wallet service is deployed."

**Failure:** Customer types 50 in the Add money field and presses Add money. topUpWallet throws "Minimum top-up is ₹100." The UI instead tells them the wallet service is not deployed — so they stop trying rather than entering a valid amount. Same for any value over ₹1,00,000.

**Fix:** Mirror the server bounds client-side (reject <₹100 / >₹1,00,000 with the specific message, as the withdraw screen already does for its minimum) and surface the callable's own message in the catch: `const m = (e as {message?:string})?.message; toast.error(m && !m.startsWith('INTERNAL') ? m : WALLET_CF_MSG)`.

---

## [MEDIUM][incomplete] Withdrawal errors are swallowed into a misleading "service not deployed" toast
**web/src/app/(shop)/account/affiliate/withdraw/page.tsx:70** (area: web-auth-account)

`confirm()`'s catch is `catch { toast.error(WALLET_CF_MSG) }` — the HttpsError is not inspected. `requestWithdrawal` throws four distinct user-facing `failed-precondition` messages (functions/src/affiliate/requests.ts:36-47): affiliate not active, "You already have a withdrawal in progress.", amount exceeds balance, and below minimum, plus "Choose a valid bank account." The client pre-validates only balance (line 55) and minimum (line 60); `affiliate.hasPendingWithdrawal` is never checked anywhere in web/src, so that branch is unreachable client-side and always surfaces the wrong text.

**Failure:** Affiliate requests ₹2,000, admin has not yet processed it, so `affiliate.hasPendingWithdrawal` is true. They come back and request ₹1,000. The server correctly refuses with "You already have a withdrawal in progress." but the screen says "This goes live once the rewards/wallet service is deployed." — the customer believes the feature is broken and files a support ticket.

**Fix:** Extract the existing `errMessage(e, fallback)` helper from components/auth/authActions.ts:109 and use it here; additionally disable the Confirm button with an inline note when `affiliate.hasPendingWithdrawal` is true.

---

## [MEDIUM][cross-surface-mismatch] Applied discount is frozen at apply-time, so changing cart quantities makes the displayed total diverge from what is charged
**web/src/app/(shop)/checkout/page.tsx:130** (area: web-catalog-cart)

draft.coupon.discountPaise is captured once — from callApplyCoupon (page.tsx:152, bag/page.tsx:53) or from bestOfferForCart (page.tsx:92) — and computeSummary is then fed that fixed number (page.tsx:130-137) no matter how the subtotal changes. Nothing re-runs it: the bag page lets the user change quantities with the coupon banner still shown (bag/page.tsx:90-91), and the checkout auto-apply is guarded by the one-shot `autoTried` ref. The server always recomputes the percentage against the live subtotal (functions/src/orders/checkout.ts:171, 191).

**Failure:** Customer applies EID15 (15%, no cap) on a ₹1000 cart → discountPaise ₹150 stored. They go back to the bag and raise quantities to ₹4000, then check out: summary still shows −₹150 and To pay ₹3850, while placeOrder computes −₹600 and charges ₹3400. The reverse (shrinking the cart below minCartValuePaise) makes placeOrder throw and blocks checkout entirely.

**Fix:** Recompute the coupon whenever subtotalPaise changes — re-run bestOfferForCart/callApplyCoupon for the applied code on subtotal change, or store the coupon rule (type/percent/cap/min) instead of a precomputed paise amount and derive the discount inside computeSummary.

---

## [MEDIUM][cross-surface-mismatch] Cart lines cache the price from the moment of "Add to bag" and are never revalidated against the product doc
**web/src/lib/cart.ts:134** (area: web-catalog-cart)

CartLine stores pricePaise/mrpPaise snapshotted in ProductDetail.handleAdd (web/src/components/catalog/ProductDetail.tsx:131) and subtotalPaise() (cart.ts:134) sums those cached values; the line is persisted verbatim into customers/{uid}.cart (cart.ts:97) and survives indefinitely across devices and sessions. Neither the bag page nor the checkout page ever re-reads products/{id}. The server prices every line from the live product/variant doc (functions/src/orders/checkout.ts:61-72, 89), so the subtotal the customer sees is only correct until the admin edits the price or the variant's offer.

**Failure:** Customer adds a perfume at ₹899 and leaves it in the bag. Admin raises offerPricePaise to ₹1199. Next visit the bag and checkout still show ₹899 and "Place order · ₹899", but placeOrder prices the line at ₹1199 and the order/Razorpay charge is ₹300 higher than the figure on the button, with no warning or confirmation step.

**Fix:** Refresh cart line prices from products/{id} when the bag/checkout mounts (one getDoc per distinct productId, or a small batched read), show a "price updated" notice when a line changes, and block placement until the user acknowledges.

---

## [MEDIUM][missing-state] Order detail hides the Return CTA for the whole order as soon as any single item has an active return
**web/src/app/(shop)/account/orders/[id]/page.tsx:233** (area: web-orders-returns-reviews)

`const rb = returnBadge(items)` (line 68) uses `items.find(...)` over ALL items (web/src/components/account/orders.ts:232), returning the first item with an active return status. The render then does `order.status === 'delivered' && (rb ? <status badge> : rw?.open ? <Return item link> : ...)` — the per-order badge unconditionally replaces the per-item Return action. The return page itself is per-item and would still accept the remaining items.

**Failure:** Delivered order with 2 items. Customer returns item A; the CF stamps only item A with `returnStatus: 'requested'`. Reopening the order detail, `returnBadge` finds item A and renders "Return request in progress", and the "Return item" link disappears. Item B — still `returnStatus: 'none'` and inside the window — has no entry point from the order detail page, even though it is fully returnable.

**Fix:** Render the badge and the Return CTA independently: show the badge when `returnBadge(items)` is non-null AND still show the "Return item" link when `hasReturnableItem(items) && rw?.open` (that helper is already exported and currently unused).

---

## [MEDIUM][missing-state] Return submission discards the Cloud Function's error message, so every failure reads as a transient glitch
**web/src/components/account/orders.ts:313** (area: web-orders-returns-reviews)

`requestReturn` is `try { await httpsCallable(...)(payload); return true } catch { return false }` — the HttpsError code and message are dropped on the floor. The caller (web/src/app/(shop)/account/orders/[id]/return/page.tsx:109) maps `false` to "We couldn't submit your return just now. Please try again." The CF raises four distinct, permanent, non-retryable conditions: `permission-denied: Not your order`, `failed-precondition: Only delivered orders can be returned`, `failed-precondition: The 3-day return window ... has closed`, and `failed-precondition: A return is already in progress for this item`. Note `cancelOrder` in the same file (line 219-226) does propagate `e.message`, so the pattern already exists.

**Failure:** Customer submits a return for an item that already has a pending request (reachable via the OrderCard "Return" link plus a stale `?itemId=` deep link). The server returns `failed-precondition: A return is already in progress for this item.`; the UI says "Please try again", so the customer taps Submit repeatedly and each attempt fails identically with no explanation.

**Fix:** Return `{ ok: boolean; message?: string }` from `requestReturn` (mirroring `cancelOrder`) and surface `message` in the toast, falling back to the generic copy only when no message is present.

---

## [MEDIUM][broken-crud] Cancelling an order never releases the coupon it consumed — the spin coupon stays 'used' and the promotional redemption counters are never decremented
**functions/src/orders/cancel.ts:146** (area: backend-functions)

`placeOrder` consumes the coupon at checkout.ts:566-614: a personal coupon is flipped to `status:'used'` with `usedOnOrderId`, and a promotional coupon gets `usesCount` incremented plus `customers/{uid}/couponUsage/{couponId}.count` incremented (the exact counters `computeCouponDiscount` reads at lines 149 and 153 to enforce `maxUsesTotal` / `maxUsesPerUser`). `performCancellation` restores stock, refunds the wallet, and reverses the affiliate commission — but contains no reference to `coupons`, `couponUsage`, or `appliedCoupon` at all. The order's `appliedCoupon` field (checkout.ts:510) carries `couponId` / `userCouponId`, so the information needed to reverse it is right there on the document being updated at line 146.

**Failure:** Customer wins a 20%-off spin coupon, applies it to a ₹3,000 order, then cancels two minutes later (status is still 'accepted', so `cancelOrder` allows it). Stock is restored and the wallet is refunded, but `customers/{uid}/coupons/{id}.status` stays 'used' — the app's Coupons screen and web rewards page show it under Used and it can never be applied again. The customer has lost the prize with nothing to show for it. For a promotional coupon with `maxUsesPerUser: 1`, the cancelled order still burns the customer's single allowance: `computeCouponDiscount` line 153 will throw 'You have already used this coupon' on their next attempt.

**Fix:** In `performCancellation`, read `o.appliedCoupon` from the order snapshot (already loaded at line 46) and, in the write phase, restore `customers/{customerId}/coupons/{userCouponId}` to `status:'active'` with `usedAt/usedOnOrderId` cleared, and decrement `coupons/{couponId}.usesCount` and `customers/{customerId}/couponUsage/{couponId}.count` by 1.

---

## [MEDIUM][incomplete] Approving a return refunds the customer but never reverses the affiliate commission that was already confirmed at delivery
**functions/src/returns/decisions.ts:116** (area: backend-functions)

`affiliate/commissions.ts:10-14` states the design explicitly: 'Commission clears at delivery rather than after commissionClearanceDays ... Returns are handled by the return flow, which is the case the clearance delay was protecting against.' But `adminApproveOrderRequest` contains no reference to `commissions` or to `affiliate.*` anywhere — it updates the request, the customer wallet, and the order (`refundedPaise`, `paymentStatus`, `items[].returnStatus`) and stops. Since returns are only possible on delivered orders (`returns/requests.ts:39`), and delivery is exactly the moment `confirmCommissionsForOrder` moves the commission from `pendingBalancePaise` into `confirmedBalancePaise` (the withdrawable balance, commissions.ts:129-133), every approved return leaves the affiliate holding withdrawable commission on merchandise that has been refunded. The `commissions` doc's `cancellationReason` field (commissions.ts:88) is written as null at accrual and never set by any code path other than cancel.ts.

**Failure:** Customer C (referred by affiliate A, 5% rate) orders a ₹20,000 item. On delivery, A's ₹1,000 commission moves to `affiliate.confirmedBalancePaise`. Within the 3-day window C requests a return; the admin approves it and ₹20,000 is credited back to C's wallet. A's ₹1,000 remains withdrawable, A submits `requestWithdrawal` and the admin pays it out. The business has refunded the full order value and additionally paid ₹1,000 of commission on a sale that no longer exists.

**Fix:** In the approve transaction, read the `commissions` docs for `r.orderId` before the writes (query outside the transaction as `cancel.ts:37-40` does) and debit the affiliate's `confirmedBalancePaise` / `lifetimeEarningsPaise` by the pro-rata share of the returned line (refund amount ÷ eligible merchandise value × commissionPaise), stamping the commission row with a `returned`/partial status and a `cancellationReason`.

---

## [MEDIUM][cross-surface-mismatch] applyCoupon drops the free_shipping flag, so a free-shipping coupon shows ₹0 saved and the checkout screen keeps charging delivery
**functions/src/orders/checkout.ts:315** (area: backend-functions)

`computeCouponDiscount` returns a `waiveDelivery` flag for `discountType === 'free_shipping'` on both the promotional path (line 176) and the personal path (line 202), and `placeOrder` threads it into `summarise` at line 419 so the server genuinely zeroes `deliveryPaise` (line 286). But `applyCoupon` destructures only `{ discountPaise, label }` at line 314 and returns only those two fields at line 315. Both clients store exactly what comes back and nothing else — `web/src/app/(shop)/checkout/page.tsx:152` does `draft.set({ coupon: { code, discountPaise: res.discountPaise, label: res.label } })`, and `app/lib/features/checkout/coupon_screen.dart:46-52` does the same — so neither client's local summary can waive delivery. free_shipping is a first-class type in both writers: `admin/src/features/coupons/routes/CouponFormPage.tsx:30` offers it in the discount-type picker, and `spin/execute.ts:99,126` issues personal coupons with `discountType: 'free_shipping'`.

**Failure:** Customer wins a 'Free delivery' spin coupon (SPIN-XXXXX, discountType 'free_shipping'). At checkout they enter the code; applyCoupon succeeds and the toast says 'Coupon SPIN-XXXXX applied', but discountPaise is 0, so the order summary still shows 'You saved ₹0' and Delivery ₹49, total ₹1,049. They press Place order; the server applies waiveDelivery and creates the order for ₹1,000 — and for razorpay, `createRazorpayOrder` opens the gateway for ₹1,000, not the ₹1,049 the screen displayed. The coupon looks broken and the displayed total never matches the charged total.

**Fix:** Return `waiveDelivery` (and ideally the whole `CouponResult`) from `applyCoupon` at line 315, and have the web `computeSummary` / app `CheckoutDraft` honour it when deriving `deliveryPaise`, mirroring `summarise` at checkout.ts:286.

---

## [MEDIUM][security] reviews update rule is gated on isAdmin() only — any sub-admin can publish or reject reviews
**firebase/firestore.rules:113** (area: backend-rules-indexes)

`allow update: if hasAppCheck() && isAdmin() && ...hasOnly(['status','moderatedBy','moderatedAt','updatedAt','helpfulCount'])`. Unlike every other admin-written collection in this file (settings/categories/products/coupons/… all use `canWrite('<module>')`, and the comment at lines 15-19 states this was deliberately tightened because 'a sub-admin with only dashboard.view could rewrite the GST rate'), the reviews rule never consults `can('reviews', …)`. `isAdmin()` is true for ANY doc-holder whose claim is `sub_admin`, regardless of modulePermissions, and it does not even check `adminDoc().status == 'active'` — so a suspended sub-admin still passes.

**Failure:** A sub-admin whose matrix has only `dashboard: view` (or one who has been suspended via suspendSubAdmin but whose custom claim has not been revoked) calls updateDoc on reviews/{id} with `{status:'approved', helpfulCount: 9999}` — the rule accepts it and a 1-star or abusive review is published on the storefront (web ProductDetail.tsx:387 and app reviews_repository.dart:19-21 both read `status == 'approved'` publicly).

**Fix:** Change to `allow update: if hasAppCheck() && can('reviews','edit') || can('reviews','approve')` (mirroring the `canWrite()` pattern used for the other direct-write collections), which also picks up the `adminDoc().status == 'active'` check.

---

## [MEDIUM][security] stockAdjustments audit ledger accepts writes from any admin with no inventory permission check
**firebase/firestore.rules:215** (area: backend-rules-indexes)

`allow create: if isAdmin() && request.resource.data.adminUid == uid();` — the only constraint is that the forger stamps their own uid. There is no `can('inventory', …)` gate and no `adminDoc().status == 'active'` check, even though `inventory` is a real MODULE_KEY (packages/shared/src/enums.ts:257) and the collection is described in the rule's own comment as the append-only stock-adjustment ledger. The ledger is the audit trail read back by admin/src/features/inventory/api/inventory.ts:150 `getStockHistory()`, and it is written client-side by addLedger (inventory.ts:129-144) with fully client-supplied `before`/`delta`/`after`/`reason`/`adminName`.

**Failure:** A sub-admin with only `dashboard: view` (or a suspended one whose claim is still live) writes `stockAdjustments/{newId}` with `{productId:'p1', before: 500, delta: -480, after: 20, reason:'Damaged', adminUid: <self>, adminName:'Someone Else'}`. The Stock History panel for p1 now shows a fabricated 480-unit write-off that no real stock movement backs, and because `update, delete: if false` it can never be removed.

**Fix:** Gate the create on the inventory module: `allow create: if can('inventory','create') && request.resource.data.adminUid == uid();` — matching how the paired stock mutation is already gated server-side via requireModule.

---

## [MEDIUM][broken-crud] Changing a category tint fans out writes to products, which a categories-only sub-admin is denied
**admin/src/features/categories/api/categories.ts:119** (area: backend-rules-indexes)

`fanOutCategoryTint` (called from CategoryFormPage.tsx:141 whenever an existing category's tint changes) reads every product in the category and commits `batch.update(d.ref, { categoryTint: tint })` against the `products` collection. firebase/firestore.rules:51 gates products writes on `canWrite('products')`, but this action lives entirely inside the Categories module. Additionally the batching loop commits in chunks of 400 sequentially, so a partial failure leaves some products with the new tint and the rest with the old one.

**Failure:** Sub-admin granted `categories: edit` but not `products: edit` opens a category, changes its tint and saves. `saveCategory` succeeds (categories rule passes) but the first `batch.commit()` is rejected with permission-denied, so the category doc says one tint while every product card still renders the old `categoryTint`, and the surfaced error makes it look like the whole save failed.

**Fix:** Move the fan-out into a Cloud Function guarded by `requireModule(req,'categories','edit')` (it is a cross-document denormalisation, which is exactly the CF criterion), or have readers derive `categoryTint` from the category doc instead of denormalising it onto every product.

---

## [MEDIUM][cross-surface-mismatch] Three of five walletTransactions writers omit `title`, which the web wallet history renders directly
**web/src/app/(shop)/account/wallet/page.tsx:188** (area: cross-surface-shapes)

The web wallet history passes `title={tx.title}` with no fallback. `title` is required by the shared `WalletTransaction` type and is written by functions/src/wallet/adjust.ts:66 and by the order-payment/spin-reward rows in checkout.ts:582,596 — but NOT by functions/src/wallet/topup.ts:98 (top-up), functions/src/orders/cancel.ts:116 (cancellation refund) or functions/src/spin/execute.ts:143 (spin cashback), all of which write only `description`. The Flutter app tolerates this via `WalletTransaction.displayTitle`'s source-derived fallback (app/lib/features/wallet/data/wallet.dart:71) and admin does `t.title || cap(t.source)` (CustomerProfilePage.tsx:370); only the web renders the raw empty string. The spin cashback row additionally stores `balanceAfterPaise: 0` regardless of the real balance.

**Failure:** Customer tops up ₹500 on web, then cancels an order and gets a wallet refund. Their web Transaction history shows two rows with a blank bold title line and only a date subtitle, while the same two rows read 'Added to wallet' and 'Refund · #BRK-48231' in the Flutter app.

**Fix:** Add a `title` to the topup, cancellation-refund and spin-cashback writes (mirroring adjust.ts), and compute `balanceAfterPaise` in execute.ts from the read balance plus the cashback; optionally add the app's source-derived fallback on the web too.

---

## [MEDIUM][security] Review moderation writes the products doc, so a sub-admin with only the reviews module gets permission-denied and nothing is moderated
**admin/src/features/reviews/api/reviews.ts:64** (area: cross-surface-shapes)

`moderateReview()` runs one transaction that updates `reviews/{id}` and then `tx.update(pRef, { ratingCount, rating })` on `products/{productId}`. firestore.rules gates the two collections on different modules: `match /reviews/{id}` update needs `isAdmin()` (line 113) but `match /products/{id}` write needs `canWrite('products')` (line 51), and 'reviews' and 'products' are distinct keys in ModulePermissions (packages/shared/src/enums.ts). Because a Firestore transaction is all-or-nothing, the denied product write aborts the review status update too — so the approve/reject buttons silently do nothing for any sub-admin who has reviews permission but not products.

**Failure:** Super-admin creates a sub-admin with modulePermissions.reviews.approve = true and products = all false. That sub-admin opens /reviews and clicks Approve on a pending review: the transaction fails with PERMISSION_DENIED on products/{id}, the review stays 'pending' forever, and the customer's review never appears on the product page.

**Fix:** Move review moderation behind a Cloud Function guarded by `requireModule(req,'reviews','approve')` that updates both docs with the Admin SDK (matching how returns/orders are handled), or make the product-aggregate write conditional and repair the aggregate server-side.

---

## [MEDIUM][missing-state] products.soldCount is never incremented on order placement, so popularity sort and the dashboard category chart are permanently zero
**web/src/components/catalog/ListingView.tsx:100** (area: cross-surface-shapes)

The storefront's popularity sort ranks by `b.soldCount - a.soldCount`, the admin dashboard's category-share chart sums `p.soldCount` (admin/src/features/dashboard/api/dashboard.ts:173), and firestore.indexes.json declares two composite indexes ordered by `soldCount DESC`. The field is initialised to 0 by admin/src/features/products/api/products.ts:156,201,287 and set to non-zero only by scripts/seed.ts:380. `placeOrder` decrements `stock` (functions/src/orders/checkout.ts:437,440) but never touches `soldCount`, and no other function or trigger writes it.

**Failure:** An admin adds 30 products through the panel and the store sells hundreds of units. On the storefront, 'Sort: Popularity' returns products in arbitrary (all-zero, stable-sort) order forever, and the admin dashboard's 'top categories' bars all render at 0% — while seeded demo products still show plausible values, hiding the bug.

**Fix:** Increment `soldCount` by the line quantity for each product inside the placeOrder transaction (and decrement it in performCancellation / on an approved return), alongside the existing stock decrement.

---

## [LOW][dead-button] walletEnabled is accepted by adminAllocateAffiliate and never persisted — the allocate screen's toggle is a no-op
**functions/src/affiliate/withdrawals.ts:20** (area: admin-customers)

The schema at line 20 accepts `walletEnabled: z.boolean().optional()` but line 23 destructures only `{ uid, commissionRate }`, and the `ref.update` at lines 32-42 writes no wallet-access flag anywhere on the customer doc. admin/src/features/affiliate/routes/AllocateAffiliatePage.tsx:115 renders an 'Enable affiliate wallet access' Toggle bound to that value and line 55 sends it; the confirm dialog at line 130 even promises '…and affiliate wallet access'.

**Failure:** Admin turns the 'Enable affiliate wallet access' toggle OFF and allocates. The confirmation text says wallet access is withheld, but the customer doc gets the standard affiliate map with pending/confirmed/withdrawn balances and the customer's affiliate wallet works exactly as if the toggle were ON. Nothing in the system can ever read the flag back.

**Fix:** Either persist it (`affiliate.walletEnabled: walletEnabled ?? true`) and honour it in the withdrawal/commission paths, or drop the field from the schema and remove the toggle from the allocate screen.

---

## [LOW][dead-button] UPI / Card selection on the Payment screen is a no-op — the choice is never passed to the Razorpay checkout
**app/lib/features/checkout/payment_screen.dart:127** (area: app-cart-checkout)

`_method` is initialised to `'upi'` (line 45) and mutated by both `_methodCard` handlers via `setState(() => _method = value)` (line 417), which only repaints the selection ring. `_openCheckout` builds the Razorpay options map at lines 127-137 with `key`, `order_id`, `amount`, `currency`, `name`, `description`, `prefill`, `theme`, `retry` — `_method` is never read, and no `method` map or `prefill['method']` is supplied. The field is not sent to `placeOrder` either (lines 81-88). It is therefore a two-option control that changes nothing about the payment flow.

**Failure:** Customer taps the 'Card · Visa · Mastercard · Amex' row (the ring moves to Card), then taps 'Pay ₹1,299'. The native Razorpay sheet opens on its own default landing tab with every method enabled — UPI included — exactly as it would have had they left 'UPI' selected. The user's explicit choice has no effect on what they are shown.

**Fix:** Pass the selection through to Razorpay: add `'method': {'upi': _method == 'upi', 'card': _method == 'card', 'netbanking': false, 'wallet': false}` (or `'prefill': {..., 'method': _method}`) to the options map in `_openCheckout`, so the selected instrument is the one the gateway opens on.

---

## [LOW][dead-button] "Download invoice" on the order-success screen is a dead button claiming the order service is not live
**web/src/app/(shop)/checkout/success/page.tsx:71** (area: web-catalog-cart)

The button's only handler is `toast.message('Your invoice will be emailed once the order service is live.')` — no navigation, no callable, no download. The order service is deployed (functions/src/orders/invoice.ts exists, and the site already ships an invoice screen at web/src/app/(shop)/account/orders/[id]/invoice/page.tsx), so the message is a stale placeholder from the pre-deploy era — the same era as the CF_UNAVAILABLE_MSG constant in checkout.ts:24, which is now unused.

**Failure:** Customer places a COD order, lands on /checkout/success, clicks "Download invoice" → a toast says invoicing is not live yet. No invoice is fetched or downloaded, even though /account/orders/{id}/invoice would render it.

**Fix:** Link the button to /account/orders/{orderId}/invoice (the placed draft would need to carry orderId alongside shortId, which placeOrder already returns), or remove the button.

---

