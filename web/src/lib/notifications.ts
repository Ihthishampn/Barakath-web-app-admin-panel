'use client';
import { collection, query, where } from 'firebase/firestore';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/useCollection';

/**
 * Live count of the signed-in customer's unread notifications.
 *
 * Drives the red "new notification" dot on the header Account icon and on the
 * Notifications item inside the account sidebar. The count clears once the
 * customer opens the Notifications screen (that page marks its rows read on
 * leave), so the dot stays until they've looked once after a new one arrives.
 *
 * Single-field equality query (no orderBy) → no composite index needed.
 */
export function useUnreadNotifications(): number {
  const uid = useAuth((s) => s.customer?.uid);
  const { data } = useCollection<{ read?: boolean }>(
    () => (uid ? query(collection(db, 'customers', uid, 'notifications'), where('read', '==', false)) : null),
    [uid],
  );
  return data.length;
}
