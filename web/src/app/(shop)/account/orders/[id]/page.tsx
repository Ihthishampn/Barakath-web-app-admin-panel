'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  RiArrowLeftLine,
  RiTruckLine,
  RiFileTextLine,
  RiRefreshLine,
  RiMapPin2Line,
  RiBankCardLine,
  RiCloseCircleLine,
  RiStarLine,
  RiSecurePaymentLine,
} from '@remixicon/react';
import { formatMoney2dp, type Order, type OrderItem, type Review } from '@barkath/shared';
import { AccountShell } from '@/components/account/AccountShell';
import { InfoBanner, Thumb, ErrorState, OrderNotFound, Skeleton } from '@/components/account/AccountStates';
import { Button } from '@/components/ui/Button';
import {
  ReviewForm,
  useMyReviews,
  reviewStatusClass,
  reviewStatusLabel,
} from '@/components/reviews/ReviewForm';
import { collection, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import {
  useOrder,
  useOrderItems,
  statusBanner,
  fmtDate,
  isOpen,
  isCancellable,
  cancelOrder,
  returnBadge,
  type ReturnOutcome,
  hasReturnableItem,
  returnWindow,
} from '@/components/account/orders';
import { useReturnSettings } from '@/lib/siteSettings';
import { useCollection } from '@/lib/useCollection';
import { payForOrder, payOutcomeMessage } from '@/components/checkout/checkout';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { order, loading, error, notFound } = useOrder(id);
  const { data: items, loading: itemsLoading } = useOrderItems(id, order);

  // Open at the top. The orders list is long, so the window is usually scrolled
  // down when a card is tapped; because this page first renders a short skeleton
  // (order loads async), Next's App Router scroll heuristic thinks the top is
  // already in view and leaves the scroll where it was — landing the user near
  // the bottom once the real content fills in. Reset it explicitly on mount.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  return (
    <AccountShell>
      <Link
        href="/account/orders"
        className="mb-4 inline-flex items-center gap-1.5 font-ui text-sm font-semibold text-text-secondary hover:text-text-primary"
      >
        <RiArrowLeftLine size={16} /> Back to orders
      </Link>

      {loading ? (
        <DetailSkeleton />
      ) : error ? (
        <ErrorState />
      ) : notFound || !order ? (
        <OrderNotFound />
      ) : (
        <OrderDetail order={order} items={items} itemsLoading={itemsLoading} />
      )}
    </AccountShell>
  );
}

function OrderDetail({
  order,
  items,
  itemsLoading,
}: {
  order: Order;
  items: OrderItem[];
  itemsLoading: boolean;
}) {
  const banner = statusBanner(order);
  // The refund outcome lives on the orderRequest, not on the order item — the
  // item only records `returnStatus: 'approved'`. Without this the badge said
  // "refund on the way" even after the wallet had already been credited.
  const { data: requests } = useCollection<ReturnOutcome & { orderId: string; status: string }>(
    () =>
      order.customerId
        ? query(
            collection(db, 'orderRequests'),
            where('orderId', '==', order.id),
            where('customerId', '==', order.customerId),
          )
        : null,
    [order.id, order.customerId],
  );
  // Newest decision wins when an order has had more than one request.
  const outcome = requests.find((r) => r.refundedAt) ?? requests[0] ?? null;
  const rb = returnBadge(items, outcome); // active return, if any
  // At least one item can still be returned. With no item docs loaded (older
  // orders that only carry itemsSummary) keep the action available — the
  // server has the final say.
  const canReturnMore = items.length === 0 || hasReturnableItem(items);
  // The return window is admin-controlled (Settings ▸ Storefront ▸ Returns).
  const { data: returnSettings } = useReturnSettings();
  const rw = order ? returnWindow(order, returnSettings?.windowDays) : null;
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // ── Outstanding payment ──────────────────────────────────────────────────
  // A Razorpay order is placed 'pending' and only becomes 'captured' by
  // verifyPayment, so a dismissed or declined sheet used to strand the order
  // with no way back to the gateway — until abandonedOrderSweep cancelled it
  // half an hour later. What is still owed is exactly what createRazorpayOrder
  // charges: the total less whatever the wallet already covered.
  const duePaise = Math.max(0, (order.totalPaise ?? 0) - (order.walletUsedPaise ?? 0));
  const unpaid = order.paymentStatus === 'pending' || order.paymentStatus === 'failed';
  const payable = order.paymentMethod === 'razorpay' && isOpen(order.status) && unpaid && duePaise > 0;
  const [paying, setPaying] = useState(false);

  async function payNow() {
    if (paying) return;
    setPaying(true);
    // Identical gateway sequence to checkout — one shared implementation, so
    // the failure handling (and markPaymentFailed) can't drift apart. The
    // server reuses this order's existing Razorpay order, so a retry can never
    // collect the money twice.
    const outcome = await payForOrder({
      orderId: order.id,
      shortId: order.shortId,
      prefill: {
        name: customer?.name,
        email: customer?.email ?? undefined,
        contact: customer?.phone,
      },
    });
    setPaying(false);
    // useOrder is a live subscription, so the status and this banner update on
    // their own the moment verifyPayment lands.
    if (outcome.status === 'paid') {
      toast.success('Payment received — thank you. Your order is confirmed.');
      return;
    }
    const { tone, text } = payOutcomeMessage(outcome);
    if (tone === 'error') toast.error(text);
    else toast.message(text);
  }

  // Reviews are offered here, and only here: the rules require a
  // customers/{uid}/purchases/{productId} doc, which is written when the order
  // is marked delivered. The customer's own reviews (any status) tell us which
  // products they've already covered, so we never offer a duplicate.
  const customer = useAuth((s) => s.customer);
  const { data: myReviews } = useMyReviews(order.status === 'delivered' ? customer?.uid : undefined);
  const reviewByProduct = new Map<string, Review>(myReviews.map((r) => [r.productId, r]));
  const [reviewFor, setReviewFor] = useState<string | null>(null); // productId

  async function doCancel() {
    setCancelling(true);
    const res = await cancelOrder(order.id);
    setCancelling(false);
    setConfirmCancel(false);
    // useOrder is live, so the status/banner update on their own.
    if (res.ok) toast.success('Order cancelled — any payment is refunded to your wallet.');
    else toast.error(res.message || 'Could not cancel this order.');
  }

  // Prefer the full line items (embedded array, else subcollection); fall back
  // to the order's lightweight summary array when neither is available.
  const lines =
    items.length > 0
      ? items.map((it) => ({
          key: it.id,
          productId: it.productId,
          name: it.productDisplayTitle || it.productName,
          variant: it.variantLabel,
          qty: it.quantity,
          imageUrl: it.imageUrl,
          tint: it.categoryTint,
          pricePaise: it.lineTotalPaise,
        }))
      : (order.itemsSummary ?? []).map((it, i) => ({
          key: `${it.productId}-${i}`,
          productId: it.productId,
          name: it.productName,
          variant: null as string | null,
          qty: it.quantity,
          imageUrl: it.imageUrl,
          tint: it.categoryTint,
          pricePaise: null as number | null,
        }));

  // Reviews are per PRODUCT, but an order can carry the same product twice (two
  // variants). Offer the affordance on its first line only, or the second line
  // would invite a duplicate the rules would accept as a second review.
  const seenProducts = new Set<string>();
  const reviewLine = new Set<string>(); // line keys that carry the review affordance
  lines.forEach((l) => {
    if (!l.productId || seenProducts.has(l.productId)) return;
    seenProducts.add(l.productId);
    reviewLine.add(l.key);
  });

  return (
    <>
      <h1 className="mb-4 font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
        Order {order.shortId}
      </h1>

      <InfoBanner tone={banner.tone}>{banner.text}</InfoBanner>

      {/* Payment still owed — say what is due and why it matters. */}
      {payable && (
        <InfoBanner tone={order.paymentStatus === 'failed' ? 'error' : 'gold'} className="mt-3">
          {order.paymentStatus === 'failed' ? 'Payment failed' : 'Payment pending'} ·{' '}
          {formatMoney2dp(duePaise)} due. We&apos;re holding your items — pay now to confirm this order.
        </InfoBanner>
      )}

      {/* Items */}
      <section className="mt-4 rounded-2xl border border-border-subtle bg-surface-card p-5">
        {itemsLoading && items.length === 0 ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border-subtle">
            {lines.map((l) => {
              // Review affordance: delivered orders only (the rules' purchases
              // doc doesn't exist before that), signed in, once per product.
              const mine = reviewByProduct.get(l.productId);
              const canReview =
                order.status === 'delivered' && !!customer && reviewLine.has(l.key) && !mine;
              return (
                <div key={l.key} className="py-3.5 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3.5">
                    <Thumb src={l.imageUrl} tint={l.tint} alt={l.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-ui text-sm font-bold text-text-primary">
                        {l.name}
                        {l.variant ? ` · ${l.variant}` : ''}
                      </p>
                      <p className="mt-0.5 font-ui text-xs text-text-tertiary">Qty {l.qty}</p>
                    </div>
                    {l.pricePaise != null && (
                      <span className="font-display text-[15px] font-extrabold text-brand-gold-strong">
                        {formatMoney2dp(l.pricePaise)}
                      </span>
                    )}
                  </div>

                  {/* Already reviewed — show where it stands (a pending review is
                      readable by its own author) instead of a second form. */}
                  {order.status === 'delivered' && mine && reviewLine.has(l.key) && (
                    <span
                      className={`mt-2.5 inline-flex items-center gap-1 rounded-pill px-2.5 py-1 font-ui text-[11px] font-bold ${reviewStatusClass(mine.status)}`}
                    >
                      <RiStarLine size={12} /> Your review · {reviewStatusLabel(mine.status)}
                    </span>
                  )}

                  {canReview && reviewFor !== l.productId && (
                    <Button
                      theme="primary"
                      size="s"
                      outline
                      className="mt-2.5"
                      onClick={() => setReviewFor(l.productId)}
                    >
                      <RiStarLine size={14} /> Write a review
                    </Button>
                  )}

                  {canReview && reviewFor === l.productId && customer && (
                    <div className="mt-3">
                      <ReviewForm
                        productId={l.productId}
                        customerId={customer.uid}
                        customerName={customer.name || 'Barakath customer'}
                        orderId={order.id}
                        onDone={() => setReviewFor(null)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Totals + Address + Payment */}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-border-subtle bg-surface-card p-5">
          <h2 className="mb-3 font-ui text-sm font-bold text-text-primary">Payment summary</h2>
          <dl className="flex flex-col gap-2 font-ui text-sm">
            <Row label="Subtotal" value={formatMoney2dp(order.subtotalPaise)} />
            {/* ONE discount row. placeOrder derives the spin reward FROM the
                coupon discount rather than in addition to it —
                `spinRewardPaise = userCouponId && userCouponSource === 'spin'
                ? Math.max(0, discountPaise) : 0` (functions/src/orders/checkout.ts)
                — so on a spin order spinRewardPaise === discountPaise and it is
                a LABEL for that money, not a second reduction. Rendering both
                double-counted it and stopped the summary reconciling to Total
                paid. Mirrors app/lib/features/orders/data/order.dart. */}
            {order.discountPaise > 0 && (
              <Row
                label={order.spinRewardPaise > 0 ? 'Spin reward' : 'Discount'}
                value={`−${formatMoney2dp(order.discountPaise)}`}
                good
              />
            )}
            {order.walletUsedPaise > 0 && (
              <Row label="Wallet used" value={`−${formatMoney2dp(order.walletUsedPaise)}`} good />
            )}
            <Row
              label="Delivery"
              value={order.deliveryPaise > 0 ? formatMoney2dp(order.deliveryPaise) : 'Free'}
            />
            {/* KEEP: cash on delivery is no longer offered, but orders placed
                while it was were charged this — dropping the row would stop
                their summary reconciling to Total paid. 0 on every new order. */}
            {order.codSurchargePaise > 0 && (
              <Row label="COD charge" value={formatMoney2dp(order.codSurchargePaise)} />
            )}
            {order.taxPaise > 0 && <Row label="Tax" value={formatMoney2dp(order.taxPaise)} />}
            <div className="mt-1 border-t border-border-subtle pt-3">
              <div className="flex items-center justify-between font-display text-lg font-extrabold text-text-primary">
                <span>Total paid</span>
                <span>{formatMoney2dp(order.amountPaidPaise || order.totalPaise)}</span>
              </div>
            </div>
          </dl>
        </section>

        <div className="flex flex-col gap-4">
          <section className="rounded-2xl border border-border-subtle bg-surface-card p-5">
            <h2 className="mb-2 flex items-center gap-2 font-ui text-sm font-bold text-text-primary">
              <RiMapPin2Line size={16} className="text-text-tertiary" /> Delivery address
            </h2>
            <address className="font-ui text-sm not-italic leading-relaxed text-text-secondary">
              {/* Older/partial orders may not carry a snapshotted address. */}
              {order.deliveryAddress ? (
                <>
                  <span className="font-semibold text-text-primary">{order.deliveryAddress.name}</span>
                  <br />
                  {order.deliveryAddress.line1}
                  {order.deliveryAddress.line2 ? `, ${order.deliveryAddress.line2}` : ''}
                  <br />
                  {order.deliveryAddress.city}, {order.deliveryAddress.state} {order.deliveryAddress.pincode}
                  <br />
                  {order.deliveryAddress.phone}
                </>
              ) : (
                'No delivery address recorded on this order.'
              )}
            </address>
          </section>

          <section className="rounded-2xl border border-border-subtle bg-surface-card p-5">
            <h2 className="mb-2 flex items-center gap-2 font-ui text-sm font-bold text-text-primary">
              <RiBankCardLine size={16} className="text-text-tertiary" /> Payment
            </h2>
            <div className="flex items-center justify-between font-ui text-sm">
              <span className="text-text-secondary">{PAYMENT_LABEL[order.paymentMethod]}</span>
              <span className="font-semibold capitalize text-text-primary">
                {order.paymentStatus?.replace('_', ' ') ?? '—'}
              </span>
            </div>
            <p className="mt-1 font-ui text-xs text-text-tertiary">Placed {fmtDate(order.placedAt)}</p>
          </section>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {payable && (
          <button type="button" onClick={() => void payNow()} disabled={paying}>
            <ActionButton solid>
              <RiSecurePaymentLine size={17} />
              {paying ? 'Opening payment…' : `Pay ${formatMoney2dp(duePaise)} now`}
            </ActionButton>
          </button>
        )}
        {isOpen(order.status) && (
          <Link href={`/account/orders/${order.id}/track`}>
            <ActionButton solid>
              <RiTruckLine size={17} /> Track order
            </ActionButton>
          </Link>
        )}
        <Link href={`/account/orders/${order.id}/invoice`}>
          <ActionButton>
            <RiFileTextLine size={17} /> Download invoice
          </ActionButton>
        </Link>

        {/* Return: the badge reports an existing request on ANY item, so it must
            not hide the entry point for the order's other, still-returnable
            items — returns are per item, not per order. */}
        {/* Links through to My returns, where the #RP-xxxxxx reference support
            quotes is actually shown. */}
        {order.status === 'delivered' && rb && (
          <Link
            href="/account/returns"
            className={`inline-flex h-11 items-center gap-2 rounded-pill px-5 font-ui text-sm font-bold ${
              rb.done ? 'bg-success-subtle text-success' : 'bg-info-subtle text-info'
            }`}
          >
            <RiRefreshLine size={17} /> {rb.label}
          </Link>
        )}
        {order.status === 'delivered' &&
          (rw?.open && canReturnMore ? (
            <Link href={`/account/orders/${order.id}/return`}>
              <ActionButton danger>
                <RiRefreshLine size={17} /> Return item
                {rw.daysLeft > 0 && (
                  <span className="font-medium text-text-tertiary">
                    · {rw.daysLeft} day{rw.daysLeft === 1 ? '' : 's'} left
                  </span>
                )}
              </ActionButton>
            </Link>
          ) : rb ? null : (
            <span className="inline-flex h-11 items-center gap-2 rounded-pill bg-surface-app px-5 font-ui text-sm font-bold text-text-tertiary">
              <RiRefreshLine size={17} />
              {rw && rw.windowDays > 0 ? `Return window closed (${rw.windowDays} days)` : 'Returns unavailable'}
            </span>
          ))}

        {/* Cancel: only while cancellable; disabled/hidden once cancelled. */}
        {isCancellable(order.status) && (
          <button type="button" onClick={() => setConfirmCancel(true)} disabled={cancelling}>
            <ActionButton danger>
              <RiCloseCircleLine size={17} /> {cancelling ? 'Cancelling…' : 'Cancel order'}
            </ActionButton>
          </button>
        )}
      </div>

      {/* Cancel confirmation */}
      {confirmCancel && (
        <div
          className="fixed inset-0 z-50 grid place-items-center px-4"
          style={{ background: 'var(--scrim)' }}
          onMouseDown={(e) => e.target === e.currentTarget && setConfirmCancel(false)}
        >
          <div className="w-full max-w-[420px] rounded-2xl border border-border-subtle bg-surface-card p-7 shadow-lg">
            <h2 className="font-display text-lg font-extrabold text-text-primary">Cancel this order?</h2>
            <p className="mt-1.5 font-ui text-[13px] leading-relaxed text-text-secondary">
              Order {order.shortId} will be cancelled, the stock released, and any amount you paid refunded to your Barakath wallet. This can’t be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                className="inline-flex h-10 items-center rounded-pill border border-border-default px-5 font-ui text-sm font-bold text-text-primary hover:bg-neutral-200"
              >
                Keep order
              </button>
              <button
                type="button"
                onClick={() => void doCancel()}
                disabled={cancelling}
                className="inline-flex h-10 items-center rounded-pill bg-error px-5 font-ui text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
              >
                {cancelling ? 'Cancelling…' : 'Cancel order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** KEEP the 'cod' entry: checkout can no longer produce one, but historical
 *  orders carry it and must still name their method. */
const PAYMENT_LABEL: Record<Order['paymentMethod'], string> = {
  razorpay: 'Card / UPI (Razorpay)',
  cod: 'Cash on delivery',
  wallet: 'Barakath wallet',
};

function Row({ label, value, good = false }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-secondary">{label}</span>
      <span className={good ? 'font-semibold text-success' : 'font-semibold text-text-primary'}>
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  children,
  solid = false,
  danger = false,
}: {
  children: React.ReactNode;
  solid?: boolean;
  danger?: boolean;
}) {
  const base =
    'inline-flex h-11 items-center gap-2 rounded-pill px-5 font-ui text-sm font-bold transition-colors';
  const style = solid
    ? 'bg-brand-primary text-white hover:bg-brand-primary-dark'
    : danger
      ? 'border border-error text-error hover:bg-error-subtle'
      : 'border border-border-default text-text-primary hover:bg-neutral-200';
  return <span className={`${base} ${style}`}>{children}</span>;
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-11 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    </div>
  );
}
