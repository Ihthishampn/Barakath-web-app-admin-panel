import { collection, limit, orderBy, query } from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useLiveCollection } from '@/hooks/firestoreCache';

/**
 * One `auditLogs` row, exactly as `writeAudit` (functions/src/_lib/guards.ts)
 * writes it. It is not in @barkath/shared — the collection is server-written and
 * super-admin-read-only, so the admin panel is its only reader.
 *
 * Shape confirmed against production: every row carries `actorType: 'admin'`,
 * an `actorName` (defaulted to the literal string 'admin' — no callable passes
 * a real one today, so the viewer resolves the name from `admins/{actorUid}`
 * instead), a nullable `amountPaise`, nullable `before`/`after` snapshots that
 * nothing populates yet, and a free-form `meta` map whose keys vary per action.
 */
export interface AuditLog {
  id: string;
  actorType: string;
  actorUid: string;
  actorName: string | null;
  action: string;
  entity: string;
  entityId: string;
  amountPaise: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  createdAt: Timestamp | null;
}

/**
 * The audit trail, newest first.
 *
 * Capped rather than unbounded: the collection only grows, and this screen is a
 * "who did that, and when" lookup over recent activity, not an archive reader.
 * The cap is generous enough that the date filter below always has something to
 * bite on, and the row count is surfaced in the UI so a full window is visibly
 * a window and not mistaken for "that's everything that ever happened".
 */
export const AUDIT_LIMIT = 500;
export const AUDIT_LOGS_KEY = `auditLogs:createdAt-desc:${AUDIT_LIMIT}`;

/**
 * `enabled` is the caller's super-admin status. firestore.rules exposes
 * `auditLogs` to super admins only (`allow read: if isSuperAdmin()`), and rules
 * are not filters — firing this listener as a sub-admin fails the whole thing
 * with permission-denied. So the screen decides not to subscribe, the same
 * pattern `useCustomersList(enabled)` already uses.
 */
export function useAuditLogs(enabled = true) {
  return useLiveCollection<AuditLog>(enabled ? AUDIT_LOGS_KEY : `${AUDIT_LOGS_KEY}:denied`, () =>
    enabled
      ? query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(AUDIT_LIMIT))
      : null,
  );
}

/**
 * Human labels for the actions `writeAudit` emits, gathered from every
 * `writeAudit(...)` call site in functions/src. An action with no entry here
 * still renders — prettified from its own dotted name — so a new server action
 * appears in the viewer the day it ships rather than being silently dropped.
 */
const ACTION_LABELS: Record<string, string> = {
  'affiliate.allocated': 'Affiliate allocated',
  'affiliate.revoked': 'Affiliate revoked',
  'affiliate.terms_updated': 'Affiliate terms updated',
  'category.tint_fanout': 'Category tint fan-out',
  'customer.blocked': 'Customer blocked',
  'customer.unblocked': 'Customer unblocked',
  'inventory.adjusted': 'Stock adjusted',
  'notification.broadcast': 'Notification broadcast',
  'order.status_changed': 'Order status changed',
  'order.shipment_assigned': 'Shipment assigned',
  'return.approved': 'Return approved',
  'return.rejected': 'Return rejected',
  'review.moderated': 'Review moderated',
  'spins.granted': 'Spins granted',
  'subadmin.created': 'Sub-admin created',
  'subadmin.updated': 'Sub-admin updated',
  'subadmin.suspended': 'Sub-admin suspended',
  'subadmin.reactivated': 'Sub-admin reactivated',
  'subadmin.deleted': 'Sub-admin deleted',
  'wallet.adjusted': 'Wallet adjusted',
  'withdrawal.approved': 'Withdrawal approved',
  'withdrawal.rejected': 'Withdrawal rejected',
};

export function actionLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const tail = action.includes('.') ? action.slice(action.indexOf('.') + 1) : action;
  const words = tail.replace(/[._]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type AuditTone = 'success' | 'info' | 'gold' | 'error' | 'neutral';

/**
 * Badge tone per action family. Reversals and refusals read red, money and
 * privilege changes read gold (the panel's "look at this" tone), routine
 * fulfilment reads info; everything else stays neutral so the exceptional rows
 * are the ones that stand out in a long list.
 */
export function actionTone(action: string): AuditTone {
  if (/(rejected|revoked|blocked|deleted|suspended)$/.test(action)) return 'error';
  if (action.startsWith('wallet.') || action.startsWith('withdrawal.') || action.startsWith('affiliate.')) {
    return 'gold';
  }
  if (action.startsWith('subadmin.')) return 'gold';
  if (action.startsWith('order.') || action.startsWith('inventory.')) return 'info';
  if (/(approved|unblocked|granted)$/.test(action)) return 'success';
  return 'neutral';
}

/**
 * Which admin screen this row is about, so an audit entry is one click from the
 * thing it happened to. Only entities the panel actually has a route for get a
 * link; the rest render as plain text rather than a link that 404s.
 */
export function entityLink(entity: string, entityId: string): string | null {
  switch (entity) {
    case 'orders':
      return `/orders/${entityId}`;
    case 'customers':
      return `/customers/${entityId}`;
    case 'products':
      return `/products/${entityId}`;
    case 'admins':
      return `/sub-admin/${entityId}`;
    case 'orderRequests':
      return '/refunds';
    case 'withdrawalRequests':
      return '/affiliate';
    case 'broadcasts':
      return '/notifications';
    default:
      return null;
  }
}

/** `{ from: 'packed', to: 'shipped' }` → `from: packed · to: shipped`. */
export function formatMeta(meta: Record<string, unknown> | null | undefined): string {
  if (!meta) return '';
  const entries = Object.entries(meta).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}: ${formatMetaValue(v)}`).join(' · ');
}

function formatMetaValue(v: unknown): string {
  if (v === null) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Every distinct value of one field in the loaded rows, sorted, for a filter. */
export function distinctValues(rows: AuditLog[], field: 'action' | 'entity'): string[] {
  return [...new Set(rows.map((r) => r[field]).filter(Boolean))].sort();
}
