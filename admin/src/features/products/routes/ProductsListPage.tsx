import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  RiSearchLine,
  RiFilterLine,
  RiEyeLine,
  RiEditLine,
  RiFileCopyLine,
  RiArchiveLine,
  RiInboxUnarchiveLine,
  RiDeleteBinLine,
} from '@remixicon/react';
import { formatMoney2dp, type Product } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/StatusBadge';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cfError } from '@/lib/cfError';
import { exportCsv } from '@/lib/exportCsv';
import { cap } from '@/lib/format';
import { matchesSearch } from '@/lib/search';
import { useSearchStore } from '@/stores/searchStore';
import { noPermissionTitle, useCan } from '@/features/auth/useCan';
import {
  deleteProduct,
  deriveProductStatus,
  duplicateProduct,
  setProductArchived,
  totalStock,
  useProductsList,
  type ProductBadgeTone,
} from '../api/products';
import { ProductImportModal } from '../components/ProductImportModal';

// Smaller than the global 25 so the seed spans multiple pages and the table
// stays above the fold (pagination visible without scrolling).
const PRODUCTS_PAGE_SIZE = 8;

const BADGE_TONE: Record<ProductBadgeTone, Parameters<typeof Badge>[0]['tone']> = {
  success: 'success',
  gold: 'gold',
  error: 'error',
  neutral: 'neutral',
};

export function ProductsListPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: products, loading } = useProductsList();
  const { query, setQuery } = useSearchStore();
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);
  // firestore.rules gates products writes on these exact permissions. Offering
  // the control anyway only moves the refusal from "the button is off" to a red
  // toast after the write was already attempted.
  const can = useCan();
  const canCreate = can('products', 'create');
  const canEdit = can('products', 'edit');
  const canDelete = can('products', 'delete');

  const activeFilters = ['category', 'sub', 'stock', 'status', 'flash', 'min', 'max'].filter((k) => params.get(k));
  const filterCount = ['category', 'sub', 'stock', 'status', 'flash'].filter((k) => params.get(k)).length +
    (params.get('min') || params.get('max') ? 1 : 0);

  const filtered = useMemo(() => {
    const category = params.get('category');
    const sub = params.get('sub');
    const stock = params.get('stock');
    const status = params.get('status');
    const flash = params.get('flash');
    const min = params.get('min') ? Number(params.get('min')) : null;
    const max = params.get('max') ? Number(params.get('max')) : null;

    return products.filter((p) => {
      if (query.trim()) {
        const sku = p.hasVariants ? p.variants.map((v) => v.sku).join(' ') : p.id;
        if (!matchesSearch(query, [p.name, sku, p.categorySlug], p.searchIndex)) return false;
      }
      if (category && p.categorySlug !== category) return false;
      if (sub && p.subCategoryId !== sub) return false;
      if (status === 'active' && p.status === 'archived') return false;
      if (status === 'archived' && p.status !== 'archived') return false;
      if (stock) {
        const s = totalStock(p);
        const lim = p.lowStockThreshold || 5;
        if (stock === 'in' && !(s > lim)) return false;
        if (stock === 'low' && !(s > 0 && s <= lim)) return false;
        if (stock === 'out' && s !== 0) return false;
      }
      // Flash sale = the product's opt-in flag (mirrors the storefront rail).
      if (flash === 'yes' && !p.isFlashSale) return false;
      const rupees = p.offerPricePaise / 100;
      if (min != null && rupees < min) return false;
      if (max != null && rupees > max) return false;
      return true;
    });
  }, [products, query, params]);

  const catCount = new Set(products.map((p) => p.categoryId)).size;
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * PRODUCTS_PAGE_SIZE;
  const rows = filtered.slice(start, start + PRODUCTS_PAGE_SIZE);

  const onExport = () => {
    if (products.length === 0) return toast.info('Nothing to export.');
    exportCsv(
      'barkath-products.csv',
      products.map((p) => ({
        Product: p.name,
        SKU: p.hasVariants ? p.variants.map((v) => v.sku).join(' | ') : p.id,
        Category: cap(p.categorySlug),
        SubCategory: cap(p.subCategoryId),
        PricePaise: p.offerPricePaise,
        Stock: totalStock(p),
        Status: deriveProductStatus(p).label,
      })),
    );
    toast.success('Exported products.csv');
  };

  // These writes are rules-gated on the products module, so a sub-admin without
  // create/edit/delete gets `permission-denied` here. Reporting it as a flat
  // "could not …" read like a bug — cfError names the real reason (as every
  // other mutating screen in the panel already does).
  const onArchive = async (p: Product) => {
    const archived = p.status === 'archived';
    try {
      await setProductArchived(p.id, !archived);
      toast.success(archived ? `${p.name} restored` : `${p.name} archived`);
    } catch (e) {
      toast.error(cfError(e, archived ? `restore ${p.name}` : `archive ${p.name}`));
    }
  };

  const onDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteProduct(toDelete.id);
      toast.success(`${toDelete.name} deleted`);
      setToDelete(null);
    } catch (e) {
      toast.error(cfError(e, `delete ${toDelete.name}`));
    }
  };

  const onDuplicate = async (p: Product) => {
    try {
      const newId = await duplicateProduct(p.id);
      toast.success(`Duplicated “${p.name}” — opening the copy`);
      navigate(`/products/${newId}`);
    } catch (e) {
      toast.error(cfError(e, 'duplicate the product'));
    }
  };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
            Products
          </h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">
            {products.length} products · {catCount} categories
          </p>
        </div>
        <div className="flex gap-2.5">
          <Button
            variant="outline"
            className="h-[42px]"
            disabled={!canCreate}
            title={canCreate ? undefined : noPermissionTitle('products', 'create')}
            onClick={() => setImporting(true)}
          >
            Import
          </Button>
          <Button
            variant="primary"
            className="h-[42px]"
            disabled={!canCreate}
            title={canCreate ? undefined : noPermissionTitle('products', 'create')}
            onClick={() => navigate('/products/new')}
          >
            + Add product
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex w-[280px] items-center gap-2.5 rounded-sm border border-border-default bg-surface-card px-3 py-2">
          <RiSearchLine size={16} className="text-text-tertiary" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search…"
            className="w-full bg-transparent font-ui text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
        </div>
        <button
          onClick={() => navigate(`/products/filter${params.toString() ? `?${params}` : ''}`)}
          className="flex items-center gap-1.5 rounded-sm border border-border-default px-3 py-2.5 font-ui text-xs font-bold text-text-primary hover:bg-surface-app"
        >
          <RiFilterLine size={15} />
          Filters
          {filterCount > 0 && (
            <span className="grid h-[18px] min-w-[18px] place-items-center rounded-pill bg-brand-primary px-1 font-ui text-[10px] font-bold text-white">
              {filterCount}
            </span>
          )}
        </button>
        {activeFilters.length > 0 && (
          <button
            onClick={() => navigate('/products')}
            className="font-ui text-xs font-semibold text-brand-primary hover:underline"
          >
            Clear
          </button>
        )}
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={onExport}>
            Export
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-md border border-border-subtle bg-surface-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Product', 'SKU', 'Category', 'Sub-category', 'Price', 'Stock', 'Status', ''].map((h, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap border-b border-border-subtle px-4 py-3 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && products.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">
                  {query ? `No products match “${query}”.` : 'No products yet.'}
                </td>
              </tr>
            ) : (
              rows.map((p) => {
                const st = deriveProductStatus(p);
                const sku = p.hasVariants ? (p.variants[0]?.sku ?? '—') : p.id;
                return (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/products/${p.id}`)}
                    className="cursor-pointer transition-colors hover:bg-surface-app"
                  >
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                      <span className="inline-flex items-center gap-2.5">
                        <span
                          className="h-[34px] w-[34px] flex-none rounded-[7px] bg-cover bg-center"
                          style={{
                            backgroundColor: p.categoryTint,
                            backgroundImage: p.images[0]?.url ? `url(${p.images[0].url})` : undefined,
                          }}
                        />
                        <span className="font-ui text-[13px] font-bold text-text-primary">{p.name}</span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                      {sku}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                      {cap(p.categorySlug)}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                      {cap(p.subCategoryId)}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-bold text-text-primary">
                      {formatMoney2dp(p.offerPricePaise)}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">
                      {totalStock(p)}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                      <Badge tone={BADGE_TONE[st.tone]}>{st.label}</Badge>
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                      <DropdownMenu
                        items={[
                          // View stays open to anyone who reached this screen —
                          // the route guard already proved they hold products.view.
                          { label: 'View', icon: <RiEyeLine size={15} />, onClick: () => navigate(`/products/${p.id}`) },
                          { label: 'Edit', icon: <RiEditLine size={15} />, disabled: !canEdit, onClick: () => navigate(`/products/${p.id}`) },
                          // Duplicate writes a whole new product doc, so it is
                          // create — not edit.
                          { label: 'Duplicate', icon: <RiFileCopyLine size={15} />, disabled: !canCreate, onClick: () => void onDuplicate(p) },
                          p.status === 'archived'
                            ? { label: 'Restore', icon: <RiInboxUnarchiveLine size={15} />, disabled: !canEdit, onClick: () => void onArchive(p) }
                            : { label: 'Archive', icon: <RiArchiveLine size={15} />, disabled: !canEdit, onClick: () => void onArchive(p) },
                          { label: 'Delete', icon: <RiDeleteBinLine size={15} />, danger: true, disabled: !canDelete, onClick: () => setToDelete(p) },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between">
        <span className="font-ui text-xs font-medium text-text-tertiary">
          {total === 0 ? 'No results' : `Showing ${start + 1}–${Math.min(start + PRODUCTS_PAGE_SIZE, total)} of ${total}`}
        </span>
        <div className="flex gap-1.5">
          <PageBtn label="‹" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={current === 1} />
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
            <PageBtn key={n} label={String(n)} active={n === current} onClick={() => setPage(n)} />
          ))}
          <PageBtn label="›" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={current === pageCount} />
        </div>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        variant="danger"
        title="Delete this product?"
        body={
          <>
            <strong className="text-text-primary">{toDelete?.name}</strong> and all its variants will be
            permanently removed. This cannot be undone.
          </>
        }
        confirmLabel="Delete product"
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
      />

      {importing && (
        <ProductImportModal onClose={() => setImporting(false)} onDone={() => setImporting(false)} />
      )}
    </div>
  );
}

function PageBtn({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        'inline-flex h-8 min-w-8 items-center justify-center rounded-[7px] border px-2 font-ui text-xs font-bold disabled:opacity-40 ' +
        (active
          ? 'border-brand-primary bg-brand-primary text-white'
          : 'border-border-subtle bg-surface-card text-text-secondary hover:bg-surface-app')
      }
    >
      {label}
    </button>
  );
}
