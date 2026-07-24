'use client';
import Link from 'next/link';
import type { Category } from '@barkath/shared';
import { useCategories } from '@/lib/catalog';

export function CategoriesView() {
  const { data: categories, loading, error } = useCategories();

  return (
    <div className="mx-auto max-w-page px-4 sm:px-10">
      <div className="pb-2 pt-7">
        <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.02em] text-text-primary">Shop by category</h1>
      </div>

      <div className="pb-12 pt-5">
        {loading ? (
          <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border-subtle bg-surface-card p-2.5">
                <div className="aspect-[16/9] w-full animate-pulse rounded-2xl bg-neutral-200" />
                <div className="px-1.5 pb-1 pt-3">
                  <div className="h-4 w-1/2 animate-pulse rounded bg-neutral-200" />
                  <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-neutral-200" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border-default bg-surface-card py-16 text-center font-ui text-sm text-text-tertiary">
            Couldn&apos;t load categories. Please try again.
          </div>
        ) : categories.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border-default bg-surface-card py-16 text-center font-ui text-sm text-text-tertiary">
            No categories yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
            {categories.map((c) => (
              <CategoryCard key={c.id} category={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryCard({ category }: { category: Category }) {
  const image = category.heroImageUrl || category.iconUrl;
  const subs = category.subCategories
    ?.filter((s) => s.visibility === 'visible')
    .map((s) => s.name)
    .join(' · ');
  return (
    <Link
      href={`/c/${category.slug}`}
      className="group rounded-2xl border border-border-subtle bg-surface-card p-2.5 transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      {/* Inner image card — thin tint frame; image fills with its own curved corners */}
      <div
        className="aspect-[16/9] w-full overflow-hidden rounded-2xl border border-border-subtle p-1.5"
        style={{ backgroundColor: category.categoryTint || '#e6cfb4' }}
      >
        <div
          className="h-full w-full rounded-xl bg-cover bg-center bg-no-repeat transition-transform duration-300 group-hover:scale-[1.02]"
          style={{ backgroundImage: image ? `url(${image})` : undefined }}
        />
      </div>
      <div className="px-1.5 pb-1 pt-3">
        <div className="font-display text-[18px] font-extrabold leading-none text-text-primary">{category.name}</div>
        {subs && <div className="mt-1.5 line-clamp-1 font-ui text-[12px] font-medium leading-relaxed text-text-tertiary">{subs}</div>}
      </div>
    </Link>
  );
}
