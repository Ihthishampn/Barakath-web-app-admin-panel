import { NavLink } from 'react-router-dom';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { NAV_GROUPS, type NavItem } from './navConfig';

/** Left sidebar — 236px, reproduced from the admin prototype. */
export function Sidebar() {
  const admin = useAuthStore((s) => s.admin);

  const canView = (item: NavItem) => {
    if (admin?.role === 'super_admin') return true;
    // A super-admin-only screen stays hidden even when the sub-admin holds the
    // module it is filed under — the rule behind it reads isSuperAdmin().
    if (item.superAdminOnly) return false;
    return admin?.modulePermissions?.[item.module]?.view === true;
  };

  return (
    <aside className="flex h-full w-[236px] flex-none flex-col overflow-hidden border-r border-border-subtle bg-surface-card px-3 py-4">
      {/* Brand — logo is a tall stacked lockup, so give it real height. */}
      <div className="mb-1.5 flex items-center gap-2.5 border-b border-border-subtle px-2.5 pb-3.5 pt-1">
        <BrandLogo height={40} withWordmark={false} />
        <span className="font-ui text-xs font-extrabold tracking-[0.04em] text-text-tertiary">
          Admin
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.heading ?? `g${gi}`}>
            {group.heading && (
              <div className="px-3.5 pb-1.5 pt-4 font-ui text-[10px] font-extrabold uppercase tracking-[0.1em] text-text-tertiary">
                {group.heading}
              </div>
            )}
            {group.items.filter(canView).map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) =>
                    cn(
                      'my-px flex items-center gap-[11px] rounded-sm px-3.5 py-2.5 font-ui text-[13px] transition-colors',
                      isActive
                        ? 'bg-brand-primary-subtle font-bold text-brand-primary'
                        : 'font-medium text-text-secondary hover:bg-surface-app',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={cn(
                          'inline-flex',
                          isActive ? 'text-brand-primary' : 'text-text-tertiary',
                        )}
                      >
                        <Icon size={17} />
                      </span>
                      {item.label}
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
