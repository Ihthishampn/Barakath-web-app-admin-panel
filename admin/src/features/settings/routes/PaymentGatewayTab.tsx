import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { RiWalletLine } from '@remixicon/react';
import { Button } from '@/components/ui/Button';
import { noPermissionTitle, useCanDo } from '@/features/auth/useCan';
import { Spinner } from '@/components/ui/Spinner';
import { Toggle } from '@/components/ui/Toggle';
import { SettingsShell } from '../components/SettingsShell';
import { Card, Field, ToggleRow } from '../components/fields';
import { DEFAULT_GATEWAY, savePaymentGateway, usePaymentGateway } from '../api/settings';

export function PaymentGatewayTab() {
  const { data, loading: l, error } = usePaymentGateway();
  const loading = l && !data;

  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  const [razorpayKeyId, setRazorpayKeyId] = useState('');
  const [walletEnabled, setWalletEnabled] = useState(true);
  const [onlinePaymentEnabled, setOnlinePaymentEnabled] = useState(true);

  useEffect(() => {
    if (seeded || loading) return;
    const g = data ?? DEFAULT_GATEWAY;
    setRazorpayKeyId(g.razorpayKeyId ?? '');
    setWalletEnabled(g.walletEnabled);
    setOnlinePaymentEnabled(g.onlinePaymentEnabled);
    setSeeded(true);
  }, [seeded, loading, data]);

  const connected = razorpayKeyId.trim().length > 0;

  const canEdit = useCanDo('settings', 'edit');

  const onSave = async () => {
    try {
      setSaving(true);
      await savePaymentGateway({
        id: 'paymentGateway',
        razorpayKeyId: razorpayKeyId.trim(),
        // Cash on delivery is closed to NEW orders — checkout offers online and
        // wallet only. The flag is still written (web and the app read it) and is
        // pinned off, so saving this screen can never hand a storefront back a
        // payment method the business no longer accepts. The limit goes with it;
        // it only ever meant anything while COD was selectable.
        codEnabled: false,
        codMaxAmountPaise: 0,
        walletEnabled,
        onlinePaymentEnabled,
      });
      toast.success('Changes saved');
    } catch {
      toast.error('Could not save payment settings.');
    } finally {
      setSaving(false);
    }
  };

  const action = (
    <Button
      variant="primary"
      className="h-[42px]"
      loading={saving}
      disabled={loading || !canEdit}
      title={canEdit ? undefined : noPermissionTitle('settings', 'edit')}
      onClick={onSave}
    >
      Save changes
    </Button>
  );

  return (
    <SettingsShell active="gateway" action={action}>
      {loading ? (
        <div className="grid place-items-center py-24">
          <Spinner className="h-7 w-7 text-brand-primary" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-border-subtle bg-surface-card p-8 text-center font-ui text-sm text-text-tertiary">
          Couldn’t load payment settings. Please refresh.
        </div>
      ) : (
        <div className="flex max-w-[720px] flex-col gap-4">
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-sm bg-brand-primary text-white">
                  <RiWalletLine size={18} />
                </span>
                <div className="font-display text-sm font-bold text-text-primary">Razorpay</div>
              </div>
              <span
                className={
                  connected
                    ? 'inline-flex items-center gap-1.5 rounded-[6px] bg-success-subtle px-[9px] py-[5px] font-ui text-[11px] font-bold text-success'
                    : 'inline-flex items-center gap-1.5 rounded-[6px] bg-surface-app px-[9px] py-[5px] font-ui text-[11px] font-bold text-text-tertiary'
                }
              >
                {connected ? 'Connected' : 'Not connected'}
              </span>
            </div>
            <Field
              label="Key ID"
              value={razorpayKeyId}
              onChange={setRazorpayKeyId}
              placeholder="rzp_live_XXXXXXXXXXXX"
            />
            <p className="mt-3 font-ui text-[11px] leading-relaxed text-text-tertiary">
              Only the publishable Key ID is stored here. The key secret is never kept in the admin
              database — configure it in your server environment.
            </p>
          </Card>

          <Card>
            <div className="mb-1 font-display text-sm font-bold text-text-primary">
              Additional payment methods
            </div>
            {/* COD is retired, not hidden: the row stays so an operator looking
                for it sees it is off by policy rather than assuming it was lost.
                It is locked, because turning it back on here would reintroduce a
                payment method checkout no longer supports. */}
            <ToggleRow label="Cash on delivery" divided>
              <Toggle checked={false} disabled onChange={() => undefined} />
            </ToggleRow>
            <p className="mt-2 font-ui text-[11px] leading-relaxed text-text-tertiary">
              No longer offered — new orders are online or wallet only. Existing COD orders are
              unaffected and still reconcile as normal.
            </p>
            <ToggleRow label="Wallet payments" divided>
              <Toggle checked={walletEnabled} onChange={setWalletEnabled} />
            </ToggleRow>
            <ToggleRow label="Online payment (UPI / cards / net-banking)" divided>
              <Toggle checked={onlinePaymentEnabled} onChange={setOnlinePaymentEnabled} />
            </ToggleRow>
          </Card>
        </div>
      )}
    </SettingsShell>
  );
}
