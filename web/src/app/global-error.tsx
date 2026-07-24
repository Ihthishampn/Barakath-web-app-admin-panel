'use client';
/**
 * Last-resort boundary for errors thrown by the root layout itself. It REPLACES
 * the root layout when it renders, so it must supply its own <html>/<body> and
 * pull in the stylesheet directly.
 */
import { useEffect } from 'react';
import './globals.css';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div className="grid min-h-screen place-items-center px-4 py-16">
          <div className="grid w-full max-w-[560px] place-items-center rounded-2xl border border-border-subtle bg-surface-card px-8 py-16 text-center">
            <p className="font-display text-lg font-extrabold text-text-primary">Something went wrong</p>
            <p className="mt-1.5 max-w-sm font-ui text-sm text-text-secondary">
              Barakath couldn&apos;t load. Please try again.
            </p>
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-11 items-center rounded-pill bg-brand-primary px-6 font-ui text-sm font-bold text-white hover:bg-brand-primary-dark"
              >
                Try again
              </button>
              <a
                href="/"
                className="inline-flex h-11 items-center rounded-pill border border-border-default px-6 font-ui text-sm font-bold text-text-primary hover:bg-surface-app"
              >
                Go home
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
