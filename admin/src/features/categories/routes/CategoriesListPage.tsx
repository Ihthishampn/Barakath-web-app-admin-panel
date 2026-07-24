import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { RiEditLine, RiEyeLine, RiEyeOffLine, RiListUnordered, RiDeleteBinLine, RiCloseLine } from '@remixicon/react';
import type { Category } from '@barkath/shared';
import { Badge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { noPermissionTitle, useCan } from '@/features/auth/useCan';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { matchesSearch } from '@/lib/search';
import { useSearchStore } from '@/stores/searchStore';
import {
  countCategoryProducts,
  deleteCategory,
  setCategoryVisibility,
  useCategories,
} from '../api/categories';

export function CategoriesListPage() {
  const navigate = useNavigate();
  const { data: categories, loading } = useCategories();
  const { query } = useSearchStore();
  const [toDelete, setToDelete] = useState<Category | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [countsFailed, setCountsFailed] = useState(false);
  // firestore.rules gates every categories write on `canWrite('categories')`
  // with the matching action; a view-only sub-admin should not be shown a
  // control whose only outcome is a permission-denied toast.
  const can = useCan();
  const canCreate = can('categories', 'create');
  const canEdit = can('categories', 'edit');
  const canDelete = can('categories', 'delete');

  const rows = query.trim()
    ? categories.filter((c) => matchesSearch(query, [c.name, c.slug]))
    : categories;

  // Live product counts via aggregation (no denormalization trigger needed).
  // Keyed on the id list, not on `categories`: the live snapshot hands back a
  // brand-new array on every write to any category, which re-ran one aggregation
  // query per category each time a category was hidden, renamed or deleted.
  const idsKey = categories.map((c) => c.id).join(',');
  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : [];
    let cancelled = false;
    (async () => {
      try {
        const entries = await Promise.all(
          ids.map(async (id) => [id, await countCategoryProducts(id)] as const),
        );
        if (!cancelled) {
          setCounts(Object.fromEntries(entries));
          setCountsFailed(false);
        }
      } catch {
        // Swallowing this showed a hard 0 in the Products column (the stored
        // productCount is never maintained), which contradicts the delete guard.
        if (!cancelled) setCountsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  const subTotal = categories.reduce((n, c) => n + (c.subCategories?.length ?? 0), 0);

  const subsPreview = (c: Category) => {
    const names = (c.subCategories ?? []).map((s) => s.name);
    const head = names.slice(0, 4).join(' · ');
    return names.length > 4 ? `${head} · +${names.length - 4} more` : head || '—';
  };

  const askDelete = async (c: Category) => {
    // The count is the delete-safety guard, so a failed count must NOT be read
    // as "no products attached" — and it must not reject unhandled either: this
    // runs from a bare `void askDelete(c)` click with no dialog to catch it, so
    // the button simply did nothing at all when the aggregation query failed
    // (offline, or the aggregate rejected). Say so and refuse, exactly as
    // CategoryFormPage's sub-category guard already does.
    let n: number;
    try {
      n = await countCategoryProducts(c.id);
    } catch {
      toast.error(`Could not check ${c.name} for attached products. Please retry.`);
      return;
    }
    if (n > 0) {
      toast.error(`${c.name} has ${n} product${n > 1 ? 's' : ''} — reassign them first.`);
      return;
    }
    setToDelete(c);
  };

  const onDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteCategory(toDelete.id);
      toast.success(`${toDelete.name} deleted`);
      setToDelete(null);
    } catch {
      toast.error(`Could not delete ${toDelete.name}.`);
    }
  };

  const toggleVis = async (c: Category) => {
    const next = c.visibility === 'visible' ? 'hidden' : 'visible';
    try {
      await setCategoryVisibility(c.id, next);
      toast.success(`${c.name} ${next === 'visible' ? 'shown' : 'hidden'}`);
    } catch {
      toast.error(`Could not update ${c.name}.`);
    }
  };

  return (
    <div className="px-7 py-6">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Categories</h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">
            {categories.length} top-level · {subTotal} sub-categories
          </p>
        </div>
        <Button
          variant="primary"
          className="h-[42px]"
          disabled={!canCreate}
          title={canCreate ? undefined : noPermissionTitle('categories', 'create')}
          onClick={() => navigate('/categories/new')}
        >
          + Add category
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-border-subtle bg-surface-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Category', 'Sub-categories', 'Products', 'Visibility', ''].map((h, i) => (
                <th key={i} className="whitespace-nowrap border-b border-border-subtle px-4 py-3 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && categories.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">{categories.length === 0 ? 'No categories yet.' : `No categories match “${query}”.`}</td></tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} onClick={() => navigate(`/categories/${c.id}/sub`)} className="cursor-pointer transition-colors hover:bg-surface-app">
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                    <span className="inline-flex items-center gap-2.5">
                      <span className="grid h-[34px] w-[34px] flex-none place-items-center overflow-hidden rounded-[7px]" style={{ background: c.categoryTint }}>
                        {c.iconUrl && <img src={c.iconUrl} alt="" className="max-h-full max-w-full object-contain" />}
                      </span>
                      <span className="font-ui text-[13px] font-bold text-text-primary">{c.name}</span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{subsPreview(c)}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{counts[c.id] ?? (countsFailed ? '—' : c.productCount ?? 0)}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                    <Badge tone={c.visibility === 'visible' ? 'success' : 'neutral'}>{c.visibility === 'visible' ? 'Visible' : 'Hidden'}</Badge>
                  </td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                    <span className="inline-flex items-center gap-3">
                      <button onClick={(e) => { e.stopPropagation(); void askDelete(c); }} disabled={!canDelete} title={canDelete ? undefined : noPermissionTitle('categories', 'delete')} className="text-error hover:opacity-70 disabled:opacity-40" aria-label="Delete">
                        <RiCloseLine size={18} />
                      </button>
                      <DropdownMenu
                        items={[
                          { label: 'Edit', icon: <RiEditLine size={15} />, disabled: !canEdit, onClick: () => navigate(`/categories/${c.id}`) },
                          { label: 'View sub-categories', icon: <RiListUnordered size={15} />, onClick: () => navigate(`/categories/${c.id}/sub`) },
                          c.visibility === 'visible'
                            ? { label: 'Hide', icon: <RiEyeOffLine size={15} />, disabled: !canEdit, onClick: () => void toggleVis(c) }
                            : { label: 'Show', icon: <RiEyeLine size={15} />, disabled: !canEdit, onClick: () => void toggleVis(c) },
                          { label: 'Delete', icon: <RiDeleteBinLine size={15} />, danger: true, disabled: !canDelete, onClick: () => void askDelete(c) },
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

      <ConfirmDialog
        open={!!toDelete}
        variant="danger"
        title="Delete this category?"
        body={
          <>
            <strong className="text-text-primary">{toDelete?.name}</strong> and its{' '}
            {toDelete?.subCategories?.length ?? 0} sub-categories will be removed. This cannot be undone.
          </>
        }
        confirmLabel="Delete category"
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
