'use client';
import { useState } from 'react';
import { RiArrowDownSLine } from '@remixicon/react';
import { cn } from '@/lib/cn';
import { SupportContent } from '@/components/account/SupportContent';


const FAQS: { q: string; a: string }[] = [
  {
    q: 'How do I track my order?',
    a: 'Open My orders from your account, select the order and tap Track. You will see live status updates and the expected delivery date.',
  },
  {
    q: 'How does Spin & Win work?',
    a: 'Eligible orders unlock a spin. Rewards such as discount coupons or wallet credit are added to your account instantly and can be used on your next order.',
  },
  {
    q: 'What is the return policy?',
    a: 'Most items can be returned within 7 days of delivery if unused and in original packaging. Perfumes and personal-care items may have specific conditions shown on the product page.',
  },
  {
    q: 'How do wallet refunds work?',
    a: 'Approved refunds are credited to your Barakath wallet, usually within 24 hours. Wallet balance can be applied at checkout on any future order.',
  },
];

export default function SupportPage() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="mx-auto max-w-page px-5 py-8 sm:px-10">
      <h1 className="mb-5 font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Help &amp; support</h1>

      <div className="flex max-w-[720px] flex-col gap-3.5">
        <SupportContent />

        <div className="mt-2 overflow-hidden rounded-2xl border border-border-subtle bg-surface-card">
          <div className="border-b border-border-subtle px-5 py-[18px] font-display text-[15px] font-extrabold text-text-primary">FAQ</div>
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q} className="border-b border-border-subtle last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-ui text-[14px] font-semibold text-text-primary transition-colors hover:bg-surface-app"
                >
                  {f.q}
                  <RiArrowDownSLine
                    size={18}
                    className={cn('flex-none text-text-tertiary transition-transform', isOpen && 'rotate-180')}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-4 font-ui text-[13px] font-medium leading-[1.6] text-text-secondary">{f.a}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
