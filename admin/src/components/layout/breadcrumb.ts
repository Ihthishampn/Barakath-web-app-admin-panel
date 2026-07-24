import { NAV_GROUPS } from './navConfig';

export interface BreadcrumbSegment {
  label: string;
  /**
   * Route to navigate to when the segment is clicked. Omitted for segments that
   * are not navigable: a group heading has no page of its own, and the trailing
   * detail segment is the page you are already on.
   */
  path?: string;
}

/**
 * Map a pathname to breadcrumb segments (group › item › [detail]), each with an
 * optional route. Only the item segment carries a `path`; the group heading and
 * the trailing detail segment are left non-navigable.
 */
export function breadcrumbTrail(pathname: string): BreadcrumbSegment[] {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const isMatch = item.path === '/' ? pathname === '/' : pathname.startsWith(item.path);
      if (!isMatch) continue;
      // The group heading points at the group's first screen. It has no page of
      // its own, but leaving it path-less made it a dead control: on the
      // dashboard and on every LIST screen the trailing segment is the current
      // page, so nothing in the breadcrumb was clickable at all.
      const segments: BreadcrumbSegment[] = group.heading
        ? [
            { label: titleCase(group.heading), path: group.items[0]?.path },
            { label: item.label, path: item.path },
          ]
        : [{ label: item.label, path: item.path }];
      // Append a trailing detail segment for nested routes (e.g. /orders/:id).
      const rest = pathname.slice(item.path.length).split('/').filter(Boolean);
      if (rest.length && item.path !== '/') segments.push({ label: prettyDetail(rest[rest.length - 1]!) });
      return segments;
    }
  }
  return [{ label: 'Dashboard' }];
}

/** Breadcrumb labels only — unchanged behaviour for existing string callers. */
export function breadcrumbFor(pathname: string): string[] {
  return breadcrumbTrail(pathname).map((s) => s.label);
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function prettyDetail(seg: string): string {
  if (seg === 'new') return 'Add';
  if (seg === 'filter') return 'Filter';
  return seg.replace(/-/g, ' ');
}
