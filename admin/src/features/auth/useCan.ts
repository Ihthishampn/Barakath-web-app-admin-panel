import type { ModuleKey, PermissionAction } from '@barkath/shared';
import { useAuthStore } from './stores/authStore';

/**
 * Does the signed-in admin hold `module.action`?
 *
 * The sibling `useCanView` answers the READ question — should this screen fire
 * a listener at all — because Firestore rules are not filters and an
 * over-reaching query fails whole. This one answers the WRITE question: should
 * this screen even offer the Save / Delete / Approve / Cancel / Adjust button.
 *
 * It is NOT security. `requireModule` in the callables and `can()` in
 * firestore.rules are the enforcement, and they both re-read `admins/{uid}`
 * rather than trusting a claim. What this removes is the dead-end affordance: a
 * view-only sub-admin used to see every action control on every screen and
 * discover the denial only as a red toast after the write had already been
 * attempted.
 *
 * Super admins pass everything, exactly as `requireModule` lets them through.
 */
export function useCan(): (module: ModuleKey, action: PermissionAction) => boolean {
  const admin = useAuthStore((s) => s.admin);
  return (module, action) => {
    if (!admin) return false;
    if (admin.role === 'super_admin') return true;
    return admin.modulePermissions?.[module]?.[action] === true;
  };
}

/** Single-permission form of `useCan`, for screens that gate on exactly one. */
export function useCanDo(module: ModuleKey, action: PermissionAction): boolean {
  return useCan()(module, action);
}

/** True only for a super admin — the gate `auditLogs` and sub-admin tools use. */
export function useIsSuperAdmin(): boolean {
  return useAuthStore((s) => s.admin?.role === 'super_admin');
}

/**
 * The tooltip an action control carries when it is disabled for want of a
 * permission. Says which permission is missing, so the operator can ask for the
 * right thing instead of reporting "the button doesn't work".
 */
export function noPermissionTitle(module: ModuleKey, action: PermissionAction): string {
  return `You don’t have the ${module}.${action} permission.`;
}
