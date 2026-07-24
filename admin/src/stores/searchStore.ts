import { create } from 'zustand';

/**
 * Global, screen-scoped search query. The top-bar field writes here; the active
 * list screen reads it and filters its own data. Cleared when the base route
 * changes (see TopBar), so a query never leaks from one screen to another.
 */
interface SearchState {
  query: string;
  setQuery: (q: string) => void;
  reset: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  setQuery: (query) => set({ query }),
  reset: () => set({ query: '' }),
}));
