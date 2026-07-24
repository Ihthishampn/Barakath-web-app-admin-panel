import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import { toast } from 'sonner';
import { RiAddLine, RiCloseLine } from '@remixicon/react';
import type { CouponTarget, SpinCampaign, SpinPrizeType, SpinSlice } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { noPermissionTitle, useCanDo } from '@/features/auth/useCan';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import {
  isoDate,
  kindOf,
  paiseFromRupees,
  prizeTypeFor,
  saveCampaign,
  setCampaignStatus,
  sliceId,
  useSpinCampaign,
  type SliceKind,
} from '../api/spinner';

const inputCls =
  'w-full rounded-sm border border-border-default bg-surface-card px-[13px] py-[11px] font-ui text-[13px] font-medium text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none';

const ELIGIBILITY: { value: CouponTarget; label: string }[] = [
  { value: 'all', label: 'All users' },
  { value: 'new', label: 'New users' },
  { value: 'existing', label: 'Existing users' },
  { value: 'affiliates', label: 'Affiliates' },
  { value: 'segment', label: 'Segment' },
];

// Wheel + probability-bar palette (mirrors the prototype's conic-gradient).
const PALETTE = [
  'var(--brand-primary)',
  'var(--brand-gold)',
  'var(--brand-primary-dark)',
  'var(--brand-gold-strong)',
  'var(--success)',
  'var(--info)',
  '#c8901f',
  'var(--neutral-300)',
];

const numberGroup = (n: number) => n.toLocaleString('en-IN');

interface Row {
  key: string;
  id: string;
  kind: SliceKind;
  prizeType: SpinPrizeType;
  label: string;
  amount: number | ''; // rupees, for the ₹ kind
  percent: number | ''; // for the % kind
  weight: number | '';
  usedCount: number;
  // preserved (not surfaced in this editor, carried through on save)
  minCartValuePaise: number;
  discountMaxCapPaise: number | null;
  couponTemplateCode: string | null;
  validityDays: number;
  secondaryLabel: string;
}

function sliceToRow(s: SpinSlice): Row {
  return {
    key: sliceId(),
    id: s.id,
    kind: kindOf(s.prizeType),
    prizeType: s.prizeType,
    label: s.displayLabel,
    amount: s.discountValuePaise == null ? '' : s.discountValuePaise / 100,
    percent: s.discountPercent == null ? '' : s.discountPercent,
    weight: s.weight,
    usedCount: s.usedCount ?? 0,
    minCartValuePaise: s.minCartValuePaise ?? 0,
    discountMaxCapPaise: s.discountMaxCapPaise ?? null,
    couponTemplateCode: s.couponTemplateCode ?? null,
    validityDays: s.validityDays ?? 7,
    secondaryLabel: s.secondaryLabel ?? '',
  };
}

function rowToSlice(r: Row, order: number): SpinSlice {
  return {
    id: r.id,
    order,
    prizeType: r.prizeType,
    discountValuePaise: r.kind === 'amount' ? paiseFromRupees(r.amount) : null,
    discountPercent: r.kind === 'percent' ? (r.percent === '' ? 0 : Number(r.percent)) : null,
    discountMaxCapPaise: r.discountMaxCapPaise,
    minCartValuePaise: r.minCartValuePaise,
    couponTemplateCode: r.couponTemplateCode,
    validityDays: r.validityDays,
    weight: r.weight === '' ? 0 : Number(r.weight),
    displayLabel: r.label.trim(),
    secondaryLabel: r.secondaryLabel,
    usedCount: r.usedCount,
  };
}

const newRow = (): Row => ({
  key: sliceId(),
  id: sliceId(),
  kind: 'amount',
  prizeType: 'flat_discount',
  label: '',
  amount: '',
  percent: '',
  weight: 10,
  usedCount: 0,
  minCartValuePaise: 0,
  discountMaxCapPaise: null,
  couponTemplateCode: null,
  validityDays: 7,
  secondaryLabel: '',
});

export function CampaignDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: campaign, loading, error } = useSpinCampaign(id ?? null);

  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [eligibility, setEligibility] = useState<CouponTarget>('all');
  const [spinsPerDay, setSpinsPerDay] = useState('1');
  const [saving, setSaving] = useState(false);
  const [pausing, setPausing] = useState(false);
  // saveCampaign / setCampaignStatus are direct writes gated on
  // canWrite('spinnerCampaigns') — edit covers both.
  const canEdit = useCanDo('spinnerCampaigns', 'edit');
  const [formError, setFormError] = useState<string | null>(null);
  // Seed local edit state once from the first snapshot; live updates afterwards
  // must not clobber in-progress edits.
  const seeded = useRef(false);
  const loadedRef = useRef<SpinCampaign | null>(null);

  useEffect(() => {
    if (campaign) loadedRef.current = campaign;
    if (campaign && !seeded.current) {
      setRows((campaign.slices ?? []).slice().sort((a, b) => a.order - b.order).map(sliceToRow));
      setName(campaign.name ?? '');
      setStartDate(campaign.startsAt ? isoDate(campaign.startsAt.toDate()) : '');
      setEndDate(campaign.endsAt ? isoDate(campaign.endsAt.toDate()) : '');
      setEligibility(campaign.eligibility ?? 'all');
      setSpinsPerDay(String(campaign.spinsPerDay ?? 1));
      seeded.current = true;
    }
  }, [campaign]);

  // Not-found (settled, no doc).
  useEffect(() => {
    if (!loading && !error && id && campaign === null && !seeded.current) {
      toast.error('Campaign not found.');
      navigate('/spinner');
    }
  }, [loading, error, campaign, id, navigate]);

  const totalWeight = useMemo(
    () => rows.reduce((n, r) => n + (r.weight === '' ? 0 : Number(r.weight)), 0),
    [rows],
  );

  const wheelGradient = useMemo(() => {
    if (rows.length === 0 || totalWeight <= 0) return 'var(--neutral-200)';
    let acc = 0;
    const stops = rows.map((r, i) => {
      const w = r.weight === '' ? 0 : Number(r.weight);
      const from = (acc / totalWeight) * 360;
      acc += w;
      const to = (acc / totalWeight) * 360;
      return `${PALETTE[i % PALETTE.length]} ${from}deg ${to}deg`;
    });
    return `conic-gradient(${stops.join(',')})`;
  }, [rows, totalWeight]);

  const updRow = (key: string, patch: Partial<Row>) => {
    setFormError(null);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const setKind = (key: string, kind: SliceKind) =>
    setRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, kind, prizeType: prizeTypeFor(kind, r.prizeType) } : r)),
    );
  const addRow = () => {
    setFormError(null);
    setRows((rs) => [...rs, newRow()]);
  };
  const delRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));

  const onSave = async () => {
    const loaded = loadedRef.current;
    if (!loaded || !id) return;

    if (rows.length < 2) {
      setFormError('Add at least 2 offers for the wheel.');
      return toast.error('Add at least 2 offers.');
    }
    if (rows.some((r) => !r.label.trim())) {
      setFormError('Every offer needs a reward label.');
      return toast.error('Every offer needs a label.');
    }
    if (rows.some((r) => r.weight === '' || Number(r.weight) <= 0)) {
      setFormError('Every offer needs a probability weight greater than 0.');
      return toast.error('Probability weights must be greater than 0.');
    }
    if (rows.some((r) => r.kind === 'amount' && (r.amount === '' || Number(r.amount) <= 0))) {
      setFormError('₹ offers need a reward amount greater than ₹0.');
      return toast.error('₹ offers need an amount.');
    }
    if (rows.some((r) => r.kind === 'percent' && (r.percent === '' || Number(r.percent) <= 0 || Number(r.percent) > 100))) {
      setFormError('% offers need a percentage between 1 and 100.');
      return toast.error('% offers need a valid percentage.');
    }
    if (!name.trim()) {
      setFormError('Campaign name is required.');
      return toast.error('Campaign name is required.');
    }
    if (!startDate || !endDate) {
      setFormError('Set both a start and an end date.');
      return toast.error('Campaign dates are required.');
    }
    // Same day-boundary convention as campaign creation: start opens the day,
    // end closes it.
    const startsMs = new Date(`${startDate}T00:00:00`).getTime();
    const endsMs = new Date(`${endDate}T23:59:59`).getTime();
    if (endsMs < startsMs) {
      setFormError('Campaign end date is before its start date.');
      return toast.error('Invalid campaign dates.');
    }

    try {
      setSaving(true);
      await saveCampaign(id, {
        name,
        slices: rows.map(rowToSlice),
        eligibility,
        spinsPerDay: Math.max(1, Number(spinsPerDay) || 1),
        startsAt: Timestamp.fromMillis(startsMs),
        endsAt: Timestamp.fromMillis(endsMs),
      });
      toast.success('Wheel saved');
      navigate('/spinner');
    } catch (e) {
      console.error('saveCampaign failed:', e);
      toast.error(`Could not save the wheel. ${(e as { message?: string })?.message ?? ''}`.trim());
    } finally {
      setSaving(false);
    }
  };

  const onToggleStatus = async () => {
    const loaded = loadedRef.current;
    if (!loaded || !id) return;
    const next = loaded.status === 'active' ? 'paused' : 'active';
    // `loaded.status` is the effective (window-aware) status, so a campaign past
    // its end date reads 'ended' and the button offers "Activate" — but writing
    // status:'active' changes nothing at all: executeSpin rejects on the end
    // date BEFORE it looks at the status, and the badge re-derives 'ended' on
    // the next snapshot. Name the real blocker instead of toasting success.
    if (next === 'active' && loaded.endsAt && loaded.endsAt.toMillis() < Date.now()) {
      toast.error(`This campaign ended on ${isoDate(loaded.endsAt.toDate())}. Change the end date and save, then activate.`);
      return;
    }
    try {
      setPausing(true);
      await setCampaignStatus(id, next);
      toast.success(next === 'active' ? 'Campaign activated' : 'Campaign paused');
    } catch {
      toast.error('Could not update the status.');
    } finally {
      setPausing(false);
    }
  };

  if (error) {
    return (
      <div className="px-7 py-6">
        <div className="grid place-items-center rounded-xl border border-border-subtle bg-surface-card py-20 text-center">
          <p className="font-ui text-[13px] text-error">Couldn’t load this campaign. Check your connection and retry.</p>
        </div>
      </div>
    );
  }
  if (loading && !campaign) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="h-7 w-7 text-brand-primary" />
      </div>
    );
  }
  if (!campaign) return null;

  const isActive = campaign.status === 'active';

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
          {campaign.name}
        </h1>
        <div className="flex gap-2.5">
          <Button
            variant="outline"
            className="h-[42px]"
            loading={pausing}
            disabled={!canEdit}
            title={canEdit ? undefined : noPermissionTitle('spinnerCampaigns', 'edit')}
            onClick={onToggleStatus}
          >
            {isActive ? 'Pause' : 'Activate'}
          </Button>
          <Button
            variant="primary"
            className="h-[42px]"
            loading={saving}
            disabled={!canEdit}
            title={canEdit ? undefined : noPermissionTitle('spinnerCampaigns', 'edit')}
            onClick={onSave}
          >
            Save
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[340px_1fr] gap-5">
        {/* LEFT — wheel preview */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
            <div className="mb-4 font-display text-sm font-bold text-text-primary">Wheel preview</div>
            <div className="flex justify-center">
              <div className="relative h-[240px] w-[240px]">
                <div
                  className="absolute inset-0 rounded-full border-[6px] border-surface-card shadow-md"
                  style={{ background: wheelGradient }}
                />
                <div className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-surface-card font-display text-xs font-extrabold text-brand-primary shadow-sm">
                  SPIN
                </div>
              </div>
            </div>
            <div className="mt-4 text-center">
              <div className="font-ui text-[11px] font-medium text-text-tertiary">Total plays</div>
              <div className="mt-1.5 font-display text-2xl font-extrabold text-text-primary">
                {numberGroup(campaign.totalSpins)}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
            <div className="mb-4 font-display text-sm font-bold text-text-primary">Campaign settings</div>
            <div className="flex flex-col gap-3.5">
              <Field label="Campaign name">
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setFormError(null);
                  }}
                  placeholder="Eid Mega Spin"
                  className={inputCls}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3.5">
                <Field label="Start date">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setFormError(null);
                    }}
                    className={inputCls}
                  />
                </Field>
                <Field label="End date">
                  <input
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setFormError(null);
                    }}
                    className={inputCls}
                  />
                </Field>
              </div>
              <Select
                label="Eligibility"
                value={eligibility}
                onChange={(v) => {
                  setEligibility(v as CouponTarget);
                  setFormError(null);
                }}
                options={ELIGIBILITY}
              />
              <Field label="Spins per day">
                <input
                  type="number"
                  min={1}
                  value={spinsPerDay}
                  onChange={(e) => {
                    setSpinsPerDay(e.target.value);
                    setFormError(null);
                  }}
                  className={inputCls}
                />
                <p className="mt-1.5 font-ui text-[11px] text-text-tertiary">
                  Max spins per customer per day (resets midnight IST).
                </p>
              </Field>
            </div>
          </div>
        </div>

        {/* RIGHT — offers editor */}
        <div>
          <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="font-display text-sm font-bold text-text-primary">Wheel offers</div>
              <button
                onClick={addRow}
                className="inline-flex items-center gap-1.5 font-ui text-xs font-bold text-brand-primary"
              >
                <RiAddLine size={15} /> Add offer
              </button>
            </div>
            <p className="mb-1.5 font-ui text-[11px] leading-snug text-text-tertiary">
              Choose type (₹ / % / ==), enter the reward text, then set a probability weight — the wheel splits
              by relative weight. Usage shows how many players landed on it.
            </p>

            {rows.length === 0 && (
              <p className="py-6 font-ui text-xs text-text-tertiary">
                No offers yet. Add at least 2 to build the wheel.
              </p>
            )}

            {rows.map((r, i) => {
              const w = r.weight === '' ? 0 : Number(r.weight);
              const chance = totalWeight > 0 ? Math.round((w / totalWeight) * 100) : 0;
              const color = PALETTE[i % PALETTE.length];
              return (
                <div
                  key={r.key}
                  className="flex items-center gap-[14px] border-b border-border-subtle py-3"
                >
                  {/* type toggle */}
                  <div className="flex-none">
                    <div className="flex gap-1.5">
                      {(['amount', 'percent', 'special'] as SliceKind[]).map((k) => (
                        <button
                          key={k}
                          onClick={() => setKind(r.key, k)}
                          className={cn(
                            'inline-flex h-[34px] w-[38px] items-center justify-center rounded-[7px] border font-display text-[13px] font-extrabold',
                            r.kind === k
                              ? 'border-brand-primary bg-brand-primary text-white'
                              : 'border-border-default bg-surface-card text-text-secondary',
                          )}
                        >
                          {k === 'amount' ? '₹' : k === 'percent' ? '%' : '=='}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* reward label */}
                  <input
                    value={r.label}
                    onChange={(e) => updRow(r.key, { label: e.target.value })}
                    placeholder="Reward text (e.g. ₹10 off · min ₹99)"
                    className="min-w-0 flex-1 rounded-sm border border-border-default px-3 py-[9px] font-ui text-[13px] font-semibold text-text-primary placeholder:font-normal placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none"
                  />

                  {/* value (₹ or %) */}
                  {r.kind !== 'special' && (
                    <div className="flex w-[92px] flex-none items-center gap-1 rounded-sm border border-border-default px-2 py-[9px]">
                      <span className="font-display text-[12px] font-bold text-text-secondary">
                        {r.kind === 'amount' ? '₹' : '%'}
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={r.kind === 'amount' ? r.amount : r.percent}
                        onChange={(e) => {
                          const v = e.target.value === '' ? '' : Number(e.target.value);
                          updRow(r.key, r.kind === 'amount' ? { amount: v } : { percent: v });
                        }}
                        className="w-full bg-transparent font-display text-[12px] font-bold text-text-primary focus:outline-none"
                      />
                    </div>
                  )}

                  {/* coupon validity — how long the won coupon stays usable */}
                  {r.kind !== 'special' && (
                    <div className="flex w-[92px] flex-none items-center gap-1 rounded-sm border border-border-default px-2 py-[9px]" title="Days the won coupon stays valid">
                      <input
                        type="number"
                        min={1}
                        value={r.validityDays}
                        onChange={(e) => updRow(r.key, { validityDays: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-full bg-transparent font-display text-[12px] font-bold text-text-primary focus:outline-none"
                      />
                      <span className="font-ui text-[11px] font-semibold text-text-tertiary">days</span>
                    </div>
                  )}

                  {/* probability weight + live chance bar */}
                  <div className="w-[150px] flex-none">
                    <div className="mb-1.5 flex items-center justify-between font-ui text-[11px] font-semibold text-text-secondary">
                      <span>Weight</span>
                      <input
                        type="number"
                        min={1}
                        value={r.weight}
                        onChange={(e) =>
                          updRow(r.key, { weight: e.target.value === '' ? '' : Number(e.target.value) })
                        }
                        className="w-12 rounded border border-border-default px-1.5 py-0.5 text-right font-display text-[12px] font-bold text-text-primary focus:border-brand-primary focus:outline-none"
                      />
                    </div>
                    <div className="mb-1 flex items-center justify-between font-ui text-[11px] font-semibold text-text-secondary">
                      <span>Chance</span>
                      <span className="font-bold text-text-primary">{chance}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-pill bg-neutral-200">
                      <div className="h-full" style={{ width: `${chance}%`, background: color }} />
                    </div>
                  </div>

                  {/* delete */}
                  <button
                    onClick={() => delRow(r.key)}
                    className="flex-none text-error hover:opacity-80"
                    aria-label="Remove offer"
                  >
                    <RiCloseLine size={16} />
                  </button>
                </div>
              );
            })}

            {formError && <p className="mt-3 font-ui text-xs text-error">{formError}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-ui text-xs font-bold text-text-primary">{label}</span>
      {children}
    </label>
  );
}
