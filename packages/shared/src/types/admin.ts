import type { BaseDoc, LedgerDoc, Ts } from './common.js';
import type {
  AdminRole,
  AdminStatus,
  ModulePermissions,
  NotificationAudience,
  NotificationSendMode,
  NotificationStatus,
} from '../enums.js';

// ── Admins (tech-arch §1.20) ───────────────────────────────────────
export interface Admin extends BaseDoc {
  uid: string;
  name: string;
  email: string;
  emailVerified: boolean;
  phone: string | null;
  avatarUrl: string | null;

  role: AdminRole;
  status: AdminStatus;
  suspendedAt: Ts | null;
  suspendedByUid: string | null;
  suspendReason: string | null;

  modulePermissions: ModulePermissions;

  mfaEnrolled: boolean;
  mfaMethod: 'totp' | null;
  mfaEnrolledAt: Ts | null;

  tokenRevokedAt: Ts | null;

  createdByUid: string;
  lastLoginAt: Ts | null;
  lastActiveAt: Ts | null;
  lastPasswordChangeAt: Ts | null;

  searchIndex: string[];
}

// ── Admin broadcast notification record (§7.14) ────────────────────
export interface AdminNotificationRecord extends BaseDoc {
  title: string;
  message: string;
  audience: NotificationAudience;
  deepLink: string;
  deepLinkTarget: string | null;
  sendMode: NotificationSendMode;
  scheduleAt: Ts | null;
  status: NotificationStatus;
  sentCount: number;
  openedCount: number;
  template: string | null;
  firedAt: Ts | null;
  createdBy: string;
}

// ── Compliance / audit log (§1.15) ─────────────────────────────────
export interface ComplianceLog extends LedgerDoc {
  actorUid: string;
  actorType: 'admin' | 'customer' | 'system';
  actorName: string;
  action: string;
  entity: string;
  entityId: string;
  amountPaise: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  meta: Record<string, unknown>;
}

// ── Per-admin alert (top bar bell) ─────────────────────────────────
export interface AdminAlert extends LedgerDoc {
  type:
    | 'new_order'
    | 'withdrawal_request'
    | 'low_stock'
    | 'return_request'
    | 'failed_payment'
    | 'campaign_ending';
  title: string;
  body: string;
  deepLink: string;
  read: boolean;
}
