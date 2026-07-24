'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { toast } from 'sonner';
import { RiCheckLine } from '@remixicon/react';
import { formatMoney2dp } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { estimateArrival, useCheckoutDraft, useStoreSettings } from '@/components/checkout/checkout';

export default function SuccessPage() {
  const router = useRouter();
  const uid = useAuth((s) => s.customer?.uid);
  const storePlaced = useCheckoutDraft((s) => s.placed);
  const reset = useCheckoutDraft((s) => s.reset);
  const { settings } = useStoreSettings();
  const [openingInvoice, setOpeningInvoice] = useState(false);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Snapshot the placed order into local state on first sight. The store reset
  // below (and React StrictMode's mount→unmount→remount, which fires that reset
  // between the two mounts) must not blank the confirmation — once captured,
  // the order id/amount are held locally for the life of this screen.
  const [placed, setPlaced] = useState(storePlaced);
  useEffect(() => {
    if (storePlaced) setPlaced(storePlaced);
  }, [storePlaced]);

  const arrivesBy = useMemo(
    () => placed?.arrivesBy ?? estimateArrival(settings.delivery),
    [placed, settings.delivery],
  );

  // Clear the store once we've captured the order, so a back/forward doesn't
  // resurrect a stale draft — the local snapshot keeps this screen intact.
  useEffect(() => {
    if (storePlaced) reset();
  }, [storePlaced, reset]);

  /**
   * Open the order's invoice screen. The draft only carries the human-readable
   * shortId, so resolve the document id from it (owner-scoped query). This used
   * to be a toast saying invoicing wasn't live — it has been all along.
   */
  async function openInvoice() {
    if (openingInvoice) return;
    if (!placed?.shortId || !uid) {
      router.push('/account/orders');
      return;
    }
    setOpeningInvoice(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, 'orders'),
          where('customerId', '==', uid),
          where('shortId', '==', placed.shortId),
          limit(1),
        ),
      );
      const id = snap.docs[0]?.id;
      if (id) router.push(`/account/orders/${id}/invoice`);
      else router.push('/account/orders');
    } catch {
      toast.error("Couldn't open your invoice just now. You'll find it under My orders.");
    } finally {
      setOpeningInvoice(false);
    }
  }

  if (!mounted) return <div className="min-h-[60vh]" />;

  return (
    <div className="mx-auto flex max-w-page flex-col items-center px-4 py-16 text-center sm:px-10">
      <div className="grid h-20 w-20 place-items-center rounded-full bg-brand-primary text-white shadow-[0_10px_30px_-8px_rgba(15,122,90,0.5)]">
        <RiCheckLine size={38} />
      </div>

      <h1 className="mt-7 font-display text-[34px] font-extrabold leading-[1.1] tracking-[-0.02em] text-text-primary">
        Nice — that&apos;s on its way!
      </h1>
      <p className="mt-2.5 max-w-[420px] font-ui text-base leading-relaxed text-text-secondary">
        We&apos;ll email your invoice and notify you when your Barakath order ships.
      </p>

      <div className="mt-8 flex w-full max-w-[520px] flex-col gap-3 rounded-2xl border border-border-subtle bg-surface-card p-6 text-left">
        <DetailRow label="Order ID" value={placed ? placed.shortId : 'Pending'} />
        <DetailRow
          label="Amount paid"
          value={placed ? formatMoney2dp(placed.amountPaise) : '—'}
          gold
        />
        <DetailRow label="Arrives by" value={arrivesBy} />
      </div>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-3.5">
        <Link href="/account/orders">
          <Button theme="primary" size="l">Track order</Button>
        </Link>
        <Button
          theme="neutral"
          size="l"
          outline
          onClick={() => void openInvoice()}
        >
          Download invoice
        </Button>
      </div>
    </div>
  );
}

function DetailRow({ label, value, gold = false }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className="flex items-center justify-between font-ui text-sm">
      <span className="font-medium text-text-tertiary">{label}</span>
      <span
        className={
          gold
            ? 'font-display font-extrabold text-brand-gold-strong'
            : 'font-bold text-text-primary'
        }
      >
        {value}
      </span>
    </div>
  );
}
