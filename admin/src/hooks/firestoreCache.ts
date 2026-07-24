import { useCallback, useRef, useSyncExternalStore } from 'react';
import { doc, onSnapshot, type Query, type FirestoreError } from 'firebase/firestore';
import { db } from '@/lib/firebase';

/**
 * A tiny shared real-time cache for Firestore reads.
 *
 * The old per-component hooks reset to `{ data: [], loading: true }` on every
 * mount, so each navigation (save → back to list, open an edit form, …) blanked
 * the screen for a full round-trip. This cache keeps the last snapshot keyed by
 * a stable string, so a re-mounted screen shows its data instantly and the live
 * listener refreshes it in the background (stale-while-revalidate). No flash.
 *
 * The live listener is shared across all subscribers of a key and torn down when
 * the last one unmounts — but the cached snapshot is kept, so coming back is
 * instant while a fresh listener re-attaches.
 */
interface Snapshot<T> {
  data: T;
  loading: boolean;
  error: FirestoreError | null;
}

interface Entry {
  snapshot: Snapshot<unknown>;
  listeners: Set<() => void>;
  refs: number;
  unsub?: () => void;
  everSettled: boolean;
}

const cache = new Map<string, Entry>();

function ensure(key: string, empty: unknown): Entry {
  let e = cache.get(key);
  if (!e) {
    e = { snapshot: { data: empty, loading: true, error: null }, listeners: new Set(), refs: 0, everSettled: false };
    cache.set(key, e);
  }
  return e;
}

function emit(e: Entry) {
  e.snapshot = { ...e.snapshot }; // new reference so useSyncExternalStore re-reads
  for (const l of e.listeners) l();
}

/** Current cached list for a key (for seeding forms without a round-trip). */
export function getCachedList<T>(key: string): T[] {
  const e = cache.get(key);
  return e ? (e.snapshot.data as T[]) : [];
}

/** Current cached doc for a path (for seeding forms without a round-trip). */
export function getCachedDoc<T>(path: string): T | null {
  const e = cache.get(`doc:${path}`);
  return e ? ((e.snapshot.data as T | null) ?? null) : null;
}

function useLive<T>(key: string, empty: T, attach: (e: Entry) => () => void): Snapshot<T> {
  const attachRef = useRef(attach);
  attachRef.current = attach;

  const subscribe = useCallback(
    (cb: () => void) => {
      const e = ensure(key, empty);
      e.listeners.add(cb);
      e.refs++;
      if (!e.unsub) e.unsub = attachRef.current(e);
      return () => {
        e.listeners.delete(cb);
        e.refs--;
        if (e.refs === 0 && e.unsub) {
          e.unsub();
          e.unsub = undefined;
          // Keep the last snapshot as a stale cache. Do NOT force loading:false:
          // a settled entry is already false (instant remount with data), and an
          // entry that never settled must stay loading:true so a remount shows the
          // spinner — not a flash of the empty state. (Dev StrictMode mounts →
          // unmounts → remounts, which previously poisoned the entry to
          // {data:[], loading:false} and flashed "No results" before data arrived.)
        }
      };
    },
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const getSnapshot = useCallback(() => ensure(key, empty).snapshot as Snapshot<T>, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface CollectionState<T> {
  data: T[];
  loading: boolean;
  error: FirestoreError | null;
}

/** Cached real-time collection subscription, keyed by a stable string. */
export function useLiveCollection<T>(key: string, makeQuery: () => Query | null): CollectionState<T> {
  const makeRef = useRef(makeQuery);
  makeRef.current = makeQuery;
  return useLive<T[]>(key, [], (e) => {
    const q = makeRef.current();
    if (!q) {
      e.snapshot = { data: [], loading: false, error: null };
      e.everSettled = true;
      emit(e);
      return () => undefined;
    }
    return onSnapshot(
      q,
      (snap) => {
        e.snapshot = { data: snap.docs.map((d) => d.data() as T), loading: false, error: null };
        e.everSettled = true;
        emit(e);
      },
      (error) => {
        e.snapshot = { data: (e.snapshot.data as T[]) ?? [], loading: false, error };
        e.everSettled = true;
        emit(e);
      },
    );
  });
}

export interface DocState<T> {
  data: T | null;
  loading: boolean;
  error: FirestoreError | null;
}

/** Cached real-time single-document subscription, keyed by its path. */
export function useLiveDoc<T>(path: string | null): DocState<T> {
  return useLive<T | null>(`doc:${path ?? '∅'}`, null, (e) => {
    if (!path) {
      e.snapshot = { data: null, loading: false, error: null };
      emit(e);
      return () => undefined;
    }
    return onSnapshot(
      doc(db, path),
      (snap) => {
        e.snapshot = { data: snap.exists() ? (snap.data() as T) : null, loading: false, error: null };
        e.everSettled = true;
        emit(e);
      },
      (error) => {
        e.snapshot = { data: null, loading: false, error };
        emit(e);
      },
    );
  });
}
