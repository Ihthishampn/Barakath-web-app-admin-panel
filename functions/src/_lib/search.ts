/**
 * Firestore-native search helpers (tech-arch §7.4) — inlined here so the
 * Functions bundle has no pnpm-workspace dependency (`@barkath/shared` can't be
 * resolved by npm in Google's cloud build). Mirror of packages/shared.
 */
const STOPWORDS = new Set(['de', 'the', 'a', 'an', 'of', 'for', 'and', 'or', 'to', 'in', 'on', 'at']);
const MIN_PREFIX_LEN = 2;
const MAX_PREFIX_LEN = 20;
const MAX_INDEX_SIZE = 200;

export function buildSearchIndex(sources: (string | null | undefined)[]): string[] {
  const prefixes = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    const normalized = source
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    for (const word of normalized.split(' ')) {
      if (word.length < MIN_PREFIX_LEN || STOPWORDS.has(word)) continue;
      const truncated = word.slice(0, MAX_PREFIX_LEN);
      for (let i = MIN_PREFIX_LEN; i <= truncated.length; i++) prefixes.add(truncated.slice(0, i));
    }
  }
  let arr = Array.from(prefixes);
  if (arr.length > MAX_INDEX_SIZE) {
    arr.sort((a, b) => a.length - b.length);
    arr = arr.slice(0, MAX_INDEX_SIZE);
  }
  return arr;
}

export function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
