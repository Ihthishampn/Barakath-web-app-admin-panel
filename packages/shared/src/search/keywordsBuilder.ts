/**
 * Barkath — Firestore-native search (tech-arch §7.4).
 * Builds a prefix n-gram array stored ON each document as `searchIndex: string[]`.
 * Matched with `where('searchIndex', 'array-contains', prefix)`. No Algolia.
 * Reused by every rebuildSearchIndex trigger (products, orders, customers, coupons, admins).
 */

const STOPWORDS = new Set([
  'de', 'the', 'a', 'an', 'of', 'for', 'and', 'or', 'to', 'in', 'on', 'at',
]);
const MIN_PREFIX_LEN = 2;
const MAX_PREFIX_LEN = 20;
const MAX_INDEX_SIZE = 200;

/** Lowercase, strip non-alphanumerics (keep spaces), collapse whitespace. */
export function normalizeSearchText(source: string): string {
  return source
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build the prefix n-gram index from one or more source strings.
 * @example buildSearchIndex(['Amber Oud EDP', 'oud', 'attar'])
 */
export function buildSearchIndex(sources: (string | null | undefined)[]): string[] {
  const prefixes = new Set<string>();

  for (const source of sources) {
    if (!source) continue;
    const words = normalizeSearchText(source).split(' ');
    for (const word of words) {
      if (word.length < MIN_PREFIX_LEN || STOPWORDS.has(word)) continue;
      const truncated = word.slice(0, MAX_PREFIX_LEN);
      for (let i = MIN_PREFIX_LEN; i <= truncated.length; i++) {
        prefixes.add(truncated.slice(0, i));
      }
    }
  }

  let arr = Array.from(prefixes);
  if (arr.length > MAX_INDEX_SIZE) {
    // Drop the longest (most specific) first — short prefixes matter more for typeahead.
    arr.sort((a, b) => a.length - b.length);
    arr = arr.slice(0, MAX_INDEX_SIZE);
  }
  return arr;
}

/** Tokens a client should query with, given raw user input. */
export function searchTokens(input: string): string[] {
  return normalizeSearchText(input)
    .split(' ')
    .filter((t) => t.length >= MIN_PREFIX_LEN && !STOPWORDS.has(t));
}

export function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
