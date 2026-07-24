import { cn } from '@/lib/cn';

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-[42px] flex-none rounded-pill transition-colors disabled:opacity-50',
        checked ? 'bg-brand-primary' : 'bg-neutral-300',
      )}
    >
      <span
        className={cn(
          'absolute top-[3px] h-[18px] w-[18px] rounded-pill bg-white shadow-sm transition-all',
          checked ? 'left-[21px]' : 'left-[3px]',
        )}
      />
    </button>
  );
}
