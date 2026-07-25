'use client';
import { create } from 'zustand';
import { onAuthStateChanged, signOut as fbSignOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import type { Customer } from '@barkath/shared';
import { auth, db } from './firebase';

interface AuthState {
  user: User | null;
  customer: Customer | null;
  /** false until the first auth check resolves. */
  ready: boolean;
}

export const useAuth = create<AuthState>(() => ({ user: null, customer: null, ready: false }));

let started = false;
let unsubCustomer: (() => void) | null = null;

/** Wire Firebase Auth → store (customer doc live). Call once at app boot. */
export function initAuth(): void {
  if (started) return;
  started = true;
  onAuthStateChanged(auth, (user) => {
    useAuth.setState({ user });
    unsubCustomer?.();
    unsubCustomer = null;
    if (!user) {
      useAuth.setState({ customer: null, ready: true });
      return;
    }
    unsubCustomer = onSnapshot(
      doc(db, 'customers', user.uid),
      (s) => useAuth.setState({ customer: s.exists() ? (s.data() as Customer) : null, ready: true }),
      () => useAuth.setState({ ready: true }),
    );
  });
}

export async function signOutCustomer(): Promise<void> {
  // Drop this browser's push registration FIRST: `fcmTokens` rows may only be
  // deleted by their owner (firestore.rules), so once the session is gone the
  // row is stranded and the next customer on a shared browser would keep
  // receiving the previous one's broadcasts. Imported lazily so the messaging
  // SDK is not pulled into every page that can sign out, and best-effort —
  // signing out must never fail because a push row would not delete.
  await import('./push')
    .then((m) => m.unregisterPushToken())
    .catch(() => undefined);
  await fbSignOut(auth);
}
