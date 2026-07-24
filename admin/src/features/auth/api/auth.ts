/** Admin auth — Firebase email/password + admins-doc verification (spec §3). */
import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  reauthenticateWithCredential,
  updatePassword,
  EmailAuthProvider,
  type User,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { Admin } from '@barkath/shared';
import { auth, db } from '@/lib/firebase';

export class AuthError extends Error {}

/** Sign in, then verify the user is an active admin. Returns the admin doc. */
export async function signInAdmin(email: string, password: string): Promise<Admin> {
  let user: User;
  try {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    user = cred.user;
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (
      code === 'auth/invalid-credential' ||
      code === 'auth/wrong-password' ||
      code === 'auth/user-not-found' ||
      code === 'auth/invalid-email'
    ) {
      throw new AuthError('Incorrect email or password.');
    }
    if (code === 'auth/too-many-requests') {
      throw new AuthError('Too many attempts. Try again in a few minutes.');
    }
    throw new AuthError('Could not sign in. Please try again.');
  }

  const snap = await getDoc(doc(db, 'admins', user.uid));
  if (!snap.exists()) {
    await fbSignOut(auth);
    throw new AuthError('Not authorized to access admin panel.');
  }
  const admin = snap.data() as Admin;
  if (admin.status !== 'active') {
    await fbSignOut(auth);
    throw new AuthError('Your admin account is suspended.');
  }
  // Refresh the ID token so mirrored role/status custom claims are current.
  await user.getIdToken(true);
  void touchAdminActivity(user.uid, true);
  return admin;
}

/**
 * Stamp sign-in activity on the admin's own doc.
 *
 * The Sub Admin list renders a "Last active" column and the profile dialog a
 * "Last login" line, but nothing ever wrote either field — every row showed the
 * value baked in at account creation. Both fields use the server clock (the
 * rules require it), and only these two keys may change.
 *
 * Fire-and-forget: a failed stamp must never block or fail a sign-in.
 */
export async function touchAdminActivity(uid: string, isFreshLogin: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, 'admins', uid), {
      lastActiveAt: serverTimestamp(),
      ...(isFreshLogin ? { lastLoginAt: serverTimestamp() } : {}),
    });
  } catch {
    /* activity telemetry only — never surface this to the operator */
  }
}

export async function loadAdminDoc(uid: string): Promise<Admin | null> {
  const snap = await getDoc(doc(db, 'admins', uid));
  return snap.exists() ? (snap.data() as Admin) : null;
}

/**
 * Subscribe to the signed-in admin's own doc.
 *
 * Role and module permissions were read once at boot, so a permission a super
 * admin granted (or revoked) mid-session only took effect after a hard reload:
 * the sidebar and the route guard kept using the stale copy while the rules
 * enforced the live one. Watching the doc keeps the client in step with what
 * the server will actually allow. Emits null when the doc is gone (deleted
 * admin) so the caller can drop the session.
 */
export function watchAdminDoc(
  uid: string,
  onChange: (admin: Admin | null) => void,
  onError: () => void,
): () => void {
  return onSnapshot(
    doc(db, 'admins', uid),
    (snap) => onChange(snap.exists() ? (snap.data() as Admin) : null),
    onError,
  );
}

export async function signOutAdmin(): Promise<void> {
  await fbSignOut(auth);
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

/** Change the signed-in admin's own password (reauth → update). Firebase Auth
 * client op — no Cloud Function needed. */
export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
  const user = auth.currentUser;
  if (!user?.email) throw new AuthError('You’re not signed in.');
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code.includes('wrong-password') || code.includes('invalid-credential')) {
      throw new AuthError('Current password is incorrect.');
    }
    if (code.includes('too-many-requests')) throw new AuthError('Too many attempts. Try again later.');
    throw new AuthError('Could not verify your current password.');
  }
  try {
    await updatePassword(user, newPassword);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code.includes('weak-password')) throw new AuthError('New password is too weak (use at least 6 characters).');
    throw new AuthError('Could not update your password.');
  }
}
