import type { ModuleKey } from '@barkath/shared';
import { useAuthStore } from './stores/authStore';

/**
 * Does the signed-in admin hold `view` on any of these modules?
 *
 * The sidebar and RequireModule gate whole SCREENS; this gates the individual
 * reads inside one. Screens legitimately cross module boundaries — a customer
 * profile shows affiliate commissions, the affiliate list shows customer
 * records — but firestore.rules gates each collection on exactly one module,
 * and rules are not filters: an over-reaching query fails whole rather than
 * returning the rows it is allowed. So the screen has to decide NOT to
 * subscribe and degrade the section instead of firing a listener that comes
 * back permission-denied.
 *
 * Takes several modules because some rules accept more than one (orders reads
 * are open to `orders` OR `dashboard`); true if the admin holds any of them.
 */
export function useCanView(...modules: ModuleKey[]): boolean {
  const admin = useAuthStore((s) => s.admin);
  if (!admin) return false;
  if (admin.role === 'super_admin') return true;
  return modules.some((m) => admin.modulePermissions?.[m]?.view === true);
}
