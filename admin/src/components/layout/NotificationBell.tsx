import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { RiNotificationLine } from '@remixicon/react';
import { useQuery } from '@tanstack/react-query';
import { db } from '@/lib/firebase';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { useOnClickOutside } from '@/hooks/useOnClickOutside';
import { cn } from '@/lib/cn';
import { useSyncExternalStore } from 'react';

interface Alert {
  id: string;
  type: string;
  title: string;
  body: string;
  deepLink: string;
  read: boolean;
}

/** Subscribe to adminAlerts/{uid}/alerts in real time via useSyncExternalStore. */
function useAlerts(uid: string | undefined): Alert[] {
  const store = useMemo(() => {
    let snapshot: Alert[] = [];
    const listeners = new Set<() => void>();
    let unsub: (() => void) | undefined;
    return {
      subscribe(cb: () => void) {
        listeners.add(cb);
        if (!unsub && uid) {
          const q = query(collection(db, `adminAlerts/${uid}/alerts`), orderBy('createdAt', 'desc'));
          unsub = onSnapshot(
            q,
            (snap) => {
              snapshot = snap.docs.map((d) => d.data() as Alert);
              listeners.forEach((l) => l());
            },
            () => {
              snapshot = [];
              listeners.forEach((l) => l());
            },
          );
        }
        return () => {
          listeners.delete(cb);
          if (listeners.size === 0 && unsub) {
            unsub();
            unsub = undefined;
          }
        };
      },
      getSnapshot: () => snapshot,
    };
  }, [uid]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => []);
}

export function NotificationBell() {
  const uid = useAuthStore((s) => s.admin?.uid);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);

  const alerts = useAlerts(uid);
  const unread = alerts.filter((a) => !a.read).length;

  const markAllRead = async () => {
    if (!uid) return;
    const batch = writeBatch(db);
    alerts.filter((a) => !a.read).forEach((a) => {
      batch.update(doc(db, `adminAlerts/${uid}/alerts/${a.id}`), { read: true });
    });
    await batch.commit().catch(() => undefined);
  };

  const openAlert = async (a: Alert) => {
    if (uid && !a.read) {
      await updateDoc(doc(db, `adminAlerts/${uid}/alerts/${a.id}`), { read: true }).catch(
        () => undefined,
      );
    }
    setOpen(false);
    navigate(a.deepLink);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-9 w-9 place-items-center rounded-pill text-text-secondary hover:bg-surface-app"
        aria-label="Notifications"
      >
        <RiNotificationLine size={19} />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-pill bg-error ring-2 ring-surface-card" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-40 w-80 overflow-hidden rounded-md border border-border-subtle bg-surface-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
            <span className="font-display text-sm font-bold text-text-primary">Notifications</span>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="font-ui text-xs font-semibold text-brand-primary hover:underline"
              >
                Mark all as read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {alerts.length === 0 ? (
              <p className="px-4 py-8 text-center font-ui text-xs text-text-tertiary">
                You're all caught up.
              </p>
            ) : (
              alerts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => openAlert(a)}
                  className={cn(
                    'flex w-full flex-col items-start gap-0.5 border-b border-border-subtle px-4 py-3 text-left last:border-0 hover:bg-surface-app',
                    !a.read && 'bg-brand-primary-subtle/40',
                  )}
                >
                  <span className="font-ui text-[13px] font-bold text-text-primary">{a.title}</span>
                  <span className="font-ui text-xs text-text-secondary">{a.body}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
