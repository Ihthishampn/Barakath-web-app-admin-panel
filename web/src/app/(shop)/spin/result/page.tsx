'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { RiGiftLine } from '@remixicon/react';
import { Button } from '@/components/ui/Button';

export default function SpinResultPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-page px-5 py-20 text-center font-ui text-sm text-text-tertiary sm:px-10">
          Loading…
        </div>
      }
    >
      <ResultBody />
    </Suspense>
  );
}

function ResultBody() {
  const params = useSearchParams();
  const label = params.get('label');
  const code = params.get('code');
  const prizeType = params.get('prizeType');
  const won = Boolean(label) && prizeType !== 'better_luck';

  const heading = won ? `You won ${label}!` : 'Better luck next time';
  const body = won
    ? code
      ? `Coupon ${code} has been added to your wallet — use it at checkout before it expires.`
      : 'Your reward has been added to your account.'
    : 'No prize this time — use another spin if you have one left.';

  return (
    <div className="mx-auto max-w-page px-5 py-8 sm:px-10">
      <div
        className="flex min-h-[560px] flex-col items-center justify-center rounded-[20px] px-6 text-center"
        style={{ background: 'linear-gradient(160deg,#fbf6e9,#f3e6c4)' }}
      >
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-gold text-white shadow-lg">
          <RiGiftLine size={44} />
        </div>
        <h1 className="mb-2.5 mt-7 font-display text-4xl font-extrabold leading-[1.1] tracking-[-0.02em] text-text-primary">
          {heading}
        </h1>
        <p className="max-w-[400px] font-ui text-base leading-relaxed text-text-secondary">{body}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3.5">
          {won && (
            <Link href="/coupons">
              <Button theme="gold" size="l">
                Save to coupons
              </Button>
            </Link>
          )}
          <Link href="/spin">
            <Button theme="neutral" outline size="l">
              Spin again
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
