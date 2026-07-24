import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { paiseToRupees, rupeesToPaise } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Toggle } from '@/components/ui/Toggle';
import { noPermissionTitle, useCan } from '@/features/auth/useCan';
import { useCategories } from '@/features/categories/api/categories';
import { SettingsShell } from '../components/SettingsShell';
import { Card, CardTitle, Field, ToggleRow, inputCls } from '../components/fields';
import {
  DEFAULT_DELIVERY,
  DEFAULT_TAX,
  isValidGstin,
  saveDelivery,
  saveTax,
  useDelivery,
  useTax,
} from '../api/settings';

const money = (paise: number) => (paise ? String(paiseToRupees(paise)) : '');

export function DeliveryTaxTab() {
  const { data: delivery, loading: dLoading, error: dError } = useDelivery();
  const { data: tax, loading: tLoading, error: tError } = useTax();
  // The HSN map is keyed by category slug — the same key the invoice looks up
  // (`hsnCodes[it.category]`, and an order line's `category` is the product's
  // categorySlug). Driving the editor off the live category list means the map
  // can never gain a key no product will ever match.
  const { data: categories } = useCategories();
  const loading = (dLoading && !delivery) || (tLoading && !tax);
  const error = dError ?? tError;

  const canEdit = useCan()('settings', 'edit');
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Delivery fields (rupees in the input, paise in storage).
  const [standardFee, setStandardFee] = useState('');
  const [freeOver, setFreeOver] = useState('');
  const [codSurcharge, setCodSurcharge] = useState('');
  const [daysMin, setDaysMin] = useState('');
  const [daysMax, setDaysMax] = useState('');

  // Tax fields.
  const [gstPercent, setGstPercent] = useState('');
  const [gstin, setGstin] = useState('');
  const [legalName, setLegalName] = useState('');
  const [businessCity, setBusinessCity] = useState('');
  const [businessCountry, setBusinessCountry] = useState('');
  const [gstEnabled, setGstEnabled] = useState(true);
  const [pricesIncludeTax, setPricesIncludeTax] = useState(true);
  const [gstinErr, setGstinErr] = useState<string | undefined>();
  /** categorySlug → HSN code, as stored on settings/tax.hsnCodes. */
  const [hsnCodes, setHsnCodes] = useState<Record<string, string>>({});

  // Seed once real data (or defaults) is available.
  useEffect(() => {
    if (seeded || loading) return;
    const d = delivery ?? DEFAULT_DELIVERY;
    const t = tax ?? DEFAULT_TAX;
    setStandardFee(money(d.standardFeePaise));
    setFreeOver(money(d.freeDeliveryOverPaise));
    setCodSurcharge(money(d.codSurchargePaise));
    setDaysMin(String(d.deliveryDaysMin ?? ''));
    setDaysMax(String(d.deliveryDaysMax ?? ''));
    // Exact, not rounded: the stored rate is a fraction, and Math.round turned a
    // 12.5% rate into "13" — which the next save of this form (it writes tax and
    // delivery together) then persisted back as 0.13.
    setGstPercent(String(+((t.gstRate ?? 0) * 100).toFixed(4)));
    setGstin(t.gstin ?? '');
    setLegalName(t.legalName ?? '');
    setBusinessCity(t.businessCity ?? '');
    setBusinessCountry(t.businessCountry ?? '');
    setGstEnabled(t.gstEnabled);
    setPricesIncludeTax(t.pricesIncludeTax);
    setHsnCodes({ ...(t.hsnCodes ?? {}) });
    setSeeded(true);
  }, [seeded, loading, delivery, tax]);

  const knownSlugs = new Set(categories.map((c) => c.slug));
  const orphanHsn = Object.entries(hsnCodes).filter(
    ([slug, code]) => code.trim() !== '' && !knownSlugs.has(slug),
  );

  const onSave = async () => {
    const g = gstin.trim().toUpperCase();
    if (gstEnabled && g && !isValidGstin(g)) {
      setGstinErr('Enter a valid 15-character GSTIN.');
      toast.error('Enter a valid GSTIN.');
      return;
    }
    // The field is a percent but storage is a fraction, so an unvalidated entry
    // silently becomes a real tax rate: "0.18" would store 0.0018 and "1800"
    // would store 18× the order value.
    const percent = Number(gstPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      toast.error('Enter a GST rate between 0 and 100.');
      return;
    }
    setGstinErr(undefined);
    try {
      setSaving(true);
      await Promise.all([
        saveDelivery({
          id: 'delivery',
          standardFeePaise: rupeesToPaise(Number(standardFee) || 0),
          freeDeliveryOverPaise: rupeesToPaise(Number(freeOver) || 0),
          codSurchargePaise: rupeesToPaise(Number(codSurcharge) || 0),
          deliveryDaysMin: Math.max(0, Math.round(Number(daysMin) || 0)),
          deliveryDaysMax: Math.max(0, Math.round(Number(daysMax) || 0)),
        }),
        saveTax({
          id: 'tax',
          gstRate: percent / 100,
          gstEnabled,
          gstin: g,
          legalName: legalName.trim(),
          businessCity: businessCity.trim(),
          businessCountry: businessCountry.trim(),
          pricesIncludeTax,
          // Blank rows are dropped rather than stored as '': the invoice tests
          // the looked-up value with `?? ''` and then `.trim()`, so an empty
          // string and a missing key mean the same thing — but a stored empty
          // string would keep a key for a category the admin cleared.
          hsnCodes: Object.fromEntries(
            Object.entries(hsnCodes)
              .map(([slug, code]) => [slug, code.trim()] as const)
              .filter(([, code]) => code !== ''),
          ),
        }),
      ]);
      toast.success('Changes saved');
    } catch {
      toast.error('Could not save settings.');
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
    <SettingsShell active="delivery" action={action}>
      {loading ? (
        <div className="grid place-items-center py-24">
          <Spinner className="h-7 w-7 text-brand-primary" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-border-subtle bg-surface-card p-8 text-center font-ui text-sm text-text-tertiary">
          Couldn’t load settings. Please refresh.
        </div>
      ) : (
        <div className="flex max-w-[720px] flex-col gap-4">
          <Card>
            <CardTitle>Delivery</CardTitle>
            <div className="grid grid-cols-2 gap-3.5">
              <Field label="Standard delivery fee" prefix="₹" value={standardFee} onChange={setStandardFee} inputMode="decimal" type="number" placeholder="40" />
              <Field label="Free delivery over" prefix="₹" value={freeOver} onChange={setFreeOver} inputMode="decimal" type="number" placeholder="1499" />
              <Field label="COD surcharge" prefix="₹" value={codSurcharge} onChange={setCodSurcharge} inputMode="decimal" type="number" placeholder="0" />
              <div className="grid grid-cols-2 gap-3.5">
                <Field label="Delivery days (min)" value={daysMin} onChange={setDaysMin} inputMode="numeric" type="number" placeholder="2" />
                <Field label="Delivery days (max)" value={daysMax} onChange={setDaysMax} inputMode="numeric" type="number" placeholder="5" />
              </div>
            </div>
          </Card>

          <Card>
            <CardTitle>Tax</CardTitle>
            <div className="grid grid-cols-2 gap-3.5">
              <Field label="GST rate" suffix="%" value={gstPercent} onChange={setGstPercent} inputMode="decimal" type="number" placeholder="18" />
              <Field
                label="GSTIN"
                value={gstin}
                onChange={(v) => {
                  setGstin(v.toUpperCase());
                  setGstinErr(undefined);
                }}
                placeholder="32ABCDE1234F1Z5"
                error={gstinErr}
              />
              <Field label="Legal name" value={legalName} onChange={setLegalName} placeholder="Barakath Traders" />
              <Field label="Business city" value={businessCity} onChange={setBusinessCity} placeholder="Chennai" />
              <Field label="Business country" value={businessCountry} onChange={setBusinessCountry} placeholder="India" />
            </div>
            <ToggleRow label="Collect GST" divided>
              <Toggle checked={gstEnabled} onChange={setGstEnabled} />
            </ToggleRow>
            <ToggleRow label="Prices include tax" divided>
              <Toggle checked={pricesIncludeTax} onChange={setPricesIncludeTax} />
            </ToggleRow>
          </Card>

          {/* HSN codes per category.
              functions/src/orders/invoice.ts prints
              `it.hsnCode ?? hsnCodes[category] ?? ''` on every invoice line and
              only renders the HSN column when at least one line resolves a
              code. This map was preserved on save but never editable, and the
              per-product field was hardcoded null — so the column never
              appeared on any GST invoice the store has ever issued. */}
          <Card>
            <CardTitle>HSN codes</CardTitle>
            <p className="mb-3.5 font-ui text-[11px] leading-snug text-text-tertiary">
              Printed on the GST invoice for every line in that category. A product with its own HSN
              code (Products › Edit › HSN code) overrides the category’s. Leave a row blank to print
              nothing for it.
            </p>
            {categories.length === 0 ? (
              <p className="font-ui text-xs text-text-tertiary">No categories yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3.5">
                {categories.map((c) => (
                  <label key={c.id} className="flex flex-col gap-1.5">
                    <span className="font-ui text-xs font-bold text-text-primary">{c.name}</span>
                    <input
                      value={hsnCodes[c.slug] ?? ''}
                      onChange={(e) =>
                        setHsnCodes((m) => ({
                          ...m,
                          // HSN codes are 4/6/8-digit numerics — anything else
                          // would print as-is on a tax document.
                          [c.slug]: e.target.value.replace(/[^0-9]/g, '').slice(0, 8),
                        }))
                      }
                      placeholder="33030090"
                      inputMode="numeric"
                      className={inputCls}
                    />
                  </label>
                ))}
              </div>
            )}
            {/* Codes stored for categories that no longer exist would silently
                keep applying to any legacy order line carrying that slug, so
                surface them rather than hiding them behind the category list. */}
            {orphanHsn.length > 0 && (
              <div className="mt-3.5 border-t border-border-subtle pt-3.5">
                <div className="mb-2 font-ui text-[11px] font-bold text-text-primary">
                  Codes for categories that no longer exist
                </div>
                <div className="flex flex-col gap-2">
                  {orphanHsn.map(([slug, code]) => (
                    <div key={slug} className="flex items-center justify-between gap-3">
                      <span className="font-ui text-[12px] text-text-secondary">
                        {slug} · {code}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setHsnCodes((m) => {
                            const next = { ...m };
                            delete next[slug];
                            return next;
                          })
                        }
                        className="font-ui text-[11px] font-bold text-error hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </SettingsShell>
  );
}
