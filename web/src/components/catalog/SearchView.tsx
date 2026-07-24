'use client';
import { useMemo, useState } from 'react';
import { RiSearchLine, RiCloseLine } from '@remixicon/react';
import { useProductSearch } from '@/lib/catalog';
import { ProductGrid } from '@/components/product/ProductGrid';
import { cn } from '@/lib/cn';
import { useSearchSuggestions } from '@/lib/siteSettings';

/** Used until an admin publishes settings/searchSuggestions. */
const DEFAULT_SUGGESTIONS = ['amber perfume', 'prayer mat', 'atomic habits', 'abaya'];

export function SearchView() {
  const [q, setQ] = useState('');
  const { data: suggestionSettings } = useSearchSuggestions();

  // Admin-curated chips, falling back to the built-ins when unset or emptied.
  const suggestions = useMemo(
    () => (suggestionSettings?.terms?.length ? suggestionSettings.terms : DEFAULT_SUGGESTIONS),
    [suggestionSettings],
  );

  // Instant substring search over the whole published catalogue — already
  // filtered (AND across terms) and ranked (name-prefix first, then popularity)
  // by the hook, so this component just renders it. A single letter reacts.
  const { data: results, loading, error } = useProductSearch(q);
  const active = q.trim().length > 0;

  return (
    <div className="mx-auto max-w-page px-4 sm:px-10">
      {/* search field */}
      <div className="pb-3 pt-7">
        <div className="flex items-center gap-3">
          <div className="flex max-w-[640px] flex-1 items-center gap-3 rounded-pill border-2 border-brand-primary bg-surface-card px-5 py-3.5">
            <RiSearchLine size={20} className="flex-none text-brand-primary" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search perfumes, books, abayas…"
            className="min-w-0 flex-1 bg-transparent font-ui text-[15px] font-medium text-text-primary outline-none placeholder:text-text-tertiary"
          />
            {q && (
              <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="flex-none text-text-tertiary hover:text-text-secondary">
                <RiCloseLine size={18} />
              </button>
            )}
          </div>
        </div>

        {/* suggestion chips */}
        <div className="mt-4 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setQ(s)}
              className={cn(
                'rounded-pill border px-4 py-1.5 font-ui text-[13px] font-semibold transition-colors',
                q === s
                  ? 'border-brand-primary bg-brand-primary-subtle text-brand-primary'
                  : 'border-border-default text-text-secondary hover:bg-neutral-200',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* results */}
      <div className="pb-12 pt-4">
        {!active ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border-default bg-surface-card py-16 text-center font-ui text-sm text-text-tertiary">
            Start typing to search the catalogue.
          </div>
        ) : (
          <>
            <div className="mb-4 font-ui text-[14px] font-bold text-text-secondary">
              {loading ? 'Searching…' : `${results.length} result${results.length === 1 ? '' : 's'} for "${q.trim()}"`}
            </div>
            <ProductGrid
              products={results}
              loading={loading}
              error={error}
              emptyLabel={`No products match "${q.trim()}".`}
              cols={5}
            />
          </>
        )}
      </div>
    </div>
  );
}
