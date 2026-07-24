import { useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Renders the real Barkath logo (public/images/logo.png — the asset referenced
 * by the prototype). If that file is missing it falls back to a wordmark so the
 * UI never silently ships a fabricated logo. Drop the real logo.png in and it
 * appears automatically (asset-preservation rule).
 */
export function BrandLogo({
  className,
  height = 34,
  withWordmark = true,
}: {
  className?: string;
  height?: number;
  withWordmark?: boolean;
}) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <span className={cn('inline-flex items-center gap-2', className)}>
        <span
          aria-hidden
          className="grid place-items-center rounded-md bg-brand-primary text-brand-gold"
          style={{ height, width: height, fontSize: height * 0.5 }}
        >
          ◈
        </span>
        {withWordmark && (
          <span
            className="font-display font-extrabold tracking-tight text-brand-primary"
            style={{ fontSize: height * 0.5 }}
          >
            Barakath
          </span>
        )}
      </span>
    );
  }

  return (
    <img
      src="/images/logo.png"
      alt="Barakath"
      style={{ height, width: 'auto' }}
      className={cn('object-contain', className)}
      onError={() => setBroken(true)}
    />
  );
}
