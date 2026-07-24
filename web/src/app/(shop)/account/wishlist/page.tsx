'use client';
import Link from 'next/link';
import { toast } from 'sonner';
import { RiHeartLine, RiHeart3Fill, RiCloseLine, RiStarLine } from '@remixicon/react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { AccountShell } from '@/components/account/AccountShell';
import { ErrorState } from '@/components/account/AccountStates';
import { useWishlist, removeFromWishlist, priceLabel, type LiveWishlistItem } from '@/lib/wishlist';

export default function WishlistPage() {
  return (
    <AccountShell title="Wishlist">
      <WishlistBody />
    </AccountShell>
  );
}

function WishlistBody() {
  const { items, loading, error } = useWishlist();

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border-subtle bg-surface-card p-2.5">
            <div className="aspect-square w-full animate-pulse rounded-2xl bg-neutral-200" />
            <div className="space-y-2 px-1 pb-1 pt-2.5">
              <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-200" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-200" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // A failed read is NOT an empty wishlist. Saying "Your wishlist is empty"
  // when we simply couldn't load it told people their saved items were gone.
  if (error) {
    return (
      <ErrorState
        message="We couldn't load your wishlist just now. Your saved items are safe — please try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (items.length === 0) {
    return (
      <div className="grid place-items-center rounded-2xl border border-border-subtle bg-surface-card px-8 py-16 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-error-subtle text-error">
          <RiHeartLine size={30} />
        </div>
        <p className="mt-4 font-display text-lg font-extrabold text-text-primary">Your wishlist is empty</p>
        <p className="mt-1.5 max-w-sm font-ui text-sm text-text-secondary">
          Tap the heart on any product to save it here for later.
        </p>
        <Link href="/listing" className="mt-6">
          <Button theme="gold" size="l">Browse products</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((it) => (
        <WishlistCard key={it.id} item={it} />
      ))}
    </div>
  );
}

function WishlistCard({ item }: { item: LiveWishlistItem }) {
  // Prices and the discount badge come from the live product doc now, so this
  // percentage is the one on sale today rather than the one on the day it was
  // saved.
  const off =
    item.available && item.mrpPaise > item.sellingPaise
      ? Math.round(((item.mrpPaise - item.sellingPaise) / item.mrpPaise) * 100)
      : 0;
  const soldOut = item.available && !item.inStock;

  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await removeFromWishlist(item.productId);
      toast.message('Removed from your wishlist');
    } catch {
      toast.error("Couldn't remove that item. Please try again.");
    }
  }

  return (
    <Link
      href={`/product/${item.productId}`}
      className="group relative flex flex-col rounded-2xl border border-border-subtle bg-surface-card p-2.5 transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      {/* Remove */}
      <button
        type="button"
        onClick={remove}
        aria-label="Remove from wishlist"
        className="absolute right-3.5 top-3.5 z-10 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-text-secondary shadow-sm transition-colors hover:text-error"
      >
        <RiCloseLine size={16} />
      </button>

      {/* Image — thin tint frame, image fills with its own curved corners */}
      <div
        className="relative aspect-square w-full overflow-hidden rounded-2xl border border-border-subtle p-1.5"
        style={{ background: item.categoryTint || '#efeeea' }}
      >
        {item.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={item.name}
            className={cn(
              'h-full w-full rounded-xl object-cover transition-transform duration-300 group-hover:scale-105',
              // A product that can't be bought right now reads as muted rather
              // than being hidden — it stays saved, and stays findable.
              (!item.available || soldOut) && 'opacity-45 grayscale',
            )}
          />
        )}
        <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-error shadow-sm">
          <RiHeart3Fill size={13} />
        </span>
        {!item.available ? (
          <span className="absolute bottom-2 left-2 rounded-md bg-neutral-700 px-2 py-1 font-ui text-[11px] font-extrabold text-white">
            No longer sold
          </span>
        ) : soldOut ? (
          <span className="absolute bottom-2 left-2 rounded-md bg-neutral-700 px-2 py-1 font-ui text-[11px] font-extrabold text-white">
            Out of stock
          </span>
        ) : (
          off > 0 && (
            <span className="absolute bottom-2 left-2 rounded-md bg-error px-2 py-1 font-ui text-[11px] font-extrabold text-white">
              -{off}%
            </span>
          )
        )}
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-1 px-1 pb-1 pt-2.5">
        <div className="line-clamp-1 font-ui text-[13px] font-bold text-text-primary">{item.name}</div>
        {item.available && item.ratingCount > 0 && (
          <div className="flex items-center gap-1 font-ui text-[11px] text-text-secondary">
            <RiStarLine size={12} className="text-brand-gold" />
            <span className="font-semibold">{item.rating.toFixed(1)}</span>
            <span className="text-text-tertiary">({item.ratingCount})</span>
          </div>
        )}
        <div className="mt-auto flex items-baseline gap-1.5 pt-0.5">
          {item.available ? (
            <>
              <span className="font-display text-[15px] font-extrabold text-brand-gold-strong">{priceLabel(item.sellingPaise)}</span>
              {off > 0 && <span className="font-ui text-[11px] text-text-tertiary line-through">{priceLabel(item.mrpPaise)}</span>}
              {soldOut && <span className="font-ui text-[11px] font-semibold text-text-tertiary">Sold out</span>}
            </>
          ) : (
            <span className="font-ui text-[12px] font-semibold text-text-tertiary">
              We don&apos;t sell this any more
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
