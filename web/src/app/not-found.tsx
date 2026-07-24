/**
 * 404 boundary — also what `notFound()` renders. Mirrors the empty/error
 * states in components/account/AccountStates so the visual language matches.
 */
import Link from 'next/link';
import { RiSearchEyeLine } from '@remixicon/react';

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-[560px] px-4 py-16">
      <div className="grid place-items-center rounded-2xl border border-border-subtle bg-surface-card px-8 py-16 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-surface-app text-text-tertiary">
          <RiSearchEyeLine size={26} />
        </span>
        <p className="mt-4 font-display text-lg font-extrabold text-text-primary">Page not found</p>
        <p className="mt-1.5 font-ui text-sm text-text-secondary">
          That page doesn&apos;t exist, or it may have moved.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex h-11 items-center rounded-pill bg-brand-primary px-6 font-ui text-sm font-bold text-white hover:bg-brand-primary-dark"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
