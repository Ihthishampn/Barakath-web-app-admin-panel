'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatMoneyInt, type Product } from '@barkath/shared';
import { sellingPaise } from '@/lib/catalog';

/**
 * Hero right panel: the Featured product(s). One product → static image; several
 * → an auto-advancing crossfade carousel. Images are shown in full (contain) on
 * the category tint — never cropped.
 */
export function HeroFeatured({ products }: { products: Product[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (products.length <= 1 || paused) return;
    const t = setInterval(() => setI((x) => (x + 1) % products.length), 4500);
    return () => clearInterval(t);
  }, [products.length, paused]);

  const current = Math.min(i, products.length - 1);
  if (products.length === 0) return null;

  return (
    <div
      className="relative min-h-[260px] overflow-hidden md:h-full"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {products.map((p, idx) => (
        <Link
          key={p.id}
          href={`/product/${p.id}`}
          aria-hidden={idx !== current}
          tabIndex={idx === current ? 0 : -1}
          className="absolute inset-0 transition-opacity duration-700 ease-in-out"
          style={{
            opacity: idx === current ? 1 : 0,
            zIndex: idx === current ? 1 : 0,
          }}
        >
          {/* Image covers the whole panel, meeting all four corners. */}
          {p.images?.[0]?.url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.images[0].url} alt={p.name} className="h-full w-full object-cover" />
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent p-6">
            <div className="font-ui text-[11px] font-extrabold uppercase tracking-[0.16em] text-brand-gold">Featured</div>
            <div className="mt-1 line-clamp-1 font-display text-lg font-extrabold text-white">{p.name}</div>
            <div className="mt-0.5 font-display text-base font-extrabold text-white">{formatMoneyInt(sellingPaise(p))}</div>
          </div>
        </Link>
      ))}

      {products.length > 1 && (
        <div className="absolute bottom-4 right-5 z-10 flex gap-1.5">
          {products.map((_, idx) => (
            <button
              key={idx}
              aria-label={`Show featured ${idx + 1}`}
              onClick={(e) => {
                e.preventDefault();
                setI(idx);
              }}
              className={`h-1.5 rounded-pill transition-all ${idx === current ? 'w-5 bg-white' : 'w-1.5 bg-white/50 hover:bg-white/80'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
