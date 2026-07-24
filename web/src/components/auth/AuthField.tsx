'use client';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

/** Labeled text input matching the register / create-profile field style. */
export const AuthField = forwardRef<
  HTMLInputElement,
  {
    label: string;
    optional?: boolean;
    hint?: string;
    /** Inline validation message, rendered in place of `hint` (same as `Field`). */
    error?: string | null;
  } & React.InputHTMLAttributes<HTMLInputElement>
>(function AuthField({ label, optional, hint, error, className, id, ...props }, ref) {
  const fieldId = id ?? `f-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <div className="flex flex-col gap-[7px]">
      <label htmlFor={fieldId} className="font-ui text-[13px] font-bold leading-none text-text-primary">
        {label}{' '}
        {optional && <span className="font-medium text-text-tertiary">(optional)</span>}
      </label>
      <input
        id={fieldId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        className={cn(
          'w-full rounded-[10px] border bg-surface-card px-4 py-[14px]',
          'font-ui text-[15px] font-medium text-text-primary placeholder:text-text-tertiary',
          'outline-none transition-colors focus:border-brand-primary',
          error ? 'border-error' : 'border-border',
          className,
        )}
        {...props}
      />
      {error ? (
        <span className="font-ui text-[12px] font-medium text-error">{error}</span>
      ) : (
        hint && <span className="font-ui text-[13px] font-medium text-text-tertiary">{hint}</span>
      )}
    </div>
  );
});
