'use client';
import { cn } from '@/lib/cn';

/**
 * A single ledger row: tinted icon disc, title + subtitle, signed amount
 * (prototype §wallet transaction history / §affiliate commission history).
 */
export function TxRow({
  Icon,
  iconBg,
  iconFg,
  title,
  subtitle,
  amount,
  amountClass,
  divider = true,
}: {
  Icon: React.ComponentType<{ size?: number | string; className?: string }>;
  iconBg: string;
  iconFg: string;
  title: string;
  subtitle: string;
  amount: string;
  amountClass: string;
  divider?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-[14px] px-5 py-4',
        divider && 'border-b border-border-subtle',
      )}
    >
      <span
        className={cn(
          'inline-flex h-10 w-10 flex-none items-center justify-center rounded-full',
          iconBg,
          iconFg,
        )}
      >
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-ui text-sm font-bold text-text-primary">{title}</div>
        <div className="mt-[3px] truncate font-ui text-xs font-medium text-text-tertiary">
          {subtitle}
        </div>
      </div>
      <span className={cn('font-display text-[15px] font-extrabold leading-none', amountClass)}>
        {amount}
      </span>
    </div>
  );
}
