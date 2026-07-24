'use client';
import { RiAddLine, RiSubtractLine } from '@remixicon/react';
import { cn } from '@/lib/cn';

/** −  [qty]  + stepper matching the bag prototype. */
export function QtyStepper({
  qty,
  onDec,
  onInc,
  disabled = false,
}: {
  qty: number;
  onDec: () => void;
  onInc: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center rounded-[10px] border border-border-default">
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={onDec}
        disabled={disabled}
        className={cn(
          'flex h-10 w-9 items-center justify-center text-text-primary transition-colors hover:bg-surface-app',
          'disabled:cursor-not-allowed disabled:opacity-40',
        )}
      >
        <RiSubtractLine size={16} />
      </button>
      <span className="w-7 text-center font-ui text-sm font-bold text-text-primary">{qty}</span>
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={onInc}
        disabled={disabled}
        className="flex h-10 w-9 items-center justify-center text-text-primary transition-colors hover:bg-surface-app disabled:cursor-not-allowed disabled:opacity-40"
      >
        <RiAddLine size={14} />
      </button>
    </div>
  );
}
