'use client';
import { useEffect, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import type { FlashSale, Product } from '@barkath/shared';
import { db } from './firebase';
import { useCollection } from './useCollection';

/**
 * Demo-only flash-sale length, used when no admin sale is scheduled yet.
 * 2 h 30 m, restarted on every load and looped on reaching zero — see
 * {@link useFlashSaleCountdown}. Replace with admin-scheduled sales for prod.
 */
export const DEMO_FLASH_SALE_MS = (2 * 60 + 30) * 60 * 1000;

/**
 * The live flash sale, if one is running.
 *
 * Index-free: filter on `status` only (a single field) and check the time
 * window client-side, so no composite index is needed. Returns the first sale
 * whose window currently contains "now".
 */
export function useActiveFlashSale(): { sale: FlashSale | null; loading: boolean } {
  const { data, loading } = useCollection<FlashSale>(
    () => query(collection(db, 'flashSales'), where('status', '==', 'active')),
    [],
  );
  const now = Date.now();
  const sale =
    data.find((s) => {
      const starts = s.startsAt?.toMillis?.() ?? 0;
      const ends = s.endsAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
      return s.visibility !== 'hidden' && now >= starts && now <= ends;
    }) ?? null;
  return { sale, loading };
}

/**
 * Products belonging to the live flash sale, in the order the admin arranged
 * them. Falls back to any discounted product when no sale is configured, so the
 * rail still has something to show.
 */
export function flashSaleProducts(sale: FlashSale | null, products: Product[], fallback: Product[]): Product[] {
  if (!sale || sale.productIds.length === 0) return fallback;
  const byId = new Map(products.map((p) => [p.id, p]));
  return sale.productIds.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));
}

export interface Countdown {
  hours: string;
  minutes: string;
  seconds: string;
  done: boolean;
}

/**
 * Ticking countdown to a timestamp, formatted as the design's `02 : 14 : 09`.
 * Returns null when there's no target, so the caller can hide the pill.
 * Hours are not capped at 24 — a 3-day sale reads as `72`.
 */
export function useCountdown(targetMs: number | null): Countdown | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (targetMs == null) return;
    // Set immediately on mount (not during render) so server and first client
    // render agree — otherwise the ticking value causes a hydration mismatch.
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [targetMs]);

  if (targetMs == null || now == null) return null;

  const remaining = Math.max(0, targetMs - now);
  const totalSeconds = Math.floor(remaining / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    hours: pad(Math.floor(totalSeconds / 3600)),
    minutes: pad(Math.floor((totalSeconds % 3600) / 60)),
    seconds: pad(totalSeconds % 60),
    done: remaining === 0,
  };
}

/**
 * The Flash Sale heading countdown.
 *
 * PRODUCTION: pass the admin sale's `endsAt` (ms). Every visitor counts down to
 * the same instant, and the pill reaches 00:00:00 exactly when the sale ends —
 * at which point `useActiveFlashSale` stops returning the sale and the rail
 * clears itself, so the products are no longer shown until a new sale starts.
 *
 * DEMO (no admin schedule → `endsAtMs` null): start from 2 h 30 m on mount, and
 * when it hits zero reset back to 2 h 30 m and keep counting, so the section
 * always shows a live timer. Per-device by design — reopening the app restarts
 * it. Purely a stand-in until every flash sale is admin-scheduled.
 */
export function useFlashSaleCountdown(endsAtMs: number | null): Countdown | null {
  const [target, setTarget] = useState<number | null>(null);
  const demo = endsAtMs == null;

  useEffect(() => {
    // Real sale → count to its end; demo → 2 h 30 m from now (resets on reload).
    setTarget(demo ? Date.now() + DEMO_FLASH_SALE_MS : endsAtMs);
  }, [demo, endsAtMs]);

  const countdown = useCountdown(target);

  useEffect(() => {
    // Demo loop: the moment it reaches zero, restart the 2 h 30 m window.
    if (demo && countdown?.done) setTarget(Date.now() + DEMO_FLASH_SALE_MS);
  }, [demo, countdown?.done]);

  // While a demo reset is in flight the raw countdown is momentarily `done`;
  // report the fresh 2 h 30 m instead so the pill never flashes 00:00:00.
  if (demo && countdown?.done) return { hours: '02', minutes: '30', seconds: '00', done: false };
  return countdown;
}
