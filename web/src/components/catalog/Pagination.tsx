'use client';
import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/react';
import { cn } from '@/lib/cn';

/** Numbered client-side pagination matching the prototype pill row. */
export function Pagination({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total <= 1) return null;
  const pages = Array.from({ length: total }, (_, i) => i + 1);
  return (
    <div className="mt-8 flex items-center justify-center gap-2">
      <button
        type="button"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="grid h-10 w-10 place-items-center rounded-pill border border-border-default text-text-secondary transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <RiArrowLeftSLine size={18} />
      </button>
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          aria-current={p === page ? 'page' : undefined}
          className={cn(
            'grid h-10 min-w-10 place-items-center rounded-pill border px-3 font-ui text-[13px] font-bold transition-colors',
            p === page
              ? 'border-brand-primary bg-brand-primary text-white'
              : 'border-border-default text-text-primary hover:bg-neutral-200',
          )}
        >
          {p}
        </button>
      ))}
      <button
        type="button"
        aria-label="Next page"
        disabled={page >= total}
        onClick={() => onChange(page + 1)}
        className="grid h-10 w-10 place-items-center rounded-pill border border-border-default text-text-secondary transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <RiArrowRightSLine size={18} />
      </button>
    </div>
  );
}
