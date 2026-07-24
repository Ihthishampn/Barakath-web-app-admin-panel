import { cn } from '@/lib/cn';

export const inputCls =
  'w-full rounded-sm border border-border-default bg-surface-card px-3.5 py-2.5 font-ui text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none';

/** Card matching the prototype: rounded-xl, subtle border, surface-card, p-5. */
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('rounded-xl border border-border-subtle bg-surface-card p-5', className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-3.5 font-display text-sm font-bold text-text-primary">{children}</div>;
}

/** Labelled text/number input in the prototype's field style. */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  error,
  required,
  type = 'text',
  prefix,
  suffix,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
  type?: 'text' | 'number';
  prefix?: string;
  suffix?: string;
  inputMode?: 'numeric' | 'decimal';
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-ui text-xs font-bold text-text-primary">
        {label}
        {required && <span className="text-error"> *</span>}
      </span>
      <div className="relative flex items-center">
        {prefix && (
          <span className="pointer-events-none absolute left-3.5 font-ui text-[13px] text-text-tertiary">
            {prefix}
          </span>
        )}
        <input
          type={type}
          inputMode={inputMode}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            inputCls,
            prefix && 'pl-7',
            suffix && 'pr-9',
            error && 'border-error focus:border-error',
          )}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3.5 font-ui text-[13px] text-text-tertiary">
            {suffix}
          </span>
        )}
      </div>
      {error && <span className="font-ui text-xs text-error">{error}</span>}
    </label>
  );
}

/** A toggle row: label left, Toggle right, with a top divider variant. */
export function ToggleRow({
  label,
  hint,
  divided,
  children,
}: {
  label: string;
  hint?: string;
  divided?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4',
        divided && 'mt-3.5 border-t border-border-subtle pt-3.5',
      )}
    >
      <div>
        <div className="font-ui text-[13px] font-semibold text-text-secondary">{label}</div>
        {hint && <div className="mt-0.5 font-ui text-[11px] text-text-tertiary">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
