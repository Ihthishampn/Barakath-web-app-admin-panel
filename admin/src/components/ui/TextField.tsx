import { forwardRef, useId, useState } from 'react';
import { RiEyeLine, RiEyeOffLine } from '@remixicon/react';
import { cn } from '@/lib/cn';

export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  /** Adds a show/hide toggle for password fields. */
  reveal?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, error, hint, reveal, type = 'text', className, id, ...props }, ref) => {
    const autoId = useId();
    const fieldId = id ?? autoId;
    const [show, setShow] = useState(false);
    const inputType = reveal ? (show ? 'text' : 'password') : type;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={fieldId} className="font-ui text-[13px] font-medium text-text-secondary">
            {label}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            id={fieldId}
            type={inputType}
            className={cn(
              'h-11 w-full rounded-md border bg-surface-card px-3.5 font-ui text-sm text-text-primary',
              'placeholder:text-text-tertiary transition-colors',
              'focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20',
              error ? 'border-error focus:border-error focus:ring-error/20' : 'border-border-default',
              reveal && 'pr-11',
              className,
            )}
            aria-invalid={!!error}
            {...props}
          />
          {reveal && (
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
              aria-label={show ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {show ? <RiEyeOffLine size={18} /> : <RiEyeLine size={18} />}
            </button>
          )}
        </div>
        {error ? (
          <span className="font-ui text-xs text-error">{error}</span>
        ) : hint ? (
          <span className="font-ui text-xs text-text-tertiary">{hint}</span>
        ) : null}
      </div>
    );
  },
);
TextField.displayName = 'TextField';
