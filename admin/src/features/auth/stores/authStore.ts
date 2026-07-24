/** Global auth state: current admin + hydration status (Zustand). */
import { create } from 'zustand';
import { onAuthStateChanged } from 'firebase/auth';
import type { Admin } from '@barkath/shared';
import { auth } from '@/lib/firebase';
import { signOutAdmin, touchAdminActivity, watchAdminDoc } from '../api/auth';

interface AuthState {
  admin: Admin | null;
  /** false until the initial Firebase auth check resolves. */
  ready: boolean;
  setAdmin: (admin: Admin | null) => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  admin: null,
  ready: false,
  setAdmin: (admin) => set({ admin }),
  signOut: async () => {
    await signOutAdmin();
    set({ admin: null });
  },
}));

/** Wire Firebase auth → store. Called once at app boot. */
export function initAuthListener(): () => void {
  let unwatchAdmin: (() => void) | null = null;
  const stopWatching = () => {
    unwatchAdmin?.();
    unwatchAdmin = null;
  };

  /** Drop the session: a deleted/suspended admin, or an unreadable admins doc. */
  const abandonSession = () => {
    useAuthStore.setState({ admin: null, ready: true });
    // Signing out re-enters this listener with `user === null`, which tears the
    // doc watch down — nothing to unsubscribe here.
    void signOutAdmin().catch(() => {
      /* already signed out or offline — nothing more to do */
    });
  };

  const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    stopWatching();
    if (!user) {
      useAuthStore.setState({ admin: null, ready: true });
      return;
    }
    // Live, not one-shot: role/permission edits made by a super admin have to
    // reach an open session, otherwise the sidebar and the route guard keep
    // offering modules the rules will refuse (and hide ones just granted).
    let firstSnapshot = true;
    unwatchAdmin = watchAdminDoc(
      user.uid,
      (admin) => {
        // Only accept active admins; otherwise treat as signed-out.
        if (!admin || admin.status !== 'active') {
          abandonSession();
          return;
        }
        useAuthStore.setState({ admin, ready: true });
        // Resuming a stored session is activity too — without this, "Last active"
        // only ever moved on a fresh email/password sign-in. Once per session:
        // the stamp itself re-fires this listener.
        if (firstSnapshot) {
          firstSnapshot = false;
          void touchAdminActivity(user.uid, false);
        }
      },
      // A failed admins/{uid} read (rules, offline, deleted doc) previously left
      // this promise rejected with `ready` still false — the whole panel sat on
      // an unrecoverable spinner with no way back. Fall back to signed-out so
      // the user lands on /login and can retry.
      abandonSession,
    );
  });

  return () => {
    stopWatching();
    unsubscribeAuth();
  };
}
