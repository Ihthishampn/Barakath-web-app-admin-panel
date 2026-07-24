'use client';
import Link from 'next/link';

/** Standalone signed-out gate mirroring AccountShell's card (prototype). */
export function SignInGate({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mx-auto grid max-w-page place-items-center px-5 py-24 sm:px-10">
      <div className="rounded-2xl border border-border-subtle bg-surface-card px-8 py-12 text-center">
        <p className="font-display text-lg font-extrabold text-text-primary">{title}</p>
        <p className="mt-2 font-ui text-sm text-text-secondary">{subtitle}</p>
        <Link
          href="/signin"
          className="mt-5 inline-flex h-11 items-center rounded-pill bg-brand-primary px-6 font-ui text-sm font-bold text-white hover:bg-brand-primary-dark"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
