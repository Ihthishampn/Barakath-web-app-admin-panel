'use client';
/**
 * User directory — the Firestore `users/{phoneKey}` collection used to decide
 * whether a phone is already registered (sign-in vs sign-up gating).
 *
 *   users/{phoneKey}  →  { phone, uid, createdAt }   (phoneKey = E.164 digits)
 *
 * This is the ONE piece of pre-auth state (readable before a session exists),
 * so the sign-in screen can say "register first" for an unknown number, and the
 * register screen can say "already registered". Full profile lives in
 * `customers/{uid}` as before.
 *
 * ┌─ SWITCHING TO REAL MSG91 + FIREBASE ───────────────────────────────────┐
 * │ In production the existence check moves SERVER-SIDE into the `sendOtp`   │
 * │ Cloud Function (it knows whether the number is registered before it      │
 * │ sends an SMS). Replace the two functions below with calls that hit that  │
 * │ CF; the signin/register UI and authActions signatures stay identical.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

/** E.164 → digits-only doc key (e.g. +91 98765 43210 → "919876543210"). */
export function phoneKey(e164: string): string {
  return e164.replace(/\D/g, '');
}

/** Is this phone already registered? (public single-doc read). */
export async function userExists(e164: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'users', phoneKey(e164)));
  return snap.exists();
}

/** Record a newly-registered phone → uid (called once, after the session exists). */
export async function registerUser(e164: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const ref = doc(db, 'users', phoneKey(e164));
  // `setDoc(..., { merge: true })` on an EXISTING document is an update, and the
  // security rule is `allow update: if false` — so re-registering a number that
  // already has a directory entry threw permission-denied, which the caller
  // then reported as a failed verification. The entry is an immutable
  // phone→uid index: if it is already there, there is nothing to write.
  const existing = await getDoc(ref);
  if (existing.exists()) return;
  await setDoc(ref, { phone: e164, uid: user.uid, createdAt: serverTimestamp() });
}
