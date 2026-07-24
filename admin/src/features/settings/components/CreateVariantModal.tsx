import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { Modal } from './Modal';
import { inputCls } from './fields';
import { unitId } from '../api/variables';

export type VariantKind = 'direct' | 'group';

/**
 * Create a new variant: a Colour "direct-units" variant, or a "group" variant
 * whose units live inside it. Emits the chosen kind + name; the caller creates
 * the doc entry and opens the Add-units flow ("Create & add units").
 */
export function CreateVariantModal({
  existingIds,
  defaultKind = 'group',
  onCancel,
  onCreate,
}: {
  existingIds: Set<string>;
  defaultKind?: VariantKind;
  onCancel: () => void;
  onCreate: (kind: VariantKind, name: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<VariantKind>(defaultKind);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const label = name.trim();
    if (!label) {
      toast.error('Enter a variant name.');
      return;
    }
    const id = unitId(label);
    // The id is derived from the name, so a name with no Latin letters or digits
    // yields '' — the entry would be saved with an empty id that nothing can
    // reference (and a second such name would collide with it).
    if (!id) {
      toast.error('Use at least one Latin letter or digit in the name.');
      return;
    }
    if (existingIds.has(id)) {
      toast.error('A variant with that name already exists.');
      return;
    }
    try {
      setBusy(true);
      await onCreate(kind, label);
    } finally {
      setBusy(false);
    }
  };

  const TypeCard = ({ value, label }: { value: VariantKind; label: string }) => (
    <button
      type="button"
      onClick={() => setKind(value)}
      className={cn(
        'flex-1 rounded-[10px] p-3.5 text-center font-ui text-[13px] font-bold transition-colors',
        kind === value
          ? 'border-2 border-brand-primary bg-brand-primary-subtle text-brand-primary'
          : 'border border-border-default bg-transparent text-text-secondary hover:border-brand-primary',
      )}
    >
      {label}
    </button>
  );

  return (
    <Modal
      open
      busy={busy}
      title="Create variant"
      onClose={onCancel}
      footer={
        <>
          <Button variant="outline" className="h-[42px]" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" className="h-[42px]" loading={busy} onClick={submit}>
            Create & add units
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-2.5 font-ui text-[13px] font-bold text-text-primary">Variant type</div>
          <div className="flex gap-2.5">
            <TypeCard value="direct" label="Color (direct units)" />
            <TypeCard value="group" label="Group (units inside)" />
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="font-ui text-xs font-bold text-text-primary">
            Variant / group name<span className="text-error"> *</span>
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
            placeholder={kind === 'direct' ? 'Color' : 'Size'}
            className={inputCls}
          />
        </label>
        <p className="font-ui text-xs leading-[1.5] text-text-tertiary">
          Colour variants take units directly (Green, Blue). Group variants (Size, Material) hold
          units inside the group — add them next.
        </p>
      </div>
    </Modal>
  );
}
