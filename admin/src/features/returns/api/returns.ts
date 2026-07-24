import { useMemo } from 'react';
import { collection, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { OrderRequest, OrderRequestStatus } from '@barkath/shared';
import { db, functions } from '@/lib/firebase';
import { useLiveCollection } from '@/hooks/firestoreCache';

export const RETURNS_KEY = 'orderRequests:all';

const millis = (t: { toMillis?: () => number } | null | undefined): number =>
  t && typeof t.toMillis === 'function' ? t.toMillis() : 0;

/**
 * All return requests, newest first, real-time.
 *
 * We deliberately DO NOT `orderBy('createdAt')` on the server: a request written
 * with a serverTimestamp shows `createdAt: null` on the writing client for a beat,
 * and — more importantly for the admin — any doc missing the field (or a project
 * without the single-field index) would be silently dropped from an ordered query,
 * making a real pending request "invisible". Fetching the whole (small) collection
 * and sorting in memory guarantees every request is shown. The `error` is passed
 * through so the UI can surface a denied/failed read instead of a blank list.
 */
export function useReturnsList() {
  const state = useLiveCollection<OrderRequest>(RETURNS_KEY, () =>
    query(collection(db, 'orderRequests')),
  );
  const data = useMemo(
    () => [...state.data].sort((a, b) => millis(b.createdAt) - millis(a.createdAt)),
    [state.data],
  );
  return { ...state, data };
}

export type ReturnTab = 'pending' | 'approved' | 'rejected';

export function returnTabOf(status: OrderRequestStatus): ReturnTab {
  if (status === 'approved' || status === 'completed') return 'approved';
  if (status === 'rejected' || status === 'cancelled') return 'rejected';
  return 'pending'; // pending, under_review
}

export function countReturns(list: OrderRequest[]): Record<ReturnTab, number> {
  const c: Record<ReturnTab, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const r of list) c[returnTabOf(r.status)]++;
  return c;
}

export function refundTargetLabel(method: OrderRequest['refundMethod']): string {
  if (method === 'wallet') return 'Normal wallet';
  if (method === 'gateway') return 'Original';
  return '—';
}

/**
 * Where a refund will actually land, for a request that has not been decided yet.
 *
 * Every request is created with `refundMethod: 'wallet'`
 * (functions/src/returns/requests.ts), but adminApproveOrderRequest rewrites it
 * to 'gateway' when Settings ▸ Storefront ▸ Returns has "Auto-refund to wallet"
 * OFF — so showing "Normal wallet" beforehand promises a wallet credit that will
 * never happen. Decided requests already carry the real destination.
 */
export function plannedRefundTargetLabel(r: OrderRequest, autoRefundToWallet: boolean): string {
  if (returnTabOf(r.status) === 'pending' && !autoRefundToWallet) return refundTargetLabel('gateway');
  return refundTargetLabel(r.refundMethod);
}

export function refundAmountPaise(r: OrderRequest): number {
  return r.refundAmountPaise ?? r.itemSnapshot.priceAtPurchasePaise * r.itemSnapshot.quantity;
}

// ── Privileged mutations (Cloud Functions — money / atomic) ─────────
/**
 * Approve a return. The result reports whether money actually moved:
 * `creditedToWallet` is false when auto-refund to wallet is off, in which case
 * the approval only records a debt the admin still has to pay out by hand.
 */
export interface ApproveReturnResult {
  amountPaise: number;
  creditedToWallet: boolean;
}

export async function approveReturn(requestId: string): Promise<ApproveReturnResult> {
  const call = httpsCallable<{ requestId: string }, { amountPaise?: number; creditedToWallet?: boolean }>(
    functions,
    'adminApproveOrderRequest',
  );
  const res = await call({ requestId });
  return {
    amountPaise: Number(res.data?.amountPaise ?? 0),
    // Older deployments return only { ok: true }; treat a missing flag as the
    // wallet credit the default settings perform, so the copy never regresses.
    creditedToWallet: res.data?.creditedToWallet !== false,
  };
}

export async function rejectReturn(requestId: string, reason: string): Promise<void> {
  const call = httpsCallable(functions, 'adminRejectOrderRequest');
  await call({ requestId, reason });
}
