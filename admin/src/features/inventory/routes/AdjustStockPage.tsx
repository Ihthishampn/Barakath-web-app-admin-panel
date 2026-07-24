import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RiSubtractLine, RiAddLine } from '@remixicon/react';
import { Button } from '@/components/ui/Button';
import { noPermissionTitle, useCanDo } from '@/features/auth/useCan';
import { Select } from '@/components/ui/Select';
import { cfError } from '@/lib/cfError';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { adjustStock, buildSkuRows, LedgerWriteError, useInventoryProducts } from '../api/inventory';

const REASONS = [
  'New stock received',
  'Damage',
  'Loss',
  'Correction',
  'Return to inventory',
  'Manual audit',
  'Other',
];

/**
 * Adjust stock (spec §5.10). No prototype screen exists for this — styled to the
 * Barkath tokens. Per-SKU delta steppers + a shared reason, saved atomically.
 */
export function AdjustStockPage() {
  const navigate = useNavigate();
  const admin = useAuthStore((s) => s.admin);
  const { data: products, loading } = useInventoryProducts();
  const rows = useMemo(() => buildSkuRows(products), [products]);

  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [reasonErr, setReasonErr] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  // adminAdjustStock calls requireModule(req, 'inventory', 'edit').
  const canAdjust = useCanDo('inventory', 'edit');
  // Identifies this visit to the screen. It is half of the callable's
  // idempotency nonce (see adjustStock), so retrying a save that failed — or
  // whose response was simply lost — can never apply the same deltas twice.
  const sessionId = useRef(Math.random().toString(36).slice(2, 12)).current;

  const bump = (key: string, current: number, step: number) => {
    setDeltas((d) => {
      const next = (d[key] ?? 0) + step;
      // Don't let the resulting stock go below zero.
      if (current + next < 0) return d;
      return { ...d, [key]: next };
    });
  };

  const changedCount = Object.values(deltas).filter((v) => v !== 0).length;

  const onSave = async () => {
    if (changedCount === 0) return toast.info('No adjustments to save.');
    if (!reason) {
      setReasonErr('Reason is required.');
      return;
    }
    if (!admin) {
      toast.error('Session expired — please sign in again.');
      return;
    }
    // A bumped SKU can disappear from the live snapshot while this page is open
    // (product deleted, variant removed, simple product given variants — which
    // changes its row key). Drop those keys instead of dereferencing a missing
    // row, which used to throw outside the try block and dead-end the button.
    const rowByKey = new Map(rows.map((r) => [r.key, r]));
    const stale: string[] = [];
    const payload = Object.entries(deltas)
      .filter(([, v]) => v !== 0)
      .flatMap(([key, delta]) => {
        const r = rowByKey.get(key);
        if (!r) {
          stale.push(key);
          return [];
        }
        return [{ productId: r.productId, variantId: r.variantId, delta }];
      });
    if (stale.length > 0) {
      setDeltas((d) => {
        const next = { ...d };
        for (const k of stale) delete next[k];
        return next;
      });
      toast.info(`${stale.length} SKU${stale.length > 1 ? 's' : ''} changed while editing and ${stale.length > 1 ? 'were' : 'was'} skipped.`);
    }
    if (payload.length === 0) return;
    try {
      setSaving(true);
      await adjustStock(products, payload, {
        reason,
        reference: reference.trim(),
        adminUid: admin?.uid ?? 'unknown',
        adminName: admin?.name ?? 'Admin',
        sessionId,
      });
      toast.success(`Stock adjusted for ${payload.length} SKU${payload.length > 1 ? 's' : ''}`);
      navigate('/inventory');
    } catch (e) {
      if (e instanceof LedgerWriteError) {
        // Stock was already committed — clear the steppers so pressing Save
        // again can't apply the same relative delta a second time.
        setDeltas({});
        toast.error('Stock was adjusted, but the history entry could not be saved.');
      } else {
        // The callable explains itself — missing inventory.edit, SKUs that
        // vanished while the page was open, a SKU that would go below zero.
        // A blanket "could not save" threw all of that away. `not-found` here
        // is the batch-rejected message, not a generic missing doc, so keep it.
        const err = e as { code?: string; message?: string };
        toast.error(
          err.code?.includes('not-found') && err.message ? err.message : cfError(e, 'save adjustments'),
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-7 py-6">
      <div className="mb-5 flex items-start justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Adjust stock</h1>
        <div className="flex gap-2.5">
          <Button variant="outline" className="h-[42px]" onClick={() => navigate('/inventory')}>Cancel</Button>
          <Button
            variant="primary"
            className="h-[42px]"
            loading={saving}
            disabled={!canAdjust}
            title={canAdjust ? undefined : noPermissionTitle('inventory', 'edit')}
            onClick={onSave}
          >
            Save adjustments{changedCount > 0 ? ` (${changedCount})` : ''}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-5">
        {/* Table */}
        <div className="overflow-hidden rounded-md border border-border-subtle bg-surface-card">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Product', 'SKU', 'In stock', 'Adjust', 'New'].map((h, i) => (
                  <th key={i} className={cn('whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary', i >= 2 ? 'text-center' : 'text-left')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">Loading…</td></tr>
              ) : (
                rows.map((r) => {
                  const delta = deltas[r.key] ?? 0;
                  const next = r.stock + delta;
                  return (
                    <tr key={r.key} className="hover:bg-surface-app">
                      <td className="border-b border-border-subtle px-4 py-2.5">
                        <div className="font-ui text-[13px] font-bold text-text-primary">{r.productName}</div>
                        {r.variantLabel !== '—' && <div className="font-ui text-[11px] text-text-tertiary">{r.variantLabel}</div>}
                      </td>
                      <td className="whitespace-nowrap border-b border-border-subtle px-4 py-2.5 font-ui text-[12px] font-medium text-text-secondary">{r.sku}</td>
                      <td className="border-b border-border-subtle px-4 py-2.5 text-center font-ui text-[13px] font-medium text-text-secondary">{r.stock}</td>
                      <td className="border-b border-border-subtle px-4 py-2.5">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => bump(r.key, r.stock, -1)} className="grid h-7 w-7 place-items-center rounded-sm border border-border-default text-text-secondary hover:bg-surface-app">
                            <RiSubtractLine size={15} />
                          </button>
                          <span className={cn('w-9 text-center font-display text-[13px] font-bold', delta > 0 ? 'text-success' : delta < 0 ? 'text-error' : 'text-text-tertiary')}>
                            {delta > 0 ? `+${delta}` : delta}
                          </span>
                          <button onClick={() => bump(r.key, r.stock, 1)} className="grid h-7 w-7 place-items-center rounded-sm border border-border-default text-text-secondary hover:bg-surface-app">
                            <RiAddLine size={15} />
                          </button>
                        </div>
                      </td>
                      <td className={cn('border-b border-border-subtle px-4 py-2.5 text-center font-display text-[13px] font-bold', delta !== 0 ? 'text-text-primary' : 'text-text-tertiary')}>{next}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Metadata */}
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-border-subtle bg-surface-card p-5">
            <div className="mb-3.5 font-display text-sm font-bold text-text-primary">Adjustment</div>
            <Select
              label="Reason"
              required
              error={reasonErr}
              value={reason}
              placeholder="Select a reason…"
              onChange={(v) => {
                setReason(v);
                setReasonErr(undefined);
              }}
              options={REASONS.map((r) => ({ value: r, label: r }))}
            />
            <label className="mt-3.5 flex flex-col gap-1.5">
              <span className="font-ui text-xs font-bold text-text-primary">Reference / note</span>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. GRN-4821"
                className="w-full rounded-sm border border-border-default bg-surface-card px-3.5 py-2.5 font-ui text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none"
              />
            </label>
            <p className="mt-3 font-ui text-[11px] leading-snug text-text-tertiary">
              Use − / + to change each SKU's count. Adjustments apply together when you save.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
