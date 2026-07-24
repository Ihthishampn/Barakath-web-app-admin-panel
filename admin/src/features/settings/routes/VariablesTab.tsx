import { useState } from 'react';
import { toast } from 'sonner';
import { RiAddLine, RiCloseLine } from '@remixicon/react';
import type {
  ColorUnit,
  DirectUnitsVariable,
  GroupVariable,
  VariableUnit,
} from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { noPermissionTitle, useCanDo } from '@/features/auth/useCan';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import { SettingsShell } from '../components/SettingsShell';
import { CreateVariantModal, type VariantKind } from '../components/CreateVariantModal';
import { AddUnitsModal, type UnitTarget } from '../components/AddUnitsModal';
import {
  countProductsUsingUnit,
  saveVariables,
  unitId,
  useVariables,
} from '../api/variables';

interface DelTarget {
  kind: 'direct' | 'group';
  id: string;
  name: string;
  units: (ColorUnit | VariableUnit)[];
}

export function VariablesTab() {
  const { data, loading: l, error } = useVariables();
  const loading = l && !data;

  const directUnits = data?.directUnits ?? [];
  const groups = data?.groups ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<VariantKind>('group');
  const [unitsTarget, setUnitsTarget] = useState<UnitTarget | null>(null);
  const [delTarget, setDelTarget] = useState<DelTarget | null>(null);
  // Variants persist through saveVariables → settings/variables, gated on
  // canWrite('settings'). Delete goes through the same doc write, so `edit`
  // covers removing a variant too.
  const canEdit = useCanDo('settings', 'edit');

  const existingIds = new Set<string>([
    ...directUnits.map((d) => d.id),
    ...groups.map((g) => g.id),
  ]);

  const openCreate = (kind: VariantKind) => {
    setCreateKind(kind);
    setCreateOpen(true);
  };

  // Create a new variant, persist the empty entry, then open its Add-units flow.
  const onCreate = async (kind: VariantKind, name: string) => {
    const id = unitId(name);
    let nextDirect = directUnits;
    let nextGroups = groups;
    if (kind === 'direct') {
      const v: DirectUnitsVariable = { id, name, order: directUnits.length, units: [] };
      nextDirect = [...directUnits, v];
    } else {
      const g: GroupVariable = { id, name, enabled: true, order: groups.length, units: [] };
      nextGroups = [...groups, g];
    }
    try {
      await saveVariables({ directUnits: nextDirect, groups: nextGroups });
      setCreateOpen(false);
      setUnitsTarget({ kind, id, name, units: [] });
    } catch {
      toast.error('Could not create the variant.');
    }
  };

  // Persist units for the currently-targeted variant/group.
  const onSaveUnits = async (units: (ColorUnit | VariableUnit)[]) => {
    if (!unitsTarget) return;
    const { kind, id } = unitsTarget;
    try {
      if (kind === 'direct') {
        await saveVariables({
          directUnits: directUnits.map((d) =>
            d.id === id ? { ...d, units: units as ColorUnit[] } : d,
          ),
          groups,
        });
      } else {
        await saveVariables({
          directUnits,
          groups: groups.map((g) => (g.id === id ? { ...g, units } : g)),
        });
      }
      setUnitsTarget(null);
      toast.success('Units saved');
    } catch {
      toast.error('Could not save units.');
    }
  };

  // Delete a single direct-units (colour) chip, guarded by delete-safety.
  const removeDirectUnit = async (variableId: string, uid: string) => {
    try {
      const inUse = await countProductsUsingUnit(uid);
      if (inUse > 0) {
        toast.error(`In use by ${inUse} product${inUse === 1 ? '' : 's'} — cannot remove.`);
        return;
      }
      await saveVariables({
        directUnits: directUnits.map((d) =>
          d.id === variableId ? { ...d, units: d.units.filter((u) => u.id !== uid) } : d,
        ),
        groups,
      });
    } catch {
      toast.error('Could not remove the unit.');
    }
  };

  // Delete an entire variant/group after confirming no unit is in use.
  const confirmDelete = async () => {
    if (!delTarget) return;
    for (const u of delTarget.units) {
      const inUse = await countProductsUsingUnit(u.id);
      if (inUse > 0) {
        toast.error(`“${u.name}” is used by ${inUse} product${inUse === 1 ? '' : 's'} — remove it first.`);
        return; // leave the dialog open; nothing deleted
      }
    }
    if (delTarget.kind === 'direct') {
      await saveVariables({ directUnits: directUnits.filter((d) => d.id !== delTarget.id), groups });
    } else {
      await saveVariables({ directUnits, groups: groups.filter((g) => g.id !== delTarget.id) });
    }
    setDelTarget(null);
    toast.success('Removed');
  };

  const action = (
    <Button
      variant="primary"
      className="h-[42px]"
      disabled={!canEdit}
      title={canEdit ? undefined : noPermissionTitle('settings', 'edit')}
      onClick={() => openCreate('group')}
    >
      <RiAddLine size={16} /> Create variant
    </Button>
  );

  const chip = (label: string, hex: string | undefined, onDel: () => void) => (
    <span className="inline-flex items-center gap-1.5 rounded-[7px] border border-border-subtle bg-surface-app px-2.5 py-1.5 font-ui text-xs font-semibold text-text-primary">
      {hex && <span className="h-3 w-3 rounded border border-border-default" style={{ background: hex }} />}
      {label}
      <button type="button" onClick={onDel} className="text-text-tertiary hover:text-error" aria-label={`Remove ${label}`}>
        <RiCloseLine size={13} />
      </button>
    </span>
  );

  return (
    <SettingsShell active="variables" subtitle="Business, tax, gateway & variables" action={action}>
      {loading ? (
        <div className="grid place-items-center py-24">
          <Spinner className="h-7 w-7 text-brand-primary" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-border-subtle bg-surface-card p-8 text-center font-ui text-sm text-text-tertiary">
          Couldn’t load variables. Please refresh.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Direct-units (colour) variants */}
          {directUnits.length === 0 && (
            <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
              <div className="mb-1 font-display text-[15px] font-bold text-text-primary">Direct-unit variants</div>
              <div className="mb-4 font-ui text-xs text-text-tertiary">
                Colour-style variants take units directly. None yet.
              </div>
              <Button variant="outline" size="sm" disabled={!canEdit} title={canEdit ? undefined : noPermissionTitle('settings', 'edit')} onClick={() => openCreate('direct')}>
                <RiAddLine size={15} /> Add colour variant
              </Button>
            </div>
          )}
          {directUnits.map((d) => (
            <div key={d.id} className="rounded-xl border border-border-subtle bg-surface-card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="font-display text-[15px] font-bold text-text-primary">{d.name}</div>
                  <div className="mt-1 font-ui text-xs text-text-tertiary">Direct units (no group)</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canEdit}
                    title={canEdit ? undefined : noPermissionTitle('settings', 'edit')}
                    onClick={() => setUnitsTarget({ kind: 'direct', id: d.id, name: d.name, units: d.units })}
                  >
                    <RiAddLine size={15} /> Add unit
                  </Button>
                  <button
                    type="button"
                    onClick={() => setDelTarget({ kind: 'direct', id: d.id, name: d.name, units: d.units })}
                    disabled={!canEdit}
                    title={canEdit ? undefined : noPermissionTitle('settings', 'edit')}
                    className="text-error hover:opacity-80 disabled:opacity-40"
                    aria-label={`Delete ${d.name}`}
                  >
                    <RiCloseLine size={16} />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {d.units.length === 0 && <span className="font-ui text-xs text-text-tertiary">No units yet.</span>}
                {d.units.map((u) => chip(u.name, u.hex, () => void removeDirectUnit(d.id, u.id)))}
              </div>
            </div>
          ))}

          {/* Variant groups */}
          <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-display text-[15px] font-bold text-text-primary">Variant groups</div>
                <div className="mt-1 font-ui text-xs text-text-tertiary">Units live inside a group</div>
              </div>
              <Button variant="outline" size="sm" disabled={!canEdit} title={canEdit ? undefined : noPermissionTitle('settings', 'edit')} onClick={() => openCreate('group')}>
                <RiAddLine size={15} /> Add group
              </Button>
            </div>

            {groups.length === 0 && <span className="font-ui text-xs text-text-tertiary">No groups yet.</span>}
            <div className="flex flex-col gap-3.5">
              {groups.map((g) => (
                <div key={g.id}>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="font-ui text-xs font-bold text-text-secondary">{g.name}</div>
                    <span className="inline-flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setUnitsTarget({ kind: 'group', id: g.id, name: g.name, units: g.units })}
                        disabled={!canEdit}
                        title={canEdit ? undefined : noPermissionTitle('settings', 'edit')}
                        className="font-ui text-[11px] font-bold text-brand-primary hover:opacity-80 disabled:opacity-40"
                      >
                        + Units
                      </button>
                      <button
                        type="button"
                        onClick={() => setDelTarget({ kind: 'group', id: g.id, name: g.name, units: g.units })}
                        disabled={!canEdit}
                        title={canEdit ? undefined : noPermissionTitle('settings', 'edit')}
                        className="text-error hover:opacity-80 disabled:opacity-40"
                        aria-label={`Delete ${g.name}`}
                      >
                        <RiCloseLine size={15} />
                      </button>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {g.units.length === 0 && <span className="font-ui text-xs text-text-tertiary">No units yet.</span>}
                    {g.units.map((u) =>
                      chip(u.name, undefined, async () => {
                        try {
                          const inUse = await countProductsUsingUnit(u.id);
                          if (inUse > 0) {
                            toast.error(`In use by ${inUse} product${inUse === 1 ? '' : 's'} — cannot remove.`);
                            return;
                          }
                          await saveVariables({
                            directUnits,
                            groups: groups.map((x) =>
                              x.id === g.id ? { ...x, units: x.units.filter((y) => y.id !== u.id) } : x,
                            ),
                          });
                        } catch {
                          toast.error('Could not remove the unit.');
                        }
                      }),
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <CreateVariantModal
          existingIds={existingIds}
          defaultKind={createKind}
          onCancel={() => setCreateOpen(false)}
          onCreate={onCreate}
        />
      )}
      {unitsTarget && (
        <AddUnitsModal target={unitsTarget} onCancel={() => setUnitsTarget(null)} onSave={onSaveUnits} />
      )}
      <ConfirmDialog
        open={!!delTarget}
        title={`Delete ${delTarget?.name ?? ''}?`}
        body="This removes the variant and its units. Units in use by a product are protected."
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => setDelTarget(null)}
        onConfirm={confirmDelete}
      />
    </SettingsShell>
  );
}
