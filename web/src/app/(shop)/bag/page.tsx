'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RiDeleteBinLine, RiShoppingBagLine } from '@remixicon/react';
import { toast } from 'sonner';
import { collection, documentId, onSnapshot, query, where } from 'firebase/firestore';
import { formatMoney2dp, type Product } from '@barkath/shared';
import { orderLimitError, setQtyError, useCart, type CartLine } from '@/lib/cart';
import { db } from '@/lib/firebase';
import { lineStock } from '@/components/catalog/stock';
import { Button } from '@/components/ui/Button';
import { OrderSummary } from '@/components/checkout/OrderSummary';
import { QtyStepper } from '@/components/checkout/QtyStepper';
import { CouponRewardBanner } from '@/components/checkout/CouponRewardBanner';
import {
  computeSummary,
  useCheckoutDraft,
  useStoreSettings,
} from '@/components/checkout/checkout';

export default function BagPage() {
  const router = useRouter();
  const lines = useCart((s) => s.lines);
  const setQty = useCart((s) => s.setQty);
  const remove = useCart((s) => s.remove);
  const subtotalPaise = useCart((s) => s.subtotalPaise());
  const hydrate = useCart((s) => s.hydrate);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    hydrate();
    setMounted(true);
  }, [hydrate]);

  const { settings } = useStoreSettings();
  const coupon = useCheckoutDraft((s) => s.coupon);

  const summary = useMemo(
    () => computeSummary(subtotalPaise, settings, { coupon }),
    [subtotalPaise, settings, coupon],
  );

  const count = lines.reduce((n, l) => n + l.qty, 0);

  // Live availability per line. An item can sell out while the bag just sits
  // there, and it is better to say so here than to let the checkout page's
  // reserveStock reject the order and bounce the customer straight back.
  const stock = useLineStock(lines);
  // A line whose stock has not resolved yet is left alone rather than blocked.
  const blocked = lines.some((l) => {
    const available = stock[keyOf(l)];
    return available != null && available < l.qty;
  });

  // Avoid hydration mismatch: cart is client-only (localStorage).
  if (!mounted) {
    return (
      <div className="mx-auto max-w-page px-4 py-16 sm:px-10">
        <div className="h-8 w-40 animate-pulse rounded bg-neutral-200" />
      </div>
    );
  }

  if (lines.length === 0) return <EmptyBag />;

  return (
    <div className="mx-auto max-w-page px-4 pb-16 pt-7 sm:px-10">
      <h1 className="font-display text-3xl font-extrabold tracking-[-0.02em] text-text-primary">
        Your bag <span className="font-ui text-[15px] font-medium text-text-tertiary">· {count} {count === 1 ? 'item' : 'items'}</span>
      </h1>

      <div className="mt-6 flex flex-col items-start gap-8 lg:flex-row">
        {/* Items */}
        <div className="flex w-full flex-1 flex-col gap-3.5">
          {lines.map((l) => {
            const available = stock[keyOf(l)];
            return (
              <LineItem
                key={keyOf(l)}
                line={l}
                available={available}
                onDec={() => setQty(l.productId, l.variantId, l.qty - 1)}
                // Cap the stepper at what is actually sellable, so the bag can
                // never be raised into a quantity reserveStock will refuse…
                onInc={() => {
                  if (available != null && l.qty >= available) return;
                  // …and at the order caps the server enforces, which say why
                  // rather than leaving a dead + button.
                  const limit = setQtyError(lines, l.productId, l.variantId, l.qty + 1);
                  if (limit) {
                    toast.error(limit);
                    return;
                  }
                  setQty(l.productId, l.variantId, l.qty + 1);
                }}
                onRemove={() => remove(l.productId, l.variantId)}
              />
            );
          })}
        </div>

        {/* Summary */}
        <div className="flex w-full flex-col gap-4 lg:w-[360px] lg:flex-none">
          {/* Coupons & offers — the SAME component the checkout renders, so the
              bag surfaces the customer's spin rewards and qualifying promos
              (and the applied one) exactly as the Flutter app's bag does. */}
          <CouponRewardBanner compact />

          <OrderSummary summary={summary} totalLabel="Total" couponLabel={coupon?.code ?? 'Coupon'}>
            {/* Blocked while anything in the bag has gone unavailable — the
                per-line tag above says which one. Mirrors the app's checkout
                bar (app/lib/features/cart/bag_screen.dart). */}
            <Button
              theme="gold"
              size="l"
              block
              disabled={blocked}
              onClick={() => {
                // A bag can arrive over an order cap without ever passing
                // through this page's stepper — it is shared live with the
                // Flutter app and with other tabs. Say which cap, here, rather
                // than letting checkout fail at placeOrder.
                const limit = orderLimitError(lines, summary.totalPaise);
                if (limit) {
                  toast.error(limit);
                  return;
                }
                router.push('/checkout');
              }}
            >
              {blocked ? 'Out of stock' : 'Proceed to checkout'}
            </Button>
          </OrderSummary>
        </div>
      </div>
    </div>
  );
}

function LineItem({
  line,
  available,
  onDec,
  onInc,
  onRemove,
}: {
  line: CartLine;
  /** Live sellable units; `undefined` while the product doc hasn't resolved. */
  available: number | undefined;
  onDec: () => void;
  onInc: () => void;
  onRemove: () => void;
}) {
  const short = available != null && available < line.qty;
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border-subtle bg-surface-card p-4">
      <div
        className="h-20 w-20 flex-none overflow-hidden rounded-xl border border-border-subtle bg-center bg-no-repeat p-1.5"
        style={{
          backgroundColor: line.categoryTint || '#e6cfb4',
          backgroundImage: line.imageUrl ? `url(${line.imageUrl})` : undefined,
          backgroundSize: 'contain',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-ui text-base font-bold text-text-primary">{line.name}</div>
        {line.variantLabel && (
          <div className="mt-0.5 font-ui text-[13px] font-medium text-text-tertiary">{line.variantLabel}</div>
        )}
        {/* Same error-subtle/error pill the storefront already uses for an
            unavailable state — names the line that is blocking checkout. */}
        {short && (
          <span className="mt-1.5 inline-flex items-center rounded-pill bg-error-subtle px-2.5 py-1 font-ui text-[11px] font-bold text-error">
            {available === 0 ? 'Out of stock' : `Only ${available} left`}
          </span>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="mt-2 inline-flex items-center gap-1 font-ui text-[13px] font-semibold text-text-tertiary transition-colors hover:text-error sm:hidden"
        >
          <RiDeleteBinLine size={15} /> Remove
        </button>
      </div>

      <QtyStepper qty={line.qty} onDec={onDec} onInc={onInc} />

      <div className="w-24 text-right font-display text-[17px] font-extrabold text-brand-gold-strong">
        {formatMoney2dp(line.pricePaise * line.qty)}
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove item"
        className="hidden h-9 w-9 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-error-subtle hover:text-error sm:flex"
      >
        <RiDeleteBinLine size={18} />
      </button>
    </div>
  );
}

/** `productId:variantId` — the identity of a bag line (same key the list uses). */
const keyOf = (l: CartLine) => `${l.productId}:${l.variantId ?? ''}`;

/**
 * Live sellable units per bag line, keyed by {@link keyOf}. Mirrors
 * `CheckoutRepository.watchLineStock` in the Flutter app, and resolves each
 * line with the same arithmetic the server uses (see `lineStock`).
 *
 * Firestore caps an `in` filter at 30 ids, so the products are queried in
 * chunks and the snapshots merged. Nothing is reported until EVERY chunk has
 * come back — a half-built map would read as "0 units" for the lines still in
 * flight and would block checkout on a product that is perfectly in stock. A
 * failed read is swallowed for the same reason: availability is advisory here,
 * `reserveStock` remains the authority.
 */
function useLineStock(lines: CartLine[]): Record<string, number | undefined> {
  const ids = useMemo(
    () => [...new Set(lines.map((l) => l.productId))].sort(),
    // Re-subscribe only when the SET of products changes, not on every quantity
    // edit — otherwise each tap on +/− tears down and rebuilds the listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines.map((l) => l.productId).sort().join(',')],
  );

  const [state, setState] = useState<{ ready: boolean; byId: Record<string, Product> }>({
    ready: false,
    byId: {},
  });

  useEffect(() => {
    if (ids.length === 0) {
      setState({ ready: true, byId: {} });
      return;
    }
    // Keep whatever was already resolved (avoids a flash of "unavailable" when
    // a line is added) but stop reporting until the new set has fully loaded.
    setState((s) => ({ ready: false, byId: s.byId }));

    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    const reported = new Set<number>();

    const unsubs = chunks.map((chunk, index) =>
      onSnapshot(
        query(collection(db, 'products'), where(documentId(), 'in', chunk)),
        (snap) => {
          reported.add(index);
          setState((s) => {
            const byId = { ...s.byId };
            for (const d of snap.docs) byId[d.id] = d.data() as Product;
            // A doc that never comes back was deleted; `lineStock(undefined)`
            // resolves it to zero once every chunk has reported.
            for (const id of chunk) if (!snap.docs.some((d) => d.id === id)) delete byId[id];
            return { ready: reported.size === chunks.length, byId };
          });
        },
        () => {},
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [ids]);

  return useMemo(() => {
    if (!state.ready) return {};
    const out: Record<string, number> = {};
    for (const l of lines) out[keyOf(l)] = lineStock(state.byId[l.productId], l.variantId);
    return out;
  }, [state, lines]);
}

function EmptyBag() {
  return (
    <div className="mx-auto flex max-w-page flex-col items-center px-4 py-24 text-center sm:px-10">
      <div className="grid h-20 w-20 place-items-center rounded-full bg-brand-primary-subtle text-brand-primary">
        <RiShoppingBagLine size={36} />
      </div>
      <h1 className="mt-6 font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Your bag is empty</h1>
      <p className="mt-2 max-w-sm font-ui text-[15px] text-text-secondary">
        Discover small-batch perfumes, premium books and Islamic essentials — then come back to check out.
      </p>
      <Link href="/listing" className="mt-7">
        <Button theme="gold" size="l">Start shopping</Button>
      </Link>
    </div>
  );
}
