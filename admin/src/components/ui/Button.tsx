import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

const button = cva(
  'inline-flex items-center justify-center gap-2 font-ui font-semibold transition-colors ' +
    'disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-brand-primary/40',
  {
    variants: {
      variant: {
        primary: 'bg-brand-primary text-white hover:bg-brand-primary-dark',
        gold: 'bg-brand-gold text-[#1a1a1a] hover:brightness-95',
        outline:
          'bg-surface-card text-text-primary border border-border-default hover:bg-neutral-200',
        danger: 'bg-error text-white hover:brightness-95',
        ghost: 'bg-transparent text-brand-primary hover:bg-brand-primary-subtle',
      },
      size: {
        sm: 'h-9 px-3 text-[13px] rounded-sm',
        md: 'h-11 px-4 text-sm rounded-md',
        lg: 'h-12 px-5 text-[15px] rounded-md',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(button({ variant, size, block }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
