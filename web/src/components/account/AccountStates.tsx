import Link from 'next/link';
import { RiInboxLine, RiErrorWarningLine, RiRefreshLine, RiSearchEyeLine } from '@remixicon/react';
import { cn } from '@/lib/cn';
import { TONE_PILL } from './OrderStatusPill';
import type { StatusTone } from './orders';

/** Neutral shimmer block for loading skeletons. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-neutral-200', className)} />;
}

/** Card-shaped skeleton mirroring an OrderCard while orders load. */
export function OrderCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="flex items-center gap-3.5">
        <Skeleton className="h-14 w-14 flex-none rounded-[10px]" />
        <Skeleton className="h-14 w-14 flex-none rounded-[10px]" />
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-9 w-24 rounded-pill" />
      </div>
    </div>
  );
}

/** Empty-orders state with a Shop link. */
export function EmptyOrders({ message = 'No orders yet' }: { message?: string }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-border-subtle bg-surface-card px-8 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-brand-primary-subtle text-brand-primary">
        <RiInboxLine size={26} />
      </span>
      <p className="mt-4 font-display text-lg font-extrabold text-text-primary">{message}</p>
      <p className="mt-1.5 font-ui text-sm text-text-secondary">
        When you place an order, it&apos;ll show up here.
      </p>
      <Link
        href="/listing"
        className="mt-5 inline-flex h-11 items-center rounded-pill bg-brand-primary px-6 font-ui text-sm font-bold text-white hover:bg-brand-primary-dark"
      >
        Start shopping
      </Link>
    </div>
  );
}

/**
 * Generic error state.
 *
 * `onRetry` renders the way out. Telling someone something failed and offering
 * them nothing but the browser's reload button is not an error state, it's a
 * dead end — so every caller that can re-run its read passes one.
 */
export function ErrorState({
  message = 'Something went wrong loading this. Please try again.',
  onRetry,
  retryLabel = 'Try again',
}: {
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-border-subtle bg-surface-card px-8 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-error-subtle text-error">
        <RiErrorWarningLine size={26} />
      </span>
      <p className="mt-4 font-display text-lg font-extrabold text-text-primary">Couldn&apos;t load</p>
      <p className="mt-1.5 max-w-sm font-ui text-sm text-text-secondary">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex h-11 items-center gap-2 rounded-pill bg-brand-primary px-6 font-ui text-sm font-bold text-white hover:bg-brand-primary-dark"
        >
          <RiRefreshLine size={17} /> {retryLabel}
        </button>
      )}
    </div>
  );
}

/** Order not-found state with a back-to-orders link. */
export function OrderNotFound() {
  return (
    <div className="grid place-items-center rounded-2xl border border-border-subtle bg-surface-card px-8 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-surface-app text-text-tertiary">
        <RiSearchEyeLine size={26} />
      </span>
      <p className="mt-4 font-display text-lg font-extrabold text-text-primary">Order not found</p>
      <p className="mt-1.5 font-ui text-sm text-text-secondary">
        We couldn&apos;t find that order on your account.
      </p>
      <Link
        href="/account/orders"
        className="mt-5 inline-flex h-11 items-center rounded-pill bg-brand-primary px-6 font-ui text-sm font-bold text-white hover:bg-brand-primary-dark"
      >
        Back to orders
      </Link>
    </div>
  );
}

const BANNER_TONE: Record<StatusTone, string> = TONE_PILL;

/** Full-width soft status banner (prototype §orderDetail InfoBar). */
export function InfoBanner({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center rounded-xl px-4 py-3 font-ui text-sm font-semibold',
        BANNER_TONE[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Rounded product thumbnail — category tint behind a cover image. */
export function Thumb({
  src,
  tint,
  alt = '',
  className,
}: {
  src?: string | null;
  tint?: string | null;
  alt?: string;
  className?: string;
}) {
  return (
    <span
      className={cn('block h-14 w-14 flex-none overflow-hidden rounded-[10px] bg-cover bg-center', className)}
      style={{
        backgroundColor: tint || 'var(--surface-app)',
        backgroundImage: src ? `url('${src}')` : undefined,
      }}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
    />
  );
}
