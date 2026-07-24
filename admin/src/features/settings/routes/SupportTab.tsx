import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { noPermissionTitle, useCanDo } from '@/features/auth/useCan';
import { Spinner } from '@/components/ui/Spinner';
import { Toggle } from '@/components/ui/Toggle';
import { SettingsShell } from '../components/SettingsShell';
import { Card, CardTitle, Field, ToggleRow } from '../components/fields';
import { saveSupport, useSupport } from '../api/settings';

/**
 * Support settings — the contact details rendered on the storefront's
 * Help & support page (`settings/support`).
 *
 * The storefront hides a contact card when its value is blank, so leaving the
 * phone empty simply removes the Call us / WhatsApp tiles. WhatsApp reuses the
 * support phone — there is no separate field in the schema.
 */
export function SupportTab() {
  const { data, loading, error } = useSupport();
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  const [supportEmail, setSupportEmail] = useState('');
  const [supportPhone, setSupportPhone] = useState('');
  const [supportHours, setSupportHours] = useState('');
  const [supportEnabled, setSupportEnabled] = useState(true);

  useEffect(() => {
    if (seeded || (loading && !data)) return;
    setSupportEmail(data?.supportEmail ?? '');
    setSupportPhone(data?.supportPhone ?? '');
    setSupportHours(data?.supportHours ?? '');
    setSupportEnabled(data?.supportEnabled ?? true);
    setSeeded(true);
  }, [data, loading, seeded]);

  const canEdit = useCanDo('settings', 'edit');

  const onSave = async () => {
    const email = supportEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return toast.error('That support email looks invalid.');
    }
    setSaving(true);
    try {
      await saveSupport({
        id: 'support',
        supportEmail: email,
        supportPhone: supportPhone.trim(),
        supportHours: supportHours.trim(),
        supportEnabled,
      });
      toast.success('Support settings saved');
    } catch {
      toast.error('Could not save support settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) {
    return (
      <SettingsShell active="support">
        <div className="grid place-items-center py-24">
          <Spinner className="h-7 w-7 text-brand-primary" />
        </div>
      </SettingsShell>
    );
  }

  return (
    <SettingsShell active="support">
      {error && (
        <p className="mb-4 font-ui text-[13px] text-error">Couldn’t load support settings.</p>
      )}
      <Card>
        <CardTitle>Help &amp; support</CardTitle>
        <div className="flex max-w-[560px] flex-col gap-4">
          <Field
            label="Support email"
            value={supportEmail}
            onChange={setSupportEmail}
            placeholder="help@barakath.com"
          />
          <div>
            <Field
              label="Support phone"
              value={supportPhone}
              onChange={setSupportPhone}
              placeholder="1800-000-000"
            />
            <p className="mt-1.5 font-ui text-[11px] text-text-tertiary">
              Also used for the WhatsApp link. Leave blank to hide the Call us and WhatsApp cards.
            </p>
          </div>
          <Field
            label="Support hours"
            value={supportHours}
            onChange={setSupportHours}
            placeholder="Mon–Sat 9 AM – 8 PM IST"
          />
          <ToggleRow
            label="Support enabled"
            hint="Turn off to hide the Help &amp; support contact cards on the storefront."
            divided
          >
            <Toggle checked={supportEnabled} onChange={setSupportEnabled} />
          </ToggleRow>
          <div>
            <Button
              variant="primary"
              className="h-[42px]"
              loading={saving}
              disabled={!canEdit}
              title={canEdit ? undefined : noPermissionTitle('settings', 'edit')}
              onClick={() => void onSave()}
            >
              Save changes
            </Button>
          </div>
        </div>
      </Card>
    </SettingsShell>
  );
}
