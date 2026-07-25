import { searchTokens } from '@barkath/shared';

/**
 * Client-side search matcher used by every list screen. Matches the query
 * against visible text fields AND the document's `searchIndex` (the prefix
 * n-gram keywords built on write — tech-arch §7.4), so a term like "amb"
 * matches "Amber Oud" through the keyword index even when the field list the
 * screen passes doesn't carry that text (an order's phone, a customer's email).
 *
 * The index holds EVERY prefix of each indexed word from 2 characters upwards
 * (buildSearchIndex, MIN_PREFIX_LEN = 2), so a query term matches only when it
 * is a PREFIX OF an entry. The reverse test — an entry being a prefix of the
 * query — used to be accepted too, and because every indexed word contributes a
 * 2-character entry that made any query match any document sharing its first
 * two letters: every list search in the panel degenerated into a two-letter
 * match ("oud" returned "Outdoor Prayer Mat", "fatima" returned "Farhan Ali").
 *
 * The query is tokenised with the same normaliser that built the index, so a
 * pasted email or phone ("fatima@example.com") still resolves — as its separate
 * words — instead of relying on that accident. Every token must match, which is
 * also what makes a multi-word query narrow the results rather than widen them.
 */
export function matchesSearch(
  query: string,
  fields: (string | null | undefined)[],
  searchIndex?: string[] | null,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  for (const f of fields) {
    if (f && f.toLowerCase().includes(q)) return true;
  }
  if (searchIndex && searchIndex.length > 0) {
    // Tokens shorter than the minimum prefix (and stopwords) are dropped by
    // searchTokens; a query made only of those can't be answered by the index,
    // and must not match everything by vacuous truth.
    const tokens = searchTokens(q);
    if (
      tokens.length > 0 &&
      tokens.every((t) => searchIndex.some((k) => k.toLowerCase().startsWith(t)))
    ) {
      return true;
    }
  }
  return false;
}

/** Per-route search scope: placeholder + whether the top-bar field is active. */
export interface SearchScope {
  placeholder: string;
  enabled: boolean;
}

const SCOPES: { prefix: string; placeholder: string }[] = [
  { prefix: '/products', placeholder: 'Search products…' },
  { prefix: '/categories', placeholder: 'Search categories…' },
  { prefix: '/inventory', placeholder: 'Search inventory…' },
  { prefix: '/reviews', placeholder: 'Search reviews…' },
  { prefix: '/orders', placeholder: 'Search orders…' },
  { prefix: '/customers', placeholder: 'Search customers…' },
  { prefix: '/payments', placeholder: 'Search payments…' },
  { prefix: '/refunds', placeholder: 'Search refunds…' },
  { prefix: '/coupons', placeholder: 'Search coupons…' },
  { prefix: '/banner', placeholder: 'Search banners…' },
  { prefix: '/spinner', placeholder: 'Search campaigns…' },
  { prefix: '/notifications', placeholder: 'Search notifications…' },
  { prefix: '/affiliate', placeholder: 'Search affiliates…' },
  { prefix: '/sub-admin', placeholder: 'Search sub-admins…' },
];

/** Resolve the search scope for a pathname. Detail pages (with an id) don't filter. */
export function searchScopeFor(pathname: string): SearchScope {
  const scope = SCOPES.find((s) => pathname === s.prefix || pathname.startsWith(`${s.prefix}?`) || pathname === `${s.prefix}/`);
  // Only the list root is searchable — not detail/new/edit/adjust sub-routes.
  const isListRoot = SCOPES.some((s) => s.prefix === pathname);
  if (scope && isListRoot) return { placeholder: scope.placeholder, enabled: true };
  return { placeholder: 'Search…', enabled: false };
}

/** The base segment of a path (for detecting screen changes to reset search). */
export function baseSegment(pathname: string): string {
  return '/' + (pathname.split('/').filter(Boolean)[0] ?? '');
}
