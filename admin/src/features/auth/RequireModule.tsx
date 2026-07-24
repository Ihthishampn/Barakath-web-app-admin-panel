import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { ModuleKey } from '@barkath/shared';
import { ALL_NAV_ITEMS, NAV_GROUPS } from '@/components/layout/navConfig';
import { useAuthStore } from './stores/authStore';

/**
 * Per-module route guard.
 *
 * The sidebar already hides modules a sub-admin cannot view, but hiding a link
 * is not a guard: typing `/reviews` (or any other path) still mounted the page,
 * which then fired its queries and rendered whatever the rules happened to
 * allow. This closes that gap on the client; Firestore rules and the callables'
 * `requireModule` checks remain the real enforcement.
 *
 * A denied route redirects to the first module the admin *can* view, so the
 * landing page is always something they are allowed to see. If they can view
 * nothing at all, we render through rather than redirect — a redirect loop
 * would be worse than an empty screen.
 */
export function RequireModule() {
  const admin = useAuthStore((s) => s.admin);
  const { pathname } = useLocation();

  if (!admin || admin.role === 'super_admin') return <Outlet />;

  const canView = (module: ModuleKey) => admin.modulePermissions?.[module]?.view === true;

  // Longest-prefix match, so `/products/:id` resolves to the products module.
  // `/` is exact-only: every path starts with it.
  const item = ALL_NAV_ITEMS.filter((i) =>
    i.path === '/' ? pathname === '/' : pathname === i.path || pathname.startsWith(`${i.path}/`),
  ).sort((a, b) => b.path.length - a.path.length)[0];

  // Unknown path — the catch-all route already sends it home.
  // `superAdminOnly` is checked first: a sub-admin who holds the module a
  // restricted screen is filed under must still be turned away (only super
  // admins got this far — the early return above passes them straight through).
  if (!item || (!item.superAdminOnly && canView(item.module))) return <Outlet />;

  const fallback = NAV_GROUPS.flatMap((g) => g.items).find((i) => !i.superAdminOnly && canView(i.module));
  if (!fallback || fallback.path === pathname) return <Outlet />;

  return <Navigate to={fallback.path} replace />;
}
