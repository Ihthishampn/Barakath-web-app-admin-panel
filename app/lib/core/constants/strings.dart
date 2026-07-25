/// User-facing copy — spec §0.2 (no hard-coded strings scattered in widgets).
/// English only at launch, structured for later i18n.
///
/// The **app** displays the brand as **Barakath** (matching the Figma logo +
/// designs), per the user's decision. Code identifiers, the Firebase project
/// (barkath-25607), and the order-ID prefix (#BRK-) stay as-is. Order-ID prefix
/// locked to **#BRK-**.
abstract final class Strings {
  static const brand = 'Barakath';
  static const orderPrefix = '#BRK-';
  static const tagline = 'Perfumes · Books · Clothing · Islamic';
  static const supportEmail = 'help@barkath.app';

  /// Public storefront origin. The ONE place the domain is written down, so a
  /// change lands everywhere at once — the affiliate referral link below points
  /// at the web's `/r/[code]` landing route, which is what actually attributes
  /// the referral, and must therefore stay on the same host the web ships.
  /// Matches the web today (`https://barakath.com/r/${code}`,
  /// web/src/app/(shop)/account/affiliate/referral/page.tsx).
  static const webOrigin = 'https://barakath.com';

  /// Referral landing link for an affiliate [code].
  static String referralLink(String code) => '$webOrigin/r/$code';

  /// Public product link, matching web's `/product/[id]` route. Shared links
  /// used to be hard-coded to `barakath.app` while referrals used
  /// `barakath.com` — two different hosts for one storefront, so at least one
  /// was always dead. Both now derive from [webOrigin].
  static String productLink(String productId) => '$webOrigin/product/$productId';

  // Generic
  static const tryAgain = 'Try again';
  static const somethingWrong = 'Something went wrong.';
  static const offline = "You're offline";
}
