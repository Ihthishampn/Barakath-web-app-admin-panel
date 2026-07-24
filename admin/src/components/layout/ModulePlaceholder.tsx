import { useLocation } from 'react-router-dom';
import { breadcrumbFor } from './breadcrumb';

/** Generic "not built yet" page for module routes pending their feature. */
export function ModulePlaceholder() {
  const { pathname } = useLocation();
  const segments = breadcrumbFor(pathname);
  const title = segments[segments.length - 1] ?? 'Module';

  return (
    <div className="px-7 py-6">
      <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
        {title}
      </h1>
      <div className="mt-6 grid place-items-center rounded-lg border border-dashed border-border-default bg-surface-card py-20">
        <div className="text-center">
          <p className="font-display text-lg font-bold text-text-primary">Coming next</p>
          <p className="mt-1.5 font-ui text-sm text-text-tertiary">
            The “{title}” module is scheduled in the build plan. The shell, routing and
            permissions for it are already in place.
          </p>
        </div>
      </div>
    </div>
  );
}
