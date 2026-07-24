import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { CouponTarget } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { cn } from '@/lib/cn';
import { createCampaign, isoDate, newSpinCampaignId, type CampaignBasics } from '../api/spinner';
import { noPermissionTitle, useCanDo } from '@/features/auth/useCan';

const inputCls =
  'w-full rounded-sm border border-border-default bg-surface-card px-[13px] py-[11px] font-ui text-[13px] font-medium text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none';

const ELIGIBILITY: { value: CouponTarget; label: string }[] = [
  { value: 'all', label: 'All users' },
  { value: 'new', label: 'New users' },
  { value: 'existing', label: 'Existing users' },
  { value: 'affiliates', label: 'Affiliates' },
  { value: 'segment', label: 'Segment' },
];

/** Default window: today → +30 days, so the form is never blank/invalid on open. */
const today = new Date();
const in30 = new Date(Date.now() + 30 * 86400000);

export function CreateCampaignPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(isoDate(today));
  const [endDate, setEndDate] = useState(isoDate(in30));
  const [eligibility, setEligibility] = useState<CouponTarget>('all');
  const [spinsPerDay, setSpinsPerDay] = useState('1');
  const [activate, setActivate] = useState(true);
  const [saving, setSaving] = useState(false);
  const canCreate = useCanDo('spinnerCampaigns', 'create');
  const [errors, setErrors] = useState<{ name?: string; start?: string; end?: string }>({});

  const onCreate = async () => {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Campaign name is required.';
    if (!startDate) errs.start = 'Start date is required.';
    if (!endDate) errs.end = 'End date is required.';
    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      errs.end = 'End date must be on or after the start date.';
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error('Please fix the highlighted fields.');
      return;
    }

    const values: CampaignBasics = {
      name,
      startDate,
      endDate,
      eligibility,
      spinsPerDay: Math.max(1, Number(spinsPerDay) || 1),
      activateImmediately: activate,
    };
    try {
      setSaving(true);
      const id = newSpinCampaignId();
      await createCampaign(id, values);
      toast.success('Campaign created — configure the wheel');
      navigate(`/spinner/${id}`);
    } catch {
      toast.error('Could not create the campaign.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
          Create campaign
        </h1>
        <div className="flex gap-2.5">
          <Button variant="outline" className="h-[42px]" onClick={() => navigate('/spinner')}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="h-[42px]"
            loading={saving}
            disabled={!canCreate}
            title={canCreate ? undefined : noPermissionTitle('spinnerCampaigns', 'create')}
            onClick={onCreate}
          >
            Create &amp; configure
          </Button>
        </div>
      </div>

      <div className="flex max-w-[640px] flex-col gap-4">
        <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
          <div className="flex flex-col gap-3.5">
            <Field label="Campaign name" error={errors.name}>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrors((x) => ({ ...x, name: undefined }));
                }}
                placeholder="Eid Mega Spin"
                className={cn(inputCls, errors.name && 'border-error focus:border-error')}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3.5">
              <Field label="Start date" error={errors.start}>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setErrors((x) => ({ ...x, start: undefined, end: undefined }));
                  }}
                  className={cn(inputCls, errors.start && 'border-error focus:border-error')}
                />
              </Field>
              <Field label="End date" error={errors.end}>
                <input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setErrors((x) => ({ ...x, end: undefined }));
                  }}
                  className={cn(inputCls, errors.end && 'border-error focus:border-error')}
                />
              </Field>
            </div>

            <Select
              label="Eligibility"
              value={eligibility}
              onChange={(v) => setEligibility(v as CouponTarget)}
              options={ELIGIBILITY}
            />

            <Field label="Spins per day">
              <input
                type="number"
                min={1}
                value={spinsPerDay}
                onChange={(e) => setSpinsPerDay(e.target.value)}
                className={inputCls}
              />
              <p className="mt-1.5 font-ui text-[11px] leading-relaxed text-text-tertiary">
                How many times each customer may spin per day while this campaign runs. Resets at
                midnight (IST).
              </p>
            </Field>

            <div className="flex items-center justify-between">
              <span className="font-ui text-[13px] font-semibold text-text-secondary">
                Activate immediately
              </span>
              <Toggle checked={activate} onChange={setActivate} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-ui text-xs font-bold text-text-primary">{label}</span>
      {children}
      {error && <span className="font-ui text-xs text-error">{error}</span>}
    </label>
  );
}
