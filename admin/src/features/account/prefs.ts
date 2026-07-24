import { create } from 'zustand';

/**
 * Local admin UI preferences — persisted to localStorage and applied as data
 * attributes on <html> (consumed by CSS in index.css). Real, working prefs
 * (not a mock panel): they take effect immediately across the app.
 */
export interface Prefs {
  denseTables: boolean;
  reducedMotion: boolean;
}

const KEY = 'barkath.admin.prefs';
const DEFAULTS: Prefs = { denseTables: false, reducedMotion: false };

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return DEFAULTS;
  }
}

export function applyPrefs(p: Prefs): void {
  const el = document.documentElement;
  el.dataset.density = p.denseTables ? 'compact' : 'comfortable';
  el.dataset.motion = p.reducedMotion ? 'reduced' : 'full';
}

interface PrefsState extends Prefs {
  set: (patch: Partial<Prefs>) => void;
}

export const usePrefs = create<PrefsState>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    const { set: _s, ...vals } = get();
    localStorage.setItem(KEY, JSON.stringify(vals));
    applyPrefs(vals);
  },
}));

// Apply persisted prefs at boot.
applyPrefs(load());
