'use client';
import { useEffect, useState } from 'react';
import { onSnapshot, type Query } from 'firebase/firestore';

export interface CollectionState<T> {
  data: T[];
  loading: boolean;
  error: boolean;
}

/** Client-side real-time Firestore subscription for the storefront. */
export function useCollection<T>(makeQuery: () => Query | null, deps: unknown[] = []): CollectionState<T> {
  const [state, setState] = useState<CollectionState<T>>({ data: [], loading: true, error: false });
  useEffect(() => {
    const q = makeQuery();
    if (!q) {
      setState({ data: [], loading: false, error: false });
      return;
    }
    // A real query is (re)attaching — go back to loading until its first
    // snapshot lands. Without this, a query that transitions from null → real
    // (e.g. once the customer's uid resolves) would keep the previous
    // `{ loading: false, data: [] }`, painting an empty state ("No orders yet")
    // for the second or two before the snapshot arrives.
    setState((s) => (s.loading ? s : { ...s, loading: true }));
    const unsub = onSnapshot(
      q,
      (snap) => setState({ data: snap.docs.map((d) => d.data() as T), loading: false, error: false }),
      () => setState({ data: [], loading: false, error: true }),
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
