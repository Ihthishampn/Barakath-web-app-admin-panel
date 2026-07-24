import { cn } from '@/lib/cn';

type Theme = 'primary' | 'gold' | 'neutral';
type Size = 'l' | 'm' | 's';

const THEME: Record<Theme, { solid: string; outline: string }> = {
  primary: {
    solid: 'bg-brand-primary text-white hover:bg-brand-primary-dark',
    outline: 'border border-brand-primary text-brand-primary hover:bg-brand-primary-subtle',
  },
  gold: {
    solid: 'bg-brand-gold text-white hover:bg-brand-gold-strong',
    outline: 'border border-brand-gold text-brand-gold-strong hover:bg-brand-gold-subtle',
  },
  neutral: {
    solid: 'bg-text-primary text-white hover:opacity-90',
    outline: 'border border-border-default text-text-primary hover:bg-neutral-200',
  },
};
const SIZE: Record<Size, string> = {
  l: 'h-[52px] px-6 text-[15px]',
  m: 'h-[42px] px-5 text-[14px]',
  s: 'h-9 px-4 text-[13px]',
};

export function Button({
  theme = 'primary',
  size = 'm',
  outline = false,
  block = false,
  className,
  ...props
}: {
  theme?: Theme;
  size?: Size;
  outline?: boolean;
  block?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-pill font-ui font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        outline ? THEME[theme].outline : THEME[theme].solid,
        SIZE[size],
        block && 'w-full',
        className,
      )}
      {...props}
    />
  );
}
