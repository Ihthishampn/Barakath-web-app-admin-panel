import { cn } from '@/lib/cn';

/** Initials avatar — green circle, matches the prototype DS Avatar. */
export function Avatar({
  name,
  size = 30,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <span
      className={cn(
        'grid flex-none place-items-center rounded-pill bg-brand-primary-subtle font-ui font-bold text-brand-primary',
        className,
      )}
      style={{ height: size, width: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {initials || '·'}
    </span>
  );
}
