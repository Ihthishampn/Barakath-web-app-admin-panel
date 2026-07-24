'use client';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * Labeled text input for the account forms — matches the prototype field
 * (rounded-[10px] border, 15px medium text, 14px/16px padding).
 */
export const Field = forwardRef<
  HTMLInputElement,
  {
    label: string;
    optional?: boolean;
    error?: string | null;
  } & React.InputHTMLAttributes<HTMLInputElement>
>(function Field({ label, optional, error, className, id, ...props }, ref) {
  const fieldId = id ?? `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="flex flex-col gap-[7px]">
      <label htmlFor={fieldId} className="font-ui text-[13px] font-bold leading-none text-text-primary">
        {label} {optional && <span className="font-medium text-text-tertiary">(optional)</span>}
      </label>
      <input
        id={fieldId}
        ref={ref}
        className={cn(
          'w-full rounded-[10px] border bg-surface-card px-4 py-[14px]',
          'font-ui text-[15px] font-medium text-text-primary placeholder:text-text-tertiary',
          'outline-none transition-colors focus:border-brand-primary',
          error ? 'border-error' : 'border-border',
          className,
        )}
        {...props}
      />
      {error && <span className="font-ui text-[12px] font-medium text-error">{error}</span>}
    </div>
  );
});

/** Read-only value row rendered like an input (verified / non-editable fields). */
export function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-[7px]">
      <span className="font-ui text-[13px] font-bold leading-none text-text-primary">{label}</span>
      <div className="rounded-[10px] border border-border bg-neutral-200 px-4 py-[14px] font-ui text-[15px] font-medium leading-none text-text-secondary">
        {value}
      </div>
    </div>
  );
}

/** 42×24 pill switch, brand-primary when on. */
export function Toggle({
  checked,
  onChange,
  disabled,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-[44px] flex-none rounded-pill transition-colors disabled:opacity-50',
        checked ? 'bg-brand-primary' : 'bg-neutral-300',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] ring-1 ring-black/5 transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
