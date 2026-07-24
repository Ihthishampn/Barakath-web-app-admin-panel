import { RiArrowDownLine } from '@remixicon/react';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
}

/** Styled native select matching the prototype's field + ArrowDownLine chevron. */
export function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  required,
  error,
  className,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  className?: string;
}) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <span className="font-ui text-xs font-bold text-text-primary">
          {label}
          {required && <span className="text-error"> *</span>}
        </span>
      )}
      <div className="relative">
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'h-[42px] w-full appearance-none rounded-sm border bg-surface-card px-3 pr-9',
            'font-ui text-[13px] text-text-primary focus:outline-none disabled:opacity-50',
            error ? 'border-error focus:border-error' : 'border-border-default focus:border-brand-primary',
          )}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <RiArrowDownLine
          size={16}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary"
        />
      </div>
      {error && <span className="font-ui text-xs text-error">{error}</span>}
    </label>
  );
}
