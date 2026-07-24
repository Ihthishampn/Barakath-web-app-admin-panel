import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { RiCloseLine } from '@remixicon/react';
import type { ColorUnit, VariableUnit } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { Modal } from './Modal';
import { inputCls } from './fields';
import {
  countProductsUsingUnit,
  makeColorUnit,
  makeGroupUnit,
  unitId,
} from '../api/variables';
import { isValidHex } from '../api/settings';

export interface UnitTarget {
  kind: 'direct' | 'group';
  id: string;
  name: string;
  units: (ColorUnit | VariableUnit)[];
}

const DEFAULT_HEX = '#8a6d3b';

/**
 * Add / remove units for a variant (direct-units colour variant or a group).
 * Colour targets get a hex swatch per unit; group units are name-only.
 * Removing a unit already referenced by a product is blocked (delete-safety).
 */
export function AddUnitsModal({
  target,
  onCancel,
  onSave,
}: {
  target: UnitTarget;
  onCancel: () => void;
  onSave: (units: (ColorUnit | VariableUnit)[]) => Promise<void>;
}) {
  const isColor = target.kind === 'direct';
  const originalIds = useMemo(() => new Set(target.units.map((u) => u.id)), [target.units]);

  const [units, setUnits] = useState<(ColorUnit | VariableUnit)[]>(target.units);
  const [name, setName] = useState('');
  const [hex, setHex] = useState(DEFAULT_HEX);
  const [saving, setSaving] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const add = () => {
    const label = name.trim();
    if (!label) return;
    const id = unitId(label);
    // The unit id is derived from the name: a name with no Latin letters or
    // digits gives '', which products could never reference.
    if (!id) {
      toast.error('Use at least one Latin letter or digit in the unit name.');
      return;
    }
    if (isColor && !isValidHex(hex)) {
      toast.error('Pick a valid hex colour.');
      return;
    }
    const existing = units.find((u) => u.id === id);
    if (existing) {
      // Re-adding a colour under its own name is the only way to correct a
      // mis-picked swatch: a chip has no edit affordance, and a unit already
      // referenced by a product can't be removed and re-created. The id is
      // name-derived so it stays put and those product attributes keep resolving.
      if (isColor && (existing as ColorUnit).hex !== hex) {
        setUnits((u) => u.map((x) => (x.id === id ? { ...x, name: label, hex } : x)));
        setName('');
        setHex(DEFAULT_HEX);
        toast.success(`${label} swatch updated`);
        return;
      }
      toast.info('That unit already exists.');
      return;
    }
    const next = isColor
      ? makeColorUnit(label, hex, units.length)
      : makeGroupUnit(label, units.length);
    setUnits((u) => [...u, next]);
    setName('');
    setHex(DEFAULT_HEX);
  };

  const remove = async (id: string) => {
    // Newly-added (unsaved) units can be removed freely.
    if (!originalIds.has(id)) {
      setUnits((u) => u.filter((x) => x.id !== id));
      return;
    }
    try {
      setCheckingId(id);
      const inUse = await countProductsUsingUnit(id);
      if (inUse > 0) {
        toast.error(`In use by ${inUse} product${inUse === 1 ? '' : 's'} — cannot remove.`);
        return;
      }
      setUnits((u) => u.filter((x) => x.id !== id));
    } catch {
      toast.error('Could not check where this unit is used.');
    } finally {
      setCheckingId(null);
    }
  };

  const save = async () => {
    try {
      setSaving(true);
      // Re-number order to match current arrangement.
      await onSave(units.map((u, i) => ({ ...u, order: i })));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      busy={saving}
      title={`Add units · ${target.name}`}
      onClose={onCancel}
      footer={
        <>
          <Button variant="outline" className="h-[42px]" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" className="h-[42px]" loading={saving} onClick={save}>
            Save units
          </Button>
        </>
      }
    >
      <div className="mb-1.5 font-ui text-[13px] font-bold text-text-primary">
        {target.kind === 'group' ? `Group: ${target.name}` : target.name}
      </div>
      <div className="mb-4 font-ui text-xs text-text-tertiary">
        Add each unit that belongs to this {target.kind === 'group' ? 'group' : 'variant'}.
      </div>

      <div className="mb-4 flex items-center gap-2.5">
        {isColor && (
          <input
            type="color"
            value={isValidHex(hex) ? hex : DEFAULT_HEX}
            onChange={(e) => setHex(e.target.value)}
            className="h-[42px] w-11 flex-none cursor-pointer rounded-sm border border-border-default bg-surface-card"
            aria-label="Unit colour"
          />
        )}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="New unit name…"
          className={inputCls}
        />
        <Button variant="primary" className="h-[42px]" onClick={add}>
          Add
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {units.length === 0 && (
          <span className="font-ui text-xs text-text-tertiary">No units yet.</span>
        )}
        {units.map((u) => (
          <span
            key={u.id}
            className="inline-flex items-center gap-1.5 rounded-sm border border-border-subtle bg-surface-app px-3 py-2 font-ui text-[13px] font-semibold text-text-primary"
          >
            {'hex' in u && (
              <span
                className="h-3 w-3 rounded border border-border-default"
                style={{ background: (u as ColorUnit).hex }}
              />
            )}
            {u.name}
            <button
              type="button"
              onClick={() => void remove(u.id)}
              disabled={checkingId === u.id}
              className={cn(
                'text-text-tertiary hover:text-error',
                checkingId === u.id && 'opacity-40',
              )}
              aria-label={`Remove ${u.name}`}
            >
              <RiCloseLine size={14} />
            </button>
          </span>
        ))}
      </div>
    </Modal>
  );
}
