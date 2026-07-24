import { Fragment, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { RiSearchLine, RiCloseLine } from '@remixicon/react';
import { ProfileMenu } from './ProfileMenu';
import { breadcrumbTrail } from './breadcrumb';
import { useSearchStore } from '@/stores/searchStore';
import { baseSegment, searchScopeFor } from '@/lib/search';
import { cn } from '@/lib/cn';

/** Persistent top bar — 60px, per prototype: breadcrumb + search + profile. */
export function TopBar() {
  const { pathname } = useLocation();
  const segments = breadcrumbTrail(pathname);
  const scope = searchScopeFor(pathname);
  const { query, setQuery, reset } = useSearchStore();
  const base = baseSegment(pathname);
  const prevBase = useRef(base);

  // Clear the query whenever the base screen changes (products → orders, …).
  useEffect(() => {
    if (prevBase.current !== base) {
      prevBase.current = base;
      reset();
    }
  }, [base, reset]);

  return (
    <header className="flex h-[60px] flex-none items-center gap-4 border-b border-border-subtle bg-surface-card px-7">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 font-ui text-[13px] font-medium text-text-tertiary">
        {segments.map((s, i) => {
          const isLast = i === segments.length - 1;
          const cls = isLast ? 'text-text-secondary' : '';
          // Navigable only when the segment has a route AND isn't the current
          // (last) page. Same classes either way → identical appearance.
          return (
            <Fragment key={i}>
              {i > 0 && <span className="text-text-tertiary/60">›</span>}
              {s.path && !isLast ? (
                <Link to={s.path} className={cls}>{s.label}</Link>
              ) : (
                <span className={cls}>{s.label}</span>
              )}
            </Fragment>
          );
        })}
      </nav>

      {/* Global search — filters the current screen; disabled where there's nothing to search. */}
      <div
        className={cn(
          'ml-2 flex max-w-[320px] flex-1 items-center gap-[9px] rounded-sm border px-3 py-2',
          scope.enabled ? 'border-border-default bg-surface-app' : 'border-border-subtle bg-surface-app opacity-60',
        )}
      >
        <RiSearchLine size={16} className="text-text-tertiary" />
        <input
          value={scope.enabled ? query : ''}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!scope.enabled}
          placeholder={scope.placeholder}
          className="w-full bg-transparent font-ui text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:cursor-not-allowed"
        />
        {scope.enabled && query && (
          <button onClick={() => reset()} className="text-text-tertiary hover:text-text-secondary" aria-label="Clear search">
            <RiCloseLine size={15} />
          </button>
        )}
      </div>

      {/* Right cluster — avatar + name/role. The prototype also shows a bell and
          NotificationBell exists, but nothing writes adminAlerts yet (rules keep
          the collection CF-authored and no function produces one), so mounting it
          today would only ever render "You're all caught up." */}
      <div className="ml-auto flex items-center gap-[18px]">
        <ProfileMenu />
      </div>
    </header>
  );
}
