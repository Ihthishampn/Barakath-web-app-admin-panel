import Image from 'next/image';
import { cn } from '@/lib/cn';

/**
 * Left-hand promotional panel used by sign-in / register.
 * Dark warm gradient, white logo, big display heading with a gold accent word.
 */
export function AuthBrandPanel({
  title,
  accent,
  accentPosition = 'after',
  subtitle,
  glow = 'bottom-left',
}: {
  title: string;
  accent: string;
  /** where the gold accent sits relative to `title`. */
  accentPosition?: 'after' | 'before';
  subtitle: string;
  glow?: 'bottom-left' | 'top-right';
}) {
  return (
    <div className="relative hidden flex-1 flex-col justify-center overflow-hidden bg-gradient-to-br from-[#1b1712] via-[#33291a] to-[#4a3a22] px-[72px] lg:flex">
      <div
        className={cn(
          'pointer-events-none absolute h-[360px] w-[360px] rounded-full',
          'bg-[radial-gradient(circle,rgba(218,162,39,0.32),transparent_70%)]',
          glow === 'bottom-left' ? '-bottom-[100px] -left-20' : '-top-[90px] -right-[70px]',
        )}
      />
      <Image
        src="/images/logo.png"
        alt="Barakath"
        width={180}
        height={56}
        priority
        className="mb-8 h-14 w-auto self-start object-contain brightness-0 invert"
      />
      <h1 className="m-0 max-w-[400px] font-display text-[44px] font-extrabold leading-[1.1] tracking-[-0.03em] text-white">
        {accentPosition === 'before' && <span className="text-brand-gold">{accent} </span>}
        {title}
        {accentPosition === 'after' && <span className="text-brand-gold"> {accent}</span>}
      </h1>
      <p className="mt-5 max-w-[380px] font-ui text-base leading-[1.6] text-white/70">{subtitle}</p>
    </div>
  );
}
