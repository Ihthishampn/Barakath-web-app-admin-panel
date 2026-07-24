import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { RiEyeLine, RiEyeOffLine, RiDeleteBinLine, RiCloseLine } from '@remixicon/react';
import type { SubCategory } from '@barkath/shared';
import { Badge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import { countSubCategoryProducts, slugify, updateSubCategories, useCategories } from '../api/categories';

const inputCls =
  'w-72 rounded-sm border border-border-default bg-surface-card px-3.5 py-2.5 font-ui text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none';

export function SubCategoriesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: categories, loading } = useCategories();
  const category = categories.find((c) => c.id === id) ?? null;
  const [input, setInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<SubCategory | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [countsFailed, setCountsFailed] = useState(false);

  // Live product counts per sub-category, the same aggregation the delete guard
  // uses. The stored SubCategory.productCount is written 0 at creation and never
  // maintained by anything, so the column used to contradict the guard sitting
  // next to it ("Oud has 12 products — reassign them first").
  const subIdsKey = (category?.subCategories ?? []).map((s) => s.id).join(',');
  useEffect(() => {
    if (!id || !subIdsKey) return;
    const ids = subIdsKey.split(',');
    let cancelled = false;
    (async () => {
      try {
        const entries = await Promise.all(
          ids.map(async (subId) => [subId, await countSubCategoryProducts(id, subId)] as const),
        );
        if (!cancelled) {
          setCounts(Object.fromEntries(entries));
          setCountsFailed(false);
        }
      } catch {
        if (!cancelled) setCountsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, subIdsKey]);

  // Only block on the very first load (no cached categories yet).
  if (loading && !category) {
    return <div className="grid place-items-center py-24"><Spinner className="h-7 w-7 text-brand-primary" /></div>;
  }
  if (!category) {
    return <div className="px-7 py-6"><p className="font-ui text-sm text-text-tertiary">Category not found.</p></div>;
  }

  const subs = category.subCategories ?? [];
  const save = (next: SubCategory[]) => updateSubCategories(category.id, next);

  const add = async () => {
    const label = input.trim();
    if (!label) return;
    const slug = slugify(label);
    // A name with no Latin letters or digits slugifies to '' and is stored
    // silently (no doc path is involved); the product form then offers a
    // sub-category whose value is '' and refuses to save against it.
    if (!slug) return toast.error('Use at least one Latin letter or digit in the sub-category name.');
    if (subs.some((s) => s.slug === slug)) return toast.info('That sub-category already exists.');
    try {
      await save([...subs, { id: slug, slug, name: label, order: subs.length, visibility: 'visible', productCount: 0 }]);
      setInput('');
      toast.success(`${label} added`);
    } catch {
      toast.error(`Could not add ${label}.`);
    }
  };

  const toggle = async (s: SubCategory) => {
    try {
      await save(subs.map((x) => (x.id === s.id ? { ...x, visibility: x.visibility === 'visible' ? 'hidden' : 'visible' } : x)));
    } catch {
      toast.error(`Could not update ${s.name}.`);
    }
  };

  // Deleting a sub-category strands its products outside every storefront
  // query, so refuse while any are still attached (same guard as categories).
  const askDelete = async (s: SubCategory) => {
    // A failed count is not an all-clear. It also cannot be allowed to reject
    // unhandled: this is called from a bare `void askDelete(s)` click, so the
    // Delete button silently did nothing when the aggregation query failed.
    let n: number;
    try {
      n = await countSubCategoryProducts(category.id, s.id);
    } catch {
      toast.error(`Could not check ${s.name} for attached products. Please retry.`);
      return;
    }
    if (n > 0) {
      toast.error(`${s.name} has ${n} product${n > 1 ? 's' : ''} — reassign them first.`);
      return;
    }
    setToDelete(s);
  };

  const remove = async () => {
    if (!toDelete) return;
    try {
      await save(subs.filter((x) => x.id !== toDelete.id));
      toast.success(`${toDelete.name} removed`);
      setToDelete(null);
    } catch {
      toast.error(`Could not remove ${toDelete.name}.`);
    }
  };

  return (
    <div className="px-7 py-6">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
            {category.name} · sub-categories
          </h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">{subs.length} sub-categories</p>
        </div>
        <Button variant="primary" className="h-[42px]" onClick={() => setAdding(true)}>
          + Add sub-category
        </Button>
      </div>

      {/* Inline add — appears only when adding (no persistent search-like field) */}
      {adding && (
        <div className="mb-4 flex items-center gap-2.5">
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void add())}
            placeholder="New sub-category name…"
            className={inputCls}
          />
          <Button variant="primary" className="h-[42px]" onClick={() => void add()}>
            Add
          </Button>
          <Button variant="outline" className="h-[42px]" onClick={() => { setAdding(false); setInput(''); }}>
            Cancel
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border-subtle bg-surface-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Sub-category', 'Slug', 'Products', 'Status', ''].map((h, i) => (
                <th key={i} className="whitespace-nowrap border-b border-border-subtle px-4 py-3 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {subs.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">No sub-categories yet.</td></tr>
            ) : (
              subs.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-bold text-text-primary">{s.name}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{s.slug}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{counts[s.id] ?? (countsFailed ? '—' : s.productCount ?? 0)}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                    <Badge tone={s.visibility === 'visible' ? 'success' : 'neutral'}>{s.visibility === 'visible' ? 'Visible' : 'Hidden'}</Badge>
                  </td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                    <span className="inline-flex items-center gap-3">
                      <button onClick={() => void askDelete(s)} className="text-error hover:opacity-70" aria-label="Delete"><RiCloseLine size={18} /></button>
                      <DropdownMenu
                        items={[
                          s.visibility === 'visible'
                            ? { label: 'Hide', icon: <RiEyeOffLine size={15} />, onClick: () => void toggle(s) }
                            : { label: 'Show', icon: <RiEyeLine size={15} />, onClick: () => void toggle(s) },
                          { label: 'Delete', icon: <RiDeleteBinLine size={15} />, danger: true, onClick: () => void askDelete(s) },
                        ]}
                      />
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <button onClick={() => navigate('/categories')} className="font-ui text-[13px] font-semibold text-brand-primary hover:underline">
          ‹ Back to categories
        </button>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        variant="danger"
        title="Delete this sub-category?"
        body={<><strong className="text-text-primary">{toDelete?.name}</strong> will be removed from {category.name}.</>}
        confirmLabel="Delete"
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
