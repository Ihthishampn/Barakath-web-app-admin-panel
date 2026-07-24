import { cn } from '@/lib/cn';

/** Shared list pagination footer — "Showing X–Y of Z" + page pills (prototype). */
export function Pagination({
  page,
  total,
  pageSize,
  onPage,
  noun = 'results',
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (n: number) => void;
  noun?: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;

  return (
    <div className="mt-4 flex items-center justify-between">
      <span className="font-ui text-xs font-medium text-text-tertiary">
        {total === 0 ? `No ${noun}` : `Showing ${start + 1}–${Math.min(start + pageSize, total)} of ${total.toLocaleString('en-IN')}`}
      </span>
      <div className="flex gap-1.5">
        <PageBtn label="‹" onClick={() => onPage(Math.max(1, current - 1))} disabled={current === 1} />
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <PageBtn key={n} label={String(n)} active={n === current} onClick={() => onPage(n)} />
        ))}
        <PageBtn label="›" onClick={() => onPage(Math.min(pageCount, current + 1))} disabled={current === pageCount} />
      </div>
    </div>
  );
}

function PageBtn({ label, active, disabled, onClick }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center rounded-[7px] border px-2 font-ui text-xs font-bold disabled:opacity-40',
        active ? 'border-brand-primary bg-brand-primary text-white' : 'border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-app',
      )}
    >
      {label}
    </button>
  );
}

/** Slice helper: returns the current page's rows for a given list. */
export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}
