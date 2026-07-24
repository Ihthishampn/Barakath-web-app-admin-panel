'use client';
import { useRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * 6-box OTP entry. Controlled via `value` (0-6 digit string) + `onChange`.
 * Auto-advances on type, backspaces to the previous box, supports paste.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.split('');

  function setChar(i: number, char: string) {
    const arr = value.padEnd(6, ' ').split('');
    arr[i] = char || ' ';
    const next = arr.join('').replace(/\s+$/g, '').replace(/\s/g, '');
    onChange(next);
    return next;
  }

  function handleChange(i: number, raw: string) {
    const char = raw.replace(/\D/g, '').slice(-1);
    if (!char) return;
    const next = setChar(i, char);
    if (i < 5) refs.current[i + 1]?.focus();
    if (next.length === 6) onComplete?.(next);
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    onChange(pasted);
    refs.current[Math.min(pasted.length, 5)]?.focus();
    if (pasted.length === 6) onComplete?.(pasted);
  }

  return (
    <div className="flex gap-2.5">
      {Array.from({ length: 6 }).map((_, i) => {
        const filled = Boolean(digits[i]);
        return (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            disabled={disabled}
            value={digits[i] ?? ''}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            aria-label={`Digit ${i + 1}`}
            className={cn(
              'h-11 w-11 flex-none rounded-[10px] text-center font-display text-lg font-extrabold text-text-primary',
              'outline-none transition-colors',
              filled ? 'border-2 border-brand-primary' : 'border-[1.5px] border-border',
              'focus:border-2 focus:border-brand-primary',
              disabled && 'opacity-60',
            )}
          />
        );
      })}
    </div>
  );
}
