/** Capitalize a slug/word for display: "prayer-mats" → "Prayer mats". */
export function cap(s: string): string {
  if (!s) return '';
  const spaced = s.replace(/[-_]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Prototype short date: "5 Jul". */
export function dateShort(date: Date | null | undefined): string {
  if (!date) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Prototype timeline style: "5 Jul, 10:24". */
export function dateTimeShort(date: Date | null | undefined): string {
  if (!date) return '—';
  const d = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const t = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${d}, ${t}`;
}

/** Compact relative time, prototype style: "just now" · "2h ago" · "3d ago". */
export function timeAgo(date: Date | null | undefined): string {
  if (!date) return '—';
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
