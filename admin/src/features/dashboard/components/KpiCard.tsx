import { cn } from '@/lib/cn';

export function KpiCard({
  label,
  value,
  delta,
  deltaTone = 'muted',
  loading,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: 'success' | 'error' | 'muted';
  loading?: boolean;
}) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-card p-[18px]">
      <div className="font-ui text-xs font-medium text-text-tertiary">{label}</div>
      <div className="mt-2.5 font-display text-[26px] font-extrabold leading-none text-text-primary">
        {loading ? <span className="text-text-tertiary">—</span> : value}
      </div>
      {delta && (
        <div
          className={cn(
            'mt-2 font-ui text-[11px] font-bold',
            deltaTone === 'success' && 'text-success',
            deltaTone === 'error' && 'text-error',
            deltaTone === 'muted' && 'text-text-tertiary',
          )}
        >
          {delta}
        </div>
      )}
    </div>
  );
}
