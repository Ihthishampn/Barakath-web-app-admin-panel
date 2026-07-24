'use client';
/**
 * Route-level error boundary. Without this any render error anywhere in the
 * tree renders a blank white page with no way back.
 */
import { useEffect } from 'react';
import Link from 'next/link';
import { ErrorState } from '@/components/account/AccountStates';

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Server-side digests are all we get in production — log for debugging.
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-[560px] px-4 py-16">
      <ErrorState message="Something went wrong displaying this page. Please try again." />
      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center rounded-pill bg-brand-primary px-6 font-ui text-sm font-bold text-white hover:bg-brand-primary-dark"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-pill border border-border-default px-6 font-ui text-sm font-bold text-text-primary hover:bg-surface-app"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
