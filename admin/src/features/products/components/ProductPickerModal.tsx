import { useState } from 'react';
import { createPortal } from 'react-dom';
import { RiCloseLine, RiSearchLine } from '@remixicon/react';
import { formatMoney2dp, type Product } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

/**
 * Multi-select product picker.
 *
 * Lifted verbatim out of ProductFormPage, where it was a private `AttachModal`
 * used for "Frequently bought together". The coupon form needs exactly the same
 * control for its applicable/excluded product lists, and a second copy would
 * have drifted — so it lives here, in the feature that owns products, and both
 * screens instantiate it. Only the heading and the confirm verb are
 * parameterised; everything else is the original markup, so the two dialogs are
 * pixel-identical.
 */
export function ProductPickerModal({
  products,
  title = 'Attach products',
  confirmVerb = 'Attach',
  onClose,
  onPick,
}: {
  /** Candidates. Callers filter out what is already selected. */
  products: Product[];
  title?: string;
  /** Verb on the confirm button: "Attach 3 products". */
  confirmVerb?: string;
  onClose: () => void;
  onPick: (ids: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const list = products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[80vh] w-full max-w-[520px] flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-card shadow-lg">
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 className="font-display text-base font-bold text-text-primary">{title}</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary">
            <RiCloseLine size={20} />
          </button>
        </div>
        <div className="border-b border-border-subtle p-4">
          <div className="flex items-center gap-2.5 rounded-sm border border-border-default px-3 py-2">
            <RiSearchLine size={16} className="text-text-tertiary" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search products by name…"
              className="w-full bg-transparent font-ui text-[13px] focus:outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {list.map((p) => {
            const on = picked.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() =>
                  setPicked((s) => {
                    const n = new Set(s);
                    n.has(p.id) ? n.delete(p.id) : n.add(p.id);
                    return n;
                  })
                }
                className="flex w-full items-center gap-3 border-b border-border-subtle px-5 py-3 text-left last:border-0 hover:bg-surface-app"
              >
                <span className="h-9 w-9 flex-none rounded-md" style={{ background: p.categoryTint }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-ui text-[13px] font-semibold text-text-primary">{p.name}</div>
                  <div className="font-ui text-xs text-text-tertiary">
                    {p.categorySlug} · {formatMoney2dp(p.offerPricePaise)}
                  </div>
                </div>
                <span
                  className={cn(
                    'grid h-5 w-5 place-items-center rounded border',
                    on ? 'border-brand-primary bg-brand-primary text-white' : 'border-border-default',
                  )}
                >
                  {on && '✓'}
                </span>
              </button>
            );
          })}
          {list.length === 0 && (
            <p className="px-5 py-8 text-center font-ui text-xs text-text-tertiary">No products found.</p>
          )}
        </div>
        <div className="flex justify-end gap-2.5 border-t border-border-subtle p-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={picked.size === 0} onClick={() => onPick([...picked])}>
            {confirmVerb} {picked.size || ''} {picked.size === 1 ? 'product' : 'products'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
