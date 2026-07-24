'use client';
import { useEffect, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import type { Customer } from '@barkath/shared';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { enablePush, pushConfigured, pushPermission, pushSupported, type PushPermission } from '@/lib/push';
import { Button } from '@/components/ui/Button';
import { AccountShell } from '@/components/account/AccountShell';
import { SettingsTabs } from '@/components/account/SettingsTabs';
import { Toggle } from '@/components/account/AccountControls';

type PrefKey = keyof Customer['preferences'];

const TOGGLES: { key: PrefKey; label: string; hint: string }[] = [
  { key: 'notificationsEnabled', label: 'Push notifications', hint: 'Master switch for all alerts' },
  { key: 'notifyOrderUpdates', label: 'Order updates', hint: 'Shipping, delivery and returns' },
  { key: 'notifyPromotions', label: 'Promotions & offers', hint: 'Deals, coupons and Spin & Win' },
  { key: 'notifyAffiliateEarnings', label: 'Affiliate earnings', hint: 'Commission and withdrawal alerts' },
  { key: 'notifyWalletActivity', label: 'Wallet activity', hint: 'Refunds, cashback and top-ups' },
];

const DEFAULT_PREFS: Customer['preferences'] = {
  notificationsEnabled: true,
  notifyOrderUpdates: true,
  notifyPromotions: true,
  notifyAffiliateEarnings: true,
  notifyWalletActivity: true,
};

export default function SettingsPage() {
  return (
    <AccountShell title="Notifications">
      <SettingsTabs />
      <SettingsBody />
    </AccountShell>
  );
}

function SettingsBody() {
  const customer = useAuth((s) => s.customer)!;
  const prefs = { ...DEFAULT_PREFS, ...(customer.preferences ?? {}) };
  const [saving, setSaving] = useState<PrefKey | null>(null);

  async function toggle(key: PrefKey, next: boolean) {
    if (saving) return;
    setSaving(key);
    try {
      await updateDoc(doc(db, 'customers', customer.uid), {
        preferences: { ...prefs, [key]: next },
        updatedAt: serverTimestamp(),
      });
    } catch {
      toast.error('Could not update your preferences.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <Section title="Notifications">
        <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-card">
          {TOGGLES.map((t, i) => {
            const master = t.key !== 'notificationsEnabled' && !prefs.notificationsEnabled;
            return (
              <div
                key={t.key}
                className={cnRow(i === TOGGLES.length - 1)}
              >
                <div className="min-w-0">
                  <div className="font-ui text-[14px] font-bold text-text-primary">{t.label}</div>
                  <div className="mt-0.5 font-ui text-[12px] font-medium text-text-tertiary">{t.hint}</div>
                </div>
                <Toggle
                  checked={!!prefs[t.key] && !master}
                  disabled={saving === t.key || master}
                  aria-label={t.label}
                  onChange={(next) => void toggle(t.key, next)}
                />
              </div>
            );
          })}
        </div>
      </Section>

      <BrowserPushSection uid={customer.uid} />
    </div>
  );
}

/**
 * Browser push opt-in — the ONLY place the site asks for notification
 * permission.
 *
 * Deliberately not on first paint: an unprompted permission dialog is what gets
 * a site permanently blocked, and a blocked browser can never be recovered from
 * the page. Here the customer has just walked into their notification
 * preferences, so the ask is expected — and it is a real click, which browsers
 * require for `Notification.requestPermission()`.
 *
 * Renders NOTHING when the browser cannot do web push, or while
 * NEXT_PUBLIC_FIREBASE_VAPID_KEY is unset (the key can only be generated in the
 * Firebase console) — the rest of this screen is unaffected either way.
 */
function BrowserPushSection({ uid }: { uid: string }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<PushPermission>('unsupported');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void pushSupported().then((ok) => {
      if (!live) return;
      setSupported(ok);
      setPermission(pushPermission());
    });
    return () => {
      live = false;
    };
  }, []);

  if (!pushConfigured() || supported !== true) return null;

  async function enable() {
    if (busy) return;
    setBusy(true);
    const res = await enablePush(uid);
    setPermission(pushPermission());
    setBusy(false);
    if (res === 'enabled') toast.success('Notifications enabled on this device.');
    else if (res === 'denied') toast.error('Notifications are blocked in your browser settings.');
    else if (res !== 'unconfigured' && res !== 'unsupported') {
      toast.error('Could not enable notifications on this device.');
    }
  }

  const granted = permission === 'granted';
  const blocked = permission === 'denied';

  return (
    <Section title="This device">
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-card">
        <div className={cnRow(true)}>
          <div className="min-w-0">
            <div className="font-ui text-[14px] font-bold text-text-primary">Browser notifications</div>
            <div className="mt-0.5 font-ui text-[12px] font-medium text-text-tertiary">
              {blocked
                ? 'Blocked — allow notifications for this site in your browser settings'
                : granted
                  ? 'Alerts appear on this device, even when the tab is closed'
                  : 'Get order and offer alerts on this device'}
            </div>
          </div>
          {!blocked && (
            <Button
              theme="primary"
              size="s"
              outline
              disabled={busy || granted}
              onClick={() => void enable()}
            >
              {granted ? 'Enabled' : busy ? 'Enabling…' : 'Enable'}
            </Button>
          )}
        </div>
      </div>
    </Section>
  );
}

function cnRow(last: boolean): string {
  return `flex items-center justify-between gap-4 px-5 py-4${last ? '' : ' border-b border-border-subtle'}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 font-ui text-[12px] font-extrabold uppercase tracking-[0.05em] text-text-tertiary">{title}</div>
      {children}
    </div>
  );
}

