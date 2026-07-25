'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import type { Product } from '@barkath/shared';
import { ProductCard } from '@/components/product/ProductCard';
import { CategoryCard } from '@/components/home/CategoryCard';
import { FlashSaleCard } from '@/components/home/FlashSaleCard';
import { HeroBanner } from '@/components/home/HeroBanner';
import {
  useBestSellers,
  useCategories,
  useFlashSaleFlagged,
  useNewArrivalProducts,
  useProductsByIds,
} from '@/lib/catalog';
import { useActiveFlashSale, flashSaleProducts, useFlashSaleCountdown } from '@/lib/flashSale';
import { useWebBanners } from '@/lib/banners';

export default function HomePage() {
  const { data: categories, loading: catLoading } = useCategories();
  const { sale } = useActiveFlashSale();
  const { banners } = useWebBanners();

  // Rails are driven by the product flags set in the admin, not by re-sorting
  // one pool — so each section means something distinct and can legitimately
  // be empty. Each rail is now its OWN bounded Firestore query rather than a
  // client-side filter over the first 40 documents, so a best seller or a
  // flash-sale pick outside that slice can no longer go missing.
  // New arrivals are automatic: anything published within the last few days,
  // newest first — products age out of the rail on their own (no admin flag).
  const { data: newArrivals, loading: newLoading } = useNewArrivalProducts(5);
  const { data: bestSellers, loading: bestLoading } = useBestSellers(5);
  // Flash sale is opt-in per product (its own status) — not every discounted
  // product. An admin flash-sale campaign, when live, still takes precedence.
  const { data: flagged, loading: flaggedLoading } = useFlashSaleFlagged();
  const { data: campaign, loading: campaignLoading } = useProductsByIds(sale?.productIds);
  const flash = useMemo(
    () => flashSaleProducts(sale, campaign, flagged).slice(0, 5),
    [sale, campaign, flagged],
  );
  const flashLoading = flaggedLoading || campaignLoading;

  // Admin sale → count to its `endsAt`; otherwise a demo 2 h 30 m loop so the
  // heading always carries a live timer (see useFlashSaleCountdown).
  const countdown = useFlashSaleCountdown(sale?.endsAt?.toMillis?.() ?? null);

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      {/* Admin-published banners take over the hero slot; the designed hero
          below is the fallback when nothing is live. */}
      {banners.length > 0 ? (
      <HeroBanner banners={banners} />
      ) : (
      <section
        className="relative flex h-[440px] w-full flex-col justify-center overflow-hidden px-6 sm:px-[64px]"
        style={{
          background: 'linear-gradient(133.4deg, rgb(27,23,18) 0%, rgb(51,41,26) 55%, rgb(74,58,34) 100%)',
        }}
      >
        <div
          className="pointer-events-none absolute right-[-60px] top-[-90px] h-[340px] w-[340px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(218,162,39,0.35) 0%, rgba(218,162,39,0) 70%)' }}
        />
        <span className="relative mb-[16px] font-ui text-[12px] font-extrabold uppercase leading-[12px] tracking-[1.92px] text-brand-gold">
          Limited edition · The Eid edit
        </span>
        <h1 className="relative max-w-[480px] font-display text-[40px] font-extrabold leading-[1.05] tracking-[-1.56px] text-white sm:text-[52px] sm:leading-[54.6px]">
          Royal Oud, <span className="text-brand-gold">reimagined</span>
        </h1>
        <p className="relative mb-[28px] mt-[18px] max-w-[420px] font-ui text-[17px] font-normal leading-[25.5px] text-white/75">
          Hand-blended small-batch perfumes, premium books and Islamic essentials — delivered with care.
        </p>
        <div className="relative flex flex-wrap gap-[14px]">
          <Link
            href="/listing"
            className="rounded-[8px] bg-brand-gold px-[21px] py-[14px] font-ui text-[16px] font-semibold leading-[16px] text-black transition-colors hover:bg-brand-gold-strong"
          >
            Shop the collection
          </Link>
          <Link
            href="/categories"
            className="rounded-[8px] border border-border bg-white px-[21px] py-[14px] font-ui text-[16px] font-semibold leading-[16px] text-black transition-colors hover:bg-surface-app"
          >
            Explore categories
          </Link>
        </div>
      </section>
      )}

      {/* ── Shop by category ─────────────────────────────────────────── */}
      <SectionHeader title="Shop by category" href="/categories" />
      <div className="flex flex-wrap gap-[20px] px-6 pb-[8px] pt-[20px] sm:px-[40px]">
        {catLoading && categories.length === 0 ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[182px] min-w-[220px] flex-1 animate-pulse rounded-[12px] bg-neutral-200" />
          ))
        ) : categories.length === 0 ? (
          <EmptyRail label="Our categories are being set up — browse everything we sell in the meantime." />
        ) : (
          categories.slice(0, 4).map((c, i) => (
            <div key={c.id} className="min-w-[220px] flex-1">
              <CategoryCard category={c} index={i} />
            </div>
          ))
        )}
      </div>

      {/* ── Flash sale ───────────────────────────────────────────────── */}
      <SectionHeader
        title="Flash sale"
        href="/listing"
        badge={
          // Only alongside a live rail — no timer over an empty Flash sale.
          flash.length > 0 && countdown && !countdown.done ? (
            <span className="rounded-[6px] bg-error px-[8px] py-[4px] font-ui text-[13px] font-extrabold leading-[13px] tracking-[0.52px] text-white">
              {countdown.hours} : {countdown.minutes} : {countdown.seconds}
            </span>
          ) : null
        }
      />
      <Rail
        products={flash}
        loading={flashLoading}
        emptyLabel="No flash sale running right now — check back soon for limited-time offers."
        render={(p) => <FlashSaleCard product={p} />}
      />

      {/* ── New arrivals ─────────────────────────────────────────────── */}
      <SectionHeader title="New arrivals" href="/listing" />
      <Rail
        products={newArrivals}
        loading={newLoading}
        emptyLabel="Nothing new in the last few days — browse the full collection instead."
        render={(p) => <ProductCard product={p} />}
      />

      {/* ── Best sellers ─────────────────────────────────────────────── */}
      <SectionHeader title="Best sellers" href="/listing" />
      <div className="pb-[40px]">
        <Rail
          products={bestSellers}
          loading={bestLoading}
          emptyLabel="Our best sellers are on their way — explore the full collection meanwhile."
          render={(p) => <ProductCard product={p} />}
        />
      </div>
    </div>
  );
}

function SectionHeader({ title, href, badge }: { title: string; href: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-6 pb-[8px] pt-[40px] sm:px-[40px]">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-[26px] font-extrabold leading-[26px] tracking-[-0.52px] text-text-primary">
          {title}
        </h2>
        {badge}
      </div>
      <Link
        href={href}
        className="flex-none font-ui text-[14px] font-bold leading-[14px] text-brand-primary hover:underline"
      >
        View all
      </Link>
    </div>
  );
}

/**
 * A 5-up row of cards. The design is a fixed-width desktop frame using flex
 * with a 20px gap; we keep 5-up on wide screens and fall back to 2-up on mobile
 * so cards never squeeze below a readable width.
 */
function Rail({
  products,
  loading,
  emptyLabel,
  render,
}: {
  products: Product[];
  loading: boolean;
  emptyLabel: string;
  render: (p: Product) => React.ReactNode;
}) {
  if (loading && products.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-[20px] px-6 pb-[8px] pt-[20px] sm:grid-cols-3 sm:px-[40px] lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[240px] animate-pulse rounded-[12px] bg-neutral-200" />
        ))}
      </div>
    );
  }
  if (products.length === 0) {
    return (
      <div className="px-6 pb-[8px] pt-[20px] sm:px-[40px]">
        <EmptyRail label={emptyLabel} />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-[20px] px-6 pb-[8px] pt-[20px] sm:grid-cols-3 sm:px-[40px] lg:grid-cols-5">
      {products.map((p) => (
        <div key={p.id} className="flex flex-col">
          {render(p)}
        </div>
      ))}
    </div>
  );
}

function EmptyRail({ label }: { label: string }) {
  return (
    <div className="grid w-full place-items-center rounded-[12px] border border-dashed border-border bg-surface-card py-14 text-center font-ui text-sm text-text-secondary">
      {label}
    </div>
  );
}
