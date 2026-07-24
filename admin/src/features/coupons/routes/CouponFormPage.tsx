import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { RiAddLine, RiCloseLine } from '@remixicon/react';
import type { CouponTarget, DiscountType } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { getCachedList } from '@/hooks/firestoreCache';
import { noPermissionTitle, useCan } from '@/features/auth/useCan';
import { useCategories } from '@/features/categories/api/categories';
import { useProductsList } from '@/features/products/api/products';
import { ProductPickerModal } from '@/features/products/components/ProductPickerModal';
import {
  autoApplyBlocker,
  COUPONS_KEY,
  getCoupon,
  newCouponId,
  saveCoupon,
  type CouponDoc,
  type CouponFormValues,
} from '../api/coupons';

type Money = number | '';
const toPaise = (r: Money) => (r === '' ? 0 : Math.round(Number(r) * 100));
const toRupees = (p: number | null | undefined): Money => (p == null ? '' : p / 100);

// A flat coupon over this is almost certainly a typo — keep discounts sane.
const MAX_FLAT_RUPEES = 10000;

const TYPE_OPTIONS = [
  { value: 'flat', label: 'Fixed amount (₹)' },
  { value: 'percent', label: 'Percentage (%)' },
  { value: 'free_shipping', label: 'Free shipping' },
];
const TARGET_OPTIONS = [
  { value: 'all', label: 'All users' },
  { value: 'new', label: 'New users' },
  { value: 'existing', label: 'Existing users' },
  { value: 'affiliates', label: 'Affiliates' },
  { value: 'segment', label: 'Segment' },
];

/** yyyy-mm-dd for the native date input (local date). */
function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * A start date becomes local midnight — the coupon works for the whole of the
 * day the admin picked, matching the expiry field, which resolves to 23:59:59
 * of its own day.
 */
const startFrom = (iso: string): number | null => (iso ? new Date(`${iso}T00:00:00`).getTime() : null);

interface FormErrors {
  code?: string;
  discountValue?: string;
  maxDiscount?: string;
  expiry?: string;
  startDate?: string;
}

/** Which product list a picker is currently filling. */
type PickerFor = 'applicable' | 'excluded' | null;

export function CouponFormPage() {
  const { id: routeId } = useParams();
  const isNew = !routeId || routeId === 'new';
  const navigate = useNavigate();
  const { data: categories } = useCategories();
  const { data: products } = useProductsList();
  const canSave = useCan()('coupons', isNew ? 'create' : 'edit');

  // Seed instantly from the coupons cache so opening an edit never blanks the screen.
  const seed = useState<CouponDoc | null>(() =>
    isNew ? null : (getCachedList<CouponDoc>(COUPONS_KEY).find((c) => c.id === routeId) ?? null),
  )[0];

  const [id] = useState(() => (isNew ? newCouponId() : routeId!));
  const [loading, setLoading] = useState(!isNew && !seed);
  const [saving, setSaving] = useState(false);

  const [code, setCode] = useState(seed?.code ?? '');
  const [discountType, setDiscountType] = useState<DiscountType>(seed?.discountType ?? 'flat');
  const [discountValue, setDiscountValue] = useState<Money>(() =>
    seed
      ? seed.discountType === 'percent'
        ? seed.discountPercent || ''
        : toRupees(seed.discountValuePaise)
      : '',
  );
  const [maxDiscount, setMaxDiscount] = useState<Money>(toRupees(seed?.discountMaxCapPaise ?? null));
  const [minCart, setMinCart] = useState<Money>(seed ? toRupees(seed.minCartValuePaise) : '');
  const [usageLimit, setUsageLimit] = useState<Money>(seed?.maxUsesTotal ?? '');
  const [perUserLimit, setPerUserLimit] = useState<Money>(seed?.maxUsesPerUser ?? '');
  const [targetUsers, setTargetUsers] = useState<CouponTarget>(seed?.targetUsers ?? 'all');
  const [selectedCats, setSelectedCats] = useState<string[]>(seed?.applicableCategories ?? []);
  const [applicableProducts, setApplicableProducts] = useState<string[]>(seed?.applicableProducts ?? []);
  const [excludedProducts, setExcludedProducts] = useState<string[]>(seed?.excludedProducts ?? []);
  const [picker, setPicker] = useState<PickerFor>(null);
  // A coupon created before this field existed was stamped validFrom = now on
  // create, so an old coupon shows its creation date and stays live — editing
  // it doesn't change when it started.
  const [startDate, setStartDate] = useState(seed?.validFrom ? toISODate(seed.validFrom.toDate()) : '');
  const [noExpiry, setNoExpiry] = useState(seed ? seed.validUntil == null : false);
  const [expiry, setExpiry] = useState(seed?.validUntil ? toISODate(seed.validUntil.toDate()) : '');
  const [active, setActive] = useState(seed?.active ?? true);
  const [autoApply, setAutoApply] = useState(seed?.autoApply !== false);
  const [errors, setErrors] = useState<FormErrors>({});

  // Load / refresh from the server for edit (mirrors ProductFormPage).
  useEffect(() => {
    if (isNew) return;
    getCoupon(routeId!)
      .then((c) => {
        if (!c) {
          toast.error('Coupon not found.');
          navigate('/coupons');
          return;
        }
        if (!seed) {
          setCode(c.code);
          setDiscountType(c.discountType);
          setDiscountValue(
            c.discountType === 'percent' ? c.discountPercent || '' : toRupees(c.discountValuePaise),
          );
          setMaxDiscount(toRupees(c.discountMaxCapPaise));
          setMinCart(toRupees(c.minCartValuePaise));
          setUsageLimit(c.maxUsesTotal ?? '');
          setPerUserLimit(c.maxUsesPerUser ?? '');
          setTargetUsers(c.targetUsers);
          setSelectedCats(c.applicableCategories ?? []);
          setApplicableProducts(c.applicableProducts ?? []);
          setExcludedProducts(c.excludedProducts ?? []);
          setStartDate(c.validFrom ? toISODate(c.validFrom.toDate()) : '');
          setNoExpiry(c.validUntil == null);
          setExpiry(c.validUntil ? toISODate(c.validUntil.toDate()) : '');
          setActive(c.active);
          setAutoApply(c.autoApply !== false);
        }
      })
      .catch(() => {
        // Without this the read rejecting (offline / transient) left the page on
        // the spinner forever — `loading` only cleared in the fulfilled branch —
        // with no message and no way back.
        toast.error('Could not load this coupon.');
        navigate('/coupons');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, routeId, navigate]);

  const isPercent = discountType === 'percent';
  const isFreeShip = discountType === 'free_shipping';

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  // A product that was deleted after being attached still has to render — the
  // id is what the checkout matches on, so it must stay visible and removable.
  const productName = (pid: string) => productById.get(pid)?.name ?? pid;
  const conflictingProducts = applicableProducts.filter((p) => excludedProducts.includes(p));
  const blocker = autoApplyBlocker({
    targetUsers,
    maxUsesPerUser: perUserLimit === '' ? null : Number(perUserLimit),
  });

  const toggleCat = (slug: string) =>
    setSelectedCats((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));

  const onSave = async () => {
    const errs: FormErrors = {};
    const trimmed = code.trim();
    if (!trimmed) errs.code = 'Coupon code is required.';

    if (isPercent) {
      const pct = Number(discountValue);
      if (discountValue === '' || pct < 1 || pct > 100) {
        errs.discountValue = 'Enter a percentage between 1 and 100.';
      }
      if (maxDiscount === '' || Number(maxDiscount) <= 0) {
        errs.maxDiscount = 'A max-discount cap is required for percentage coupons.';
      }
    } else if (!isFreeShip) {
      const amt = Number(discountValue);
      if (discountValue === '' || amt <= 0) {
        errs.discountValue = 'Enter a discount amount greater than ₹0.';
      } else if (amt > MAX_FLAT_RUPEES) {
        errs.discountValue = `Flat discount can’t exceed ₹${MAX_FLAT_RUPEES.toLocaleString('en-IN')}.`;
      }
    }

    if (!noExpiry) {
      if (!expiry) {
        errs.expiry = 'Set an expiry date, or turn on No expiry.';
      } else if (new Date(`${expiry}T23:59:59`).getTime() <= Date.now()) {
        errs.expiry = 'Expiry must be a future date.';
      }
    }

    // A start after the expiry is a coupon that is never valid for a single
    // moment — the checkout would refuse it on both ends.
    if (startDate && !noExpiry && expiry && startFrom(startDate)! > new Date(`${expiry}T23:59:59`).getTime()) {
      errs.startDate = 'Start date must be on or before the expiry date.';
    }

    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error('Please fix the highlighted fields.');
      return;
    }

    const values: CouponFormValues = {
      id,
      code: trimmed,
      discountType,
      discountValuePaise: discountType === 'flat' ? toPaise(discountValue) : 0,
      discountPercent: isPercent ? Number(discountValue) : 0,
      discountMaxCapPaise: isPercent ? toPaise(maxDiscount) : null,
      minCartValuePaise: toPaise(minCart),
      maxUsesTotal: usageLimit === '' ? null : Number(usageLimit),
      maxUsesPerUser: perUserLimit === '' ? null : Number(perUserLimit),
      targetUsers,
      applicableCategories: selectedCats,
      applicableProducts,
      excludedProducts,
      active,
      autoApply,
      validFrom: startDate ? new Date(`${startDate}T00:00:00`) : null,
      validUntil: noExpiry ? null : new Date(`${expiry}T23:59:59`),
    };

    try {
      setSaving(true);
      await saveCoupon(values, isNew);
      toast.success(isNew ? 'Coupon created' : 'Changes saved');
      navigate('/coupons');
    } catch (e) {
      // Surface the real reason (e.g. a duplicate code) rather than a generic
      // failure the admin can't act on.
      toast.error((e as Error)?.message || 'Could not save the coupon.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="h-7 w-7 text-brand-primary" />
      </div>
    );
  }

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
          {isNew ? 'Create coupon' : 'Edit coupon'}
        </h1>
        <div className="flex gap-2.5">
          <Button variant="outline" className="h-[42px]" onClick={() => navigate('/coupons')}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="h-[42px]"
            loading={saving}
            disabled={!canSave}
            title={canSave ? undefined : noPermissionTitle('coupons', isNew ? 'create' : 'edit')}
            onClick={onSave}
          >
            {isNew ? 'Create coupon' : 'Save changes'}
          </Button>
        </div>
      </div>

      <div className="flex max-w-[720px] flex-col gap-4">
        <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
          <div className="grid grid-cols-2 gap-3.5">
            {/* Coupon code */}
            <Field label="Coupon code" error={errors.code}>
              <input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setErrors((x) => ({ ...x, code: undefined }));
                }}
                placeholder="SPIN30"
                className={cn(fieldCls, 'uppercase', errors.code && errBorder)}
              />
            </Field>

            {/* Discount type */}
            <Select
              label="Discount type"
              value={discountType}
              onChange={(v) => {
                setDiscountType(v as DiscountType);
                setErrors((x) => ({ ...x, discountValue: undefined, maxDiscount: undefined }));
              }}
              options={TYPE_OPTIONS}
            />

            {/* Discount value — hidden for free shipping (no value applies) */}
            {!isFreeShip && (
              <Field
                label={isPercent ? 'Discount percent' : 'Discount value'}
                error={errors.discountValue}
              >
                <PrefixInput
                  prefix={isPercent ? undefined : '₹'}
                  suffix={isPercent ? '%' : undefined}
                  value={discountValue}
                  onChange={(v) => {
                    setDiscountValue(v);
                    setErrors((x) => ({ ...x, discountValue: undefined }));
                  }}
                  invalid={!!errors.discountValue}
                  placeholder={isPercent ? '25' : '30'}
                />
              </Field>
            )}

            {/* Max discount — only percentage coupons need a cap */}
            {isPercent && (
              <Field label="Max discount" error={errors.maxDiscount}>
                <PrefixInput
                  prefix="₹"
                  value={maxDiscount}
                  onChange={(v) => {
                    setMaxDiscount(v);
                    setErrors((x) => ({ ...x, maxDiscount: undefined }));
                  }}
                  invalid={!!errors.maxDiscount}
                  placeholder="200"
                />
              </Field>
            )}

            {/* Min cart value */}
            <Field label="Min cart value">
              <PrefixInput prefix="₹" value={minCart} onChange={setMinCart} placeholder="150" />
            </Field>

            {/* Usage limit — total redemptions across every customer. */}
            <Field label="Usage limit" hint="Total redemptions. Blank = unlimited.">
              <PrefixInput
                value={usageLimit}
                onChange={setUsageLimit}
                placeholder="1000"
                integer
              />
            </Field>

            {/* Per-customer limit. Separate from the total above: a coupon with
                a total of 2 is still refused a customer's second go unless this
                is raised too, which is exactly the trap the hardcoded 1 set. */}
            <Field label="Per-customer limit" hint="How many times one customer may use it. Blank = 1.">
              <PrefixInput
                value={perUserLimit}
                onChange={setPerUserLimit}
                placeholder="1"
                integer
              />
            </Field>

            {/* Start date. `validFrom` is enforced by the checkout and both
                storefronts, and the list already badges a future one as
                "Scheduled" — but it was only ever stamped serverTimestamp() on
                create, so every coupon went live the instant it was saved. */}
            <Field
              label="Start date"
              error={errors.startDate}
              hint={
                startDate && startFrom(startDate)! > Date.now()
                  ? 'Scheduled — the coupon won’t work until this date.'
                  : 'Blank = live as soon as it’s active.'
              }
            >
              <input
                type="date"
                value={startDate}
                max={noExpiry ? undefined : expiry || undefined}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setErrors((x) => ({ ...x, startDate: undefined }));
                }}
                className={cn(fieldCls, errors.startDate && errBorder)}
              />
            </Field>

            {/* Expiry date + No-expiry toggle */}
            <Field label="Expiry date" error={errors.expiry}>
              <input
                type="date"
                value={expiry}
                disabled={noExpiry}
                onChange={(e) => {
                  setExpiry(e.target.value);
                  setErrors((x) => ({ ...x, expiry: undefined }));
                }}
                className={cn(
                  fieldCls,
                  noExpiry && 'opacity-50',
                  errors.expiry && errBorder,
                )}
              />
              <span className="mt-2 inline-flex items-center gap-2">
                <Toggle
                  checked={noExpiry}
                  onChange={(v) => {
                    setNoExpiry(v);
                    setErrors((x) => ({ ...x, expiry: undefined }));
                  }}
                />
                <span className="font-ui text-xs font-semibold text-text-secondary">No expiry</span>
              </span>
            </Field>

            {/* Target users */}
            <Select
              label="Target users"
              value={targetUsers}
              onChange={(v) => setTargetUsers(v as CouponTarget)}
              options={TARGET_OPTIONS}
            />
          </div>

          {/* Category restriction — multi-select chips */}
          <div className="mt-3.5 flex flex-col gap-1.5">
            <span className="font-ui text-xs font-bold text-text-primary">Category restriction</span>
            <div className="flex flex-wrap gap-2">
              <Chip selected={selectedCats.length === 0} onClick={() => setSelectedCats([])}>
                All categories
              </Chip>
              {categories.map((c) => (
                <Chip
                  key={c.slug}
                  selected={selectedCats.includes(c.slug)}
                  onClick={() => toggleCat(c.slug)}
                >
                  {c.name}
                </Chip>
              ))}
            </div>
            <span className="font-ui text-[11px] text-text-tertiary">
              {selectedCats.length === 0
                ? 'Applies to every category.'
                : `Limited to ${selectedCats.length} categor${selectedCats.length === 1 ? 'y' : 'ies'}.`}
            </span>
          </div>

          {/* Product restrictions. The checkout narrows the discountable
              subtotal by category slug, then by this allowlist, then removes
              anything on the denylist (discountableSubtotal in
              functions/src/orders/checkout.ts) — so an empty list means "no
              restriction", and the denylist always wins. */}
          <div className="mt-4 border-t border-border-subtle pt-4">
            <ProductList
              title="Applicable products"
              hint={
                applicableProducts.length === 0
                  ? 'Empty — every product in the allowed categories qualifies.'
                  : `Only these ${applicableProducts.length} product${applicableProducts.length === 1 ? '' : 's'} are discounted.`
              }
              ids={applicableProducts}
              nameOf={productName}
              onAdd={() => setPicker('applicable')}
              onRemove={(pid) => setApplicableProducts((a) => a.filter((x) => x !== pid))}
            />
            <div className="mt-3.5">
              <ProductList
                title="Excluded products"
                hint={
                  excludedProducts.length === 0
                    ? 'Empty — nothing is excluded.'
                    : `These ${excludedProducts.length} product${excludedProducts.length === 1 ? '' : 's'} are never discounted, even if listed above.`
                }
                ids={excludedProducts}
                nameOf={productName}
                onAdd={() => setPicker('excluded')}
                onRemove={(pid) => setExcludedProducts((a) => a.filter((x) => x !== pid))}
              />
            </div>
            {/* A product on both lists is simply excluded (the denylist is
                applied last), which is not what anyone means to configure. */}
            {conflictingProducts.length > 0 && (
              <p className="mt-2.5 font-ui text-[11px] text-error">
                {conflictingProducts.map(productName).join(', ')} {conflictingProducts.length === 1 ? 'is' : 'are'} on
                both lists — excluded wins, so {conflictingProducts.length === 1 ? 'it' : 'they'} will never be
                discounted.
              </p>
            )}
          </div>

          {/* Auto-apply. The server reads `autoApply !== false`, but
              autoBestOffer also skips any coupon it can't fully validate in its
              synchronous scan — so the toggle is paired with the real reason
              when one of those skips applies, rather than pretending it works. */}
          <div className="mt-4 border-t border-border-subtle pt-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-ui text-[13px] font-semibold text-text-primary">Auto-apply at checkout</div>
                <div className="mt-0.5 font-ui text-[11px] leading-snug text-text-tertiary">
                  Let the checkout pick this coupon up on its own when the customer enters no code.
                </div>
              </div>
              <Toggle checked={autoApply} onChange={setAutoApply} />
            </div>
            {autoApply && blocker && (
              <p className="mt-2 font-ui text-[11px] leading-snug text-brand-gold-strong">
                Won’t auto-apply: {blocker}
              </p>
            )}
          </div>
        </div>
      </div>

      {picker && (
        <ProductPickerModal
          title={picker === 'applicable' ? 'Applicable products' : 'Excluded products'}
          confirmVerb="Add"
          products={products.filter((p) =>
            picker === 'applicable' ? !applicableProducts.includes(p.id) : !excludedProducts.includes(p.id),
          )}
          onClose={() => setPicker(null)}
          onPick={(ids) => {
            if (picker === 'applicable') setApplicableProducts((a) => [...a, ...ids]);
            else setExcludedProducts((a) => [...a, ...ids]);
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}

/** One product-restriction list: heading, Add button, chips, explanatory hint. */
function ProductList({
  title,
  hint,
  ids,
  nameOf,
  onAdd,
  onRemove,
}: {
  title: string;
  hint: string;
  ids: string[];
  nameOf: (id: string) => string;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="font-ui text-xs font-bold text-text-primary">{title}</span>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 font-ui text-xs font-bold text-brand-primary"
        >
          <RiAddLine size={15} /> Add products
        </button>
      </div>
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {ids.map((pid) => (
            <span
              key={pid}
              className="inline-flex items-center gap-1.5 rounded-[7px] border border-border-subtle bg-surface-app px-2.5 py-1.5 font-ui text-xs font-semibold text-text-primary"
            >
              {nameOf(pid)}
              <button type="button" onClick={() => onRemove(pid)} className="text-text-tertiary hover:text-error">
                <RiCloseLine size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      <span className="font-ui text-[11px] text-text-tertiary">{hint}</span>
    </div>
  );
}

// ── Local components ───────────────────────────────────────────────
const fieldCls =
  'w-full rounded-sm border border-border-default bg-surface-card px-[13px] py-[11px] font-ui text-[13px] font-medium text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none';
const errBorder = 'border-error focus:border-error';

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  /** Shown under the input when there is no error — same styling as TextField. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-ui text-xs font-bold text-text-primary">{label}</span>
      {children}
      {error ? (
        <span className="font-ui text-xs text-error">{error}</span>
      ) : hint ? (
        <span className="font-ui text-xs text-text-tertiary">{hint}</span>
      ) : null}
    </label>
  );
}

function PrefixInput({
  value,
  onChange,
  prefix,
  suffix,
  placeholder,
  invalid,
  integer,
}: {
  value: Money;
  onChange: (v: Money) => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  invalid?: boolean;
  integer?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-sm border bg-surface-card px-[13px] py-[11px] focus-within:border-brand-primary',
        invalid ? 'border-error' : 'border-border-default',
      )}
    >
      {prefix && <span className="font-ui text-[13px] font-medium text-text-tertiary">{prefix}</span>}
      <input
        type="number"
        min={0}
        step={integer ? 1 : 'any'}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className="w-full bg-transparent font-ui text-[13px] font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none"
      />
      {suffix && <span className="font-ui text-[13px] font-medium text-text-tertiary">{suffix}</span>}
    </div>
  );
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-[7px] border px-2.5 py-1.5 font-ui text-xs font-semibold transition-colors',
        selected
          ? 'border-brand-primary bg-brand-primary-subtle text-brand-primary'
          : 'border-border-subtle bg-surface-app text-text-secondary hover:border-brand-primary',
      )}
    >
      {children}
    </button>
  );
}
