'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Banner } from '@barkath/shared';
import { bannerHref } from '@/lib/banners';
import { cn } from '@/lib/cn';

const AUTOPLAY_MS = 6000;

/**
 * Admin-published hero banners (Growth ▸ Banner, web placement / 3:1 artwork).
 *
 * Occupies the same 440px slot as the built-in hero so the page rhythm is
 * unchanged; the home page only renders this when at least one banner is live,
 * otherwise the original hero stays exactly as designed.
 */
export function HeroBanner({ banners }: { banners: Banner[] }) {
  const [i, setI] = useState(0);
  const count = banners.length;

  // Auto-advance only when there is something to advance to.
  useEffect(() => {
    if (count < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % count), AUTOPLAY_MS);
    return () => clearInterval(t);
  }, [count]);

  // A banner removed in the admin must not leave the index out of range.
  useEffect(() => {
    if (i >= count) setI(0);
  }, [i, count]);

  const active = banners[Math.min(i, count - 1)];
  if (!active) return null;

  return (
    <section className="relative h-[440px] w-full overflow-hidden bg-neutral-200">
      {banners.map((b, n) => (
        <Link
          key={b.id}
          href={bannerHref(b)}
          aria-hidden={n !== i}
          tabIndex={n === i ? 0 : -1}
          className={cn(
            'absolute inset-0 transition-opacity duration-700',
            n === i ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={b.imageUrl} alt={b.title} className="h-full w-full object-cover" />
          {/* Scrim keeps the title legible over arbitrary admin artwork. */}
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(90deg, rgba(27,23,18,0.72) 0%, rgba(27,23,18,0.25) 55%, rgba(27,23,18,0) 100%)' }}
          />
          {b.title && (
            <div className="absolute inset-y-0 left-0 flex max-w-[520px] flex-col justify-center px-6 sm:px-[64px]">
              <h1 className="font-display text-[40px] font-extrabold leading-[1.05] tracking-[-1.56px] text-white sm:text-[52px] sm:leading-[54.6px]">
                {b.title}
              </h1>
              <span className="mt-[28px] w-fit rounded-[8px] bg-brand-gold px-[21px] py-[14px] font-ui text-[16px] font-semibold leading-[16px] text-black">
                Shop now
              </span>
            </div>
          )}
        </Link>
      ))}

      {count > 1 && (
        <div className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 gap-2">
          {banners.map((b, n) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setI(n)}
              aria-label={`Show banner ${n + 1}`}
              aria-current={n === i}
              className={cn(
                'h-2 rounded-pill transition-all',
                n === i ? 'w-6 bg-brand-gold' : 'w-2 bg-white/50 hover:bg-white/80',
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
