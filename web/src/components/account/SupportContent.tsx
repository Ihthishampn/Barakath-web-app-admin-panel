'use client';
import { RiPhoneLine, RiChatSmile2Line, RiMailLine } from '@remixicon/react';
import type { RemixiconComponentType } from '@remixicon/react';
import { useSupportSettings, phoneDigits } from '@/lib/siteSettings';

/**
 * Help & support contact cards — mirrors the Figma design (Call us / WhatsApp /
 * Email), driven entirely by `settings/support` in Firestore rather than
 * hardcoded values.
 *
 * A card is only rendered when its detail is actually configured, so an unset
 * support phone doesn't render a dead "Call us" tile. WhatsApp reuses the
 * support phone (there is no separate field in the settings schema).
 */
interface Card {
  icon: RemixiconComponentType;
  tint: string;
  title: string;
  detail: string;
  href: string;
}

export function SupportContent() {
  const { data, loading } = useSupportSettings();

  if (loading) {
    return <p className="font-ui text-sm text-text-secondary">Loading…</p>;
  }

  const phone = phoneDigits(data?.supportPhone);
  const email = data?.supportEmail?.trim() ?? '';

  const cards: Card[] = [];
  if (phone) {
    cards.push({
      icon: RiPhoneLine,
      tint: 'text-brand-primary',
      title: 'Call us',
      detail: data!.supportPhone,
      href: `tel:${phone}`,
    });
    cards.push({
      icon: RiChatSmile2Line,
      tint: 'text-success',
      title: 'WhatsApp',
      detail: 'Chat with us',
      href: `https://wa.me/${phone}`,
    });
  }
  if (email) {
    cards.push({
      icon: RiMailLine,
      tint: 'text-brand-gold-strong',
      title: 'Email',
      detail: email,
      href: `mailto:${email}`,
    });
  }

  if (data?.supportEnabled === false || cards.length === 0) {
    return (
      <div className="max-w-[760px] rounded-[12px] border border-dashed border-border bg-surface-card px-6 py-12 text-center">
        <p className="font-display text-base font-extrabold text-text-primary">Support is unavailable right now</p>
        <p className="mt-2 font-ui text-sm text-text-secondary">
          Contact details haven’t been published yet. Please check back soon.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-[760px]">
      <div className="grid gap-3.5 sm:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <a
              key={c.title}
              href={c.href}
              target={c.href.startsWith('http') ? '_blank' : undefined}
              rel={c.href.startsWith('http') ? 'noreferrer' : undefined}
              className="flex flex-col items-center gap-1.5 rounded-[12px] border border-border bg-surface-card px-4 py-6 text-center transition-shadow hover:shadow-md"
            >
              <Icon size={22} className={c.tint} />
              <span className="font-ui text-[14px] font-bold text-text-primary">{c.title}</span>
              <span className="font-ui text-[12px] text-text-secondary">{c.detail}</span>
            </a>
          );
        })}
      </div>

      {data?.supportHours && (
        <p className="mt-4 font-ui text-[13px] text-text-secondary">
          Support hours: <span className="font-semibold text-text-primary">{data.supportHours}</span>
        </p>
      )}
    </div>
  );
}
