import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { RiAddLine, RiCloseLine, RiImageLine, RiRefreshLine, RiErrorWarningLine } from '@remixicon/react';
import { formatMoney2dp, DEFAULT_PRODUCT_COMMISSION_RATE, type Product } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { Spinner } from '@/components/ui/Spinner';
import { cfError } from '@/lib/cfError';
import { cn } from '@/lib/cn';
import { noPermissionTitle, useCan } from '@/features/auth/useCan';
import { useCategories } from '@/features/categories/api/categories';
import { useTax } from '@/features/settings/api/settings';
import { useVariables } from '@/features/settings/api/variables';
import { validatePriceLadder, firstLadderError, type PriceErrors } from '../lib/pricing';
import { ProductPickerModal } from '../components/ProductPickerModal';
import { getCachedList } from '@/hooks/firestoreCache';
import {
  getProduct,
  newProductId,
  PRODUCTS_KEY,
  saveProduct,
  uploadProductImage,
  useProductsList,
  type ProductFormValues,
} from '../api/products';

type Money = number | '';
// `attrs` carries the variant's non-colour/size attributes untouched — the
// attributes map is open, and the form only edits two of its keys.
// Affiliate commission is a single product-level setting (see the Affiliate
// commission control), so it is NOT a per-variant column here any more.
interface VRow { key: string; id?: string; colorId: string; sizeId: string; price: Money; offer: Money; referral: Money; attrs?: Record<string, string> }
interface SRow { key: string; name: string; value: string }

// New arrivals are automatic in the storefront (published within the last few
// days); keep this in step with web/src/lib/catalog.ts NEW_ARRIVAL_DAYS.
const NEW_ARRIVAL_DAYS = 3;

const uid = () => Math.random().toString(36).slice(2, 9);
/** A row that names a variant rather than the product's own single price. */
const isVariantRow = (r: VRow) =>
  !!r.id || !!r.colorId || !!r.sizeId || Object.keys(r.attrs ?? {}).length > 0;
/** A row the user actually touched — anything else is an untouched scratch row. */
const isFilled = (r: VRow) =>
  isVariantRow(r) || r.price !== '' || r.offer !== '' || r.referral !== '';
const toPaise = (r: Money) => (r === '' ? 0 : Math.round(Number(r) * 100));
const toRupees = (p: number | null | undefined): Money => (p == null ? '' : p / 100);

function productToRows(p: Product): VRow[] {
  return p.hasVariants && p.variants.length
    ? p.variants.map((v) => {
        const { color: _c, size: _s, ...attrs } = v.attributes ?? {};
        return {
          key: uid(),
          id: v.id,
          colorId: v.attributes?.color ?? '',
          sizeId: v.attributes?.size ?? '',
          price: toRupees(v.mrpPaise),
          offer: toRupees(v.offerPricePaise),
          referral: toRupees(v.referralPricePaise),
          attrs,
        };
      })
    : [{ key: uid(), colorId: '', sizeId: '', price: toRupees(p.mrpPaise), offer: toRupees(p.offerPricePaise), referral: toRupees(singlePrice(p).referralPricePaise) }];
}
/**
 * Referral price for a product with no variants. Stored on the product doc
 * (saveProduct) because there is no variant to hold it; the shared Product type
 * declares it per-variant only, hence the cast.
 */
const singlePrice = (p: Product) =>
  p as Product & { referralPricePaise?: number | null };

/**
 * The product's affiliate commission as the form edits it: a type
 * (amount|percent) plus the value for the active type. Derived from whichever of
 * `commissionPaise` / `affiliateCommissionRate` is set; a product with neither
 * (or a brand-new one) defaults to the percentage default so the affiliate
 * system always has a value to work from.
 */
function commissionOf(p: Product | null): { type: 'amount' | 'percent'; amount: Money; percent: string } {
  const amt = p?.commissionPaise;
  const rate = p?.affiliateCommissionRate;
  if (rate != null) return { type: 'percent', amount: '', percent: String(Math.round(rate * 1000) / 10) };
  if (amt != null) return { type: 'amount', amount: amt / 100, percent: '' };
  return { type: 'percent', amount: '', percent: String(DEFAULT_PRODUCT_COMMISSION_RATE * 100) };
}
const productToSpecs = (p: Product): SRow[] => p.specifications.map((s) => ({ key: uid(), name: s.key, value: s.value }));

export function ProductFormPage() {
  const { id: routeId } = useParams();
  const isNew = !routeId || routeId === 'new';
  const navigate = useNavigate();

  const { data: categories } = useCategories();
  const { data: variables } = useVariables();
  const { data: allProducts } = useProductsList();
  // settings/tax is readable by any admin (rules gate settings writes, not
  // reads) and only supplies the placeholder + hint for the HSN field below,
  // so a missing doc degrades the hint rather than the form.
  const { data: tax } = useTax();

  // Seed instantly from the products cache so opening an edit/duplicate never
  // blanks the screen; getProduct still runs below to refresh from the server.
  const seed = useState<Product | null>(() =>
    isNew ? null : getCachedList<Product>(PRODUCTS_KEY).find((p) => p.id === routeId) ?? null,
  )[0];

  const [id] = useState(() => (isNew ? newProductId() : routeId!));
  const [loading, setLoading] = useState(!isNew && !seed);
  const [saving, setSaving] = useState(false);
  // The loaded product — used at save time to preserve fields the form doesn't
  // edit (per-variant stock/weight/visibility live in Inventory, not here).
  const existingRef = useRef<Product | null>(seed);

  const [name, setName] = useState(seed?.name ?? '');
  const [categoryId, setCategoryId] = useState(seed?.categoryId ?? '');
  const [subCategoryId, setSubCategoryId] = useState(seed?.subCategoryId ?? '');
  const [description, setDescription] = useState(seed?.description ?? '');
  const [status, setStatus] = useState<Product['status']>(seed?.status ?? 'published');
  const [isBestSeller, setIsBestSeller] = useState(seed?.isBestSeller ?? false);
  const [isFeatured, setIsFeatured] = useState(seed?.isFeatured ?? false);
  const [isFlashSale, setIsFlashSale] = useState(seed?.isFlashSale ?? false);
  const [rows, setRows] = useState<VRow[]>(() => (seed ? productToRows(seed) : []));
  // Product-level affiliate commission — a fixed amount OR a percentage (the two
  // are mutually exclusive). A new product defaults to the percentage default.
  const c0 = commissionOf(seed);
  const [commissionType, setCommissionType] = useState<'amount' | 'percent'>(c0.type);
  const [commissionAmount, setCommissionAmount] = useState<Money>(c0.amount);
  const [commissionPercent, setCommissionPercent] = useState<string>(c0.percent);
  const [specs, setSpecs] = useState<SRow[]>(() => (seed ? productToSpecs(seed) : []));
  const [fbt, setFbt] = useState<string[]>(seed?.fbt ?? []);
  const [images, setImages] = useState<Product['images']>(seed?.images ?? []);
  const [hsnCode, setHsnCode] = useState(seed?.hsnCode ?? '');
  const [imagesUploading, setImagesUploading] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; category?: string; sub?: string; pricing?: string }>({});
  // A view-only sub-admin can reach this form (the route only checks `view`) —
  // let them read the product, but not offer a Save the rules will refuse.
  const can = useCan();
  const canSave = can('products', isNew ? 'create' : 'edit');
  // Flash sale is its own permissioned module (Growth ▸ Flash Sale) — a
  // sub-admin holding only `products` edit must not be able to flip a
  // product into the sale rail out from under whoever actually owns it.
  const canFlashSale = can('flashSale', 'edit');

  // Load / refresh the product from the server for edit.
  useEffect(() => {
    if (isNew) return;
    getProduct(routeId!)
      .then((p) => {
        if (!p) {
          toast.error('Product not found.');
          navigate('/products');
          return;
        }
        existingRef.current = p; // always refresh (used to preserve stock on save)
        // If we seeded from cache, don't clobber the (possibly edited) fields.
        if (!seed) {
          setName(p.name);
          setCategoryId(p.categoryId);
          setSubCategoryId(p.subCategoryId);
          setDescription(p.description);
          setStatus(p.status);
          setIsBestSeller(p.isBestSeller ?? false);
          setIsFeatured(p.isFeatured ?? false);
          setIsFlashSale(p.isFlashSale ?? false);
          setSpecs(productToSpecs(p));
          setFbt(p.fbt ?? []);
          setImages(p.images ?? []);
          setHsnCode(p.hsnCode ?? '');
          setRows(productToRows(p));
          const c = commissionOf(p);
          setCommissionType(c.type);
          setCommissionAmount(c.amount);
          setCommissionPercent(c.percent);
        }
        setLoading(false);
      })
      .catch(() => {
        // Nothing else clears `loading`, so a rejected read (offline, expired
        // token) used to leave the page on its spinner for good. Fail the same
        // way the not-found branch does rather than dropping the admin into a
        // blank form that would save over the product it never loaded.
        if (seed) return; // the cached copy is already on screen — keep editing
        toast.error('Could not load this product.');
        navigate('/products');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, routeId, navigate]);

  const category = categories.find((c) => c.slug === categoryId);
  // What the invoice would print if this field is left blank: the category's
  // entry in settings/tax.hsnCodes, keyed by the same category slug the invoice
  // reads off the order line.
  const categoryHsn = (tax?.hsnCodes ?? {})[categoryId] ?? '';
  const hsnHint = hsnCode
    ? 'Printed on the GST invoice for every line of this product.'
    : categoryHsn
      ? `Blank — the invoice falls back to the ${category?.name ?? categoryId} code ${categoryHsn}.`
      : 'Blank, and this category has no fallback code — the invoice HSN column prints empty.';
  const colorVar = variables?.directUnits.find((d) => d.id === 'color');
  const sizeVar = variables?.groups.find((g) => g.id === 'size');
  const colorOpts = [{ value: '', label: '—' }, ...(colorVar?.units.map((u) => ({ value: u.id, label: u.name })) ?? [])];
  const sizeOpts = [{ value: '', label: '—' }, ...(sizeVar?.units.map((u) => ({ value: u.id, label: u.name })) ?? [])];
  const hexOf = (colorId: string) => colorVar?.units.find((u) => u.id === colorId)?.hex;
  const productById = useMemo(() => new Map(allProducts.map((p) => [p.id, p])), [allProducts]);

  // Live price-ladder validation — one rule, evaluated per row as you type.
  const rowErrors = useMemo<Record<string, PriceErrors>>(
    () => Object.fromEntries(rows.map((r) => [r.key, validatePriceLadder(r)])),
    [rows],
  );
  const liveLadderError = useMemo(() => firstLadderError(rows), [rows]);

  const clearPricing = () => setErrors((x) => ({ ...x, pricing: undefined }));
  const addRow = () => {
    setRows((r) => [...r, { key: uid(), colorId: '', sizeId: '', price: '', offer: '', referral: '' }]);
    clearPricing();
  };
  const updRow = (key: string, patch: Partial<VRow>) => {
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    clearPricing();
  };
  const delRow = (key: string) => setRows((r) => r.filter((x) => x.key !== key));

  const onSave = async () => {
    // Required-field + pricing validation (spec §5.3).
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Product name is required.';
    if (!categoryId) errs.category = 'Category is required.';
    else if (!subCategoryId) errs.sub = 'Sub-category is required.';

    // A row counts as filled if the user typed anything into it at all. Only
    // untouched scratch rows are dropped — everything else must reach the save.
    const filledRows = rows.filter(isFilled);

    if (filledRows.length === 0) {
      errs.pricing = 'Add at least one price row.';
    } else if (filledRows.some((r) => r.price === '' || Number(r.price) <= 0)) {
      errs.pricing = 'Every row needs a Price greater than ₹0.';
    } else {
      // Same ladder rule the cells enforce live (Price ≥ Offer ≥ Referral ≥ Comm).
      const ladder = firstLadderError(filledRows);
      if (ladder) errs.pricing = ladder;
    }

    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error('Please fix the highlighted fields.');
      return;
    }
    if (imagesUploading) {
      toast.info('Please wait for images to finish uploading.');
      return;
    }

    // Filtering on colour/size alone used to drop every variant keyed on some
    // other attribute — `attributes` is an open map — and could write an empty
    // variants array that wiped the whole variant set. Match on identity
    // instead: an existing variant id, or any attribute at all.
    const variantRows = filledRows.filter(isVariantRow);
    const hasVariants = variantRows.length > 0;
    if (!hasVariants && (existingRef.current?.variants.length ?? 0) > 0) {
      toast.error('This product has variants — saving now would delete them all. Keep at least one variant row, or remove the product’s variants from Inventory first.');
      return;
    }
    const baseRow = (hasVariants ? variantRows[0] : filledRows[0])!;
    const codeFor = (units: { id: string; code: string }[] | undefined, id: string) => units?.find((u) => u.id === id)?.code ?? '';
    // No discount entered → the offer (selling) price is just the price.
    const offerOf = (r: VRow): Money => (r.offer === '' ? r.price : r.offer);

    // Product-level affiliate commission — write exactly one of the two fields
    // (the other null) from the Amount|Percent toggle. Percent is stored as a
    // fraction; blank means "no commission configured" (the backfill/default
    // handles legacy products, but a deliberately cleared field is honoured).
    const commissionPaise =
      commissionType === 'amount' && commissionAmount !== '' ? toPaise(commissionAmount) : null;
    const affiliateCommissionRate =
      commissionType === 'percent' && commissionPercent.trim() !== ''
        ? Math.max(0, Math.min(100, Number(commissionPercent))) / 100
        : null;

    // Rating/reviews are NOT set here — they are review-derived and owned by the
    // onReviewWritten trigger (locked against client writes in firestore.rules).
    // A new product starts at the 1.0 / 0 baseline inside saveProduct.
    const values: ProductFormValues = {
      id,
      name: name.trim(),
      categoryId,
      categoryTint: category?.categoryTint ?? '#e6cfb4',
      subCategoryId,
      description,
      status,
      isBestSeller,
      isFeatured,
      isFlashSale,
      images,
      specifications: specs.filter((s) => s.name.trim()).map((s) => ({ id: s.key, key: s.name.trim(), value: s.value.trim() })),
      fbt,
      mrpPaise: toPaise(baseRow.price),
      offerPricePaise: toPaise(offerOf(baseRow)),
      // A single-price row has no variant to carry the referral price, so it
      // goes on the product doc.
      referralPricePaise: baseRow.referral === '' ? null : toPaise(baseRow.referral),
      // Product-level affiliate commission (amount XOR percent).
      commissionPaise,
      affiliateCommissionRate,
      hsnCode: hsnCode.trim() || null,
      variants: hasVariants
        ? variantRows.map((r, i) => {
            const vid = r.id ?? `${r.colorId || 'x'}_${r.sizeId || i}`;
            // Carry over fields the form doesn't edit so an edit never wipes them.
            const prev = existingRef.current?.variants.find((v) => v.id === vid);
            const sku = [categoryId.slice(0, 4).toUpperCase(), codeFor(colorVar?.units, r.colorId), codeFor(sizeVar?.units, r.sizeId)].filter(Boolean).join('-');
            return {
              id: vid,
              label: [colorVar?.units.find((u) => u.id === r.colorId)?.name, sizeVar?.units.find((u) => u.id === r.sizeId)?.name].filter(Boolean).join(' · ') || prev?.label || `Variant ${i + 1}`,
              mrpPaise: toPaise(r.price),
              offerPricePaise: toPaise(offerOf(r)),
              stock: prev?.stock ?? 0,
              // With no colour/size the code is just the category prefix, which
              // would collapse every such variant onto one SKU — keep the stored one.
              sku: !r.colorId && !r.sizeId && prev?.sku ? prev.sku : sku,
              referralPricePaise: r.referral === '' ? null : toPaise(r.referral),
              // Commission is product-level now; a variant never carries its own.
              commissionPaise: null,
              weight: prev?.weight ?? 200,
              visibility: prev?.visibility ?? ('visible' as const),
              // Other attribute keys ride along untouched (form edits colour/size only).
              attributes: { ...r.attrs, ...(r.colorId ? { color: r.colorId } : {}), ...(r.sizeId ? { size: r.sizeId } : {}) },
            };
          })
        : [],
    };

    try {
      setSaving(true);
      await saveProduct(values, isNew);
      toast.success(isNew ? 'Product created' : 'Changes saved');
      navigate('/products');
    } catch (e) {
      // Same reason as the list screen: a rules denial (products.edit missing)
      // must not read like a generic failure.
      toast.error(cfError(e, 'save the product'));
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
          {isNew ? 'Add product' : 'Edit product'}
        </h1>
        <div className="flex gap-2.5">
          <Button variant="outline" className="h-[42px]" onClick={() => navigate('/products')}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="h-[42px]"
            loading={saving}
            disabled={!canSave}
            title={canSave ? undefined : noPermissionTitle('products', isNew ? 'create' : 'edit')}
            onClick={onSave}
          >
            {isNew ? 'Save product' : 'Save changes'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_340px] gap-5">
        {/* LEFT */}
        <div className="flex flex-col gap-4">
          {/* Details */}
          <Card title="Details">
            <Field label="Product name" required error={errors.name}>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrors((x) => ({ ...x, name: undefined }));
                }}
                placeholder="Amber Oud — Eau de Parfum"
                className={cn(inputCls, errors.name && 'border-error focus:border-error')}
              />
            </Field>
            <div className="mt-3.5 grid grid-cols-2 gap-3.5">
              <Select
                label="Category"
                required
                error={errors.category}
                value={categoryId}
                placeholder="Select…"
                onChange={(v) => {
                  setCategoryId(v);
                  setSubCategoryId('');
                  setErrors((x) => ({ ...x, category: undefined, sub: undefined }));
                }}
                options={categories.map((c) => ({ value: c.slug, label: c.name }))}
              />
              <Select
                label="Sub-category"
                required
                error={errors.sub}
                value={subCategoryId}
                placeholder="Select…"
                disabled={!category}
                onChange={(v) => {
                  setSubCategoryId(v);
                  setErrors((x) => ({ ...x, sub: undefined }));
                }}
                options={(category?.subCategories ?? []).map((s) => ({ value: s.slug, label: s.name }))}
              />
            </div>
            <div className="mt-3.5">
              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="A warm, resinous amber layered over frankincense…"
                  className={cn(inputCls, 'resize-y py-2.5')}
                />
              </Field>
            </div>
            <div className="mt-3.5 grid grid-cols-2 gap-3.5">
              <Select
                label="Status"
                value={status}
                onChange={(v) => setStatus(v as Product['status'])}
                options={[
                  { value: 'published', label: 'Published' },
                  { value: 'draft', label: 'Draft' },
                  { value: 'archived', label: 'Archived' },
                ]}
              />
              {/* HSN code — the GST invoice prints it per line
                  (functions/src/orders/invoice.ts reads
                  `it.hsnCode ?? hsnCodes[category] ?? ''`). It was hardcoded to
                  null on every save with no field to set it, so the only thing
                  that could ever fill the column was the category fallback in
                  Settings › Delivery & tax — and that map had no editor either.
                  Leave it blank to inherit the category's code. */}
              <Field label="HSN code" hint={hsnHint}>
                <input
                  value={hsnCode}
                  onChange={(e) => setHsnCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
                  placeholder={categoryHsn || '33030090'}
                  inputMode="numeric"
                  className={inputCls}
                />
              </Field>
            </div>

            {/* Merchandising — drives the storefront home rails */}
            <div className="mt-4 border-t border-border-subtle pt-4">
              <div className="mb-2.5 font-ui text-xs font-bold text-text-primary">Merchandising</div>
              <div className="flex flex-col gap-2.5">
                <MerchToggle
                  label="Best seller"
                  hint="Show in the storefront “Best sellers” rail."
                  checked={isBestSeller}
                  onChange={setIsBestSeller}
                />
                <MerchToggle
                  label="Featured"
                  hint="Show as the featured product in the homepage hero."
                  checked={isFeatured}
                  onChange={setIsFeatured}
                />
                <MerchToggle
                  label="Flash sale"
                  hint="Show in the storefront “Flash sale” rail."
                  checked={isFlashSale}
                  onChange={setIsFlashSale}
                  disabled={!canFlashSale}
                  disabledTitle={noPermissionTitle('flashSale', 'edit')}
                />
              </div>
              <p className="mt-2 font-ui text-[11px] text-text-tertiary">
                New arrivals is automatic — a newly added product shows in the storefront “New arrivals” rail for its
                first {NEW_ARRIVAL_DAYS} days. Flash sale is opt-in: turn it on above for each product you want in the sale.
              </p>
            </div>

            {/* Rating is derived from real approved reviews (never entered
                here): a new product starts at 1.0 ★ · 0 reviews and moves only
                as verified customers review it. */}
            <div className="mt-4 border-t border-border-subtle pt-4">
              <div className="mb-1 font-ui text-xs font-bold text-text-primary">Rating</div>
              <p className="font-ui text-[11px] text-text-tertiary">
                Calculated automatically from verified customer reviews. New products start at
                1.0&nbsp;★ with 0 reviews and update as real reviews come in — it can’t be set manually.
              </p>
            </div>
          </Card>

          {/* Variants & pricing */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <div className="font-display text-sm font-bold text-text-primary">Variants &amp; pricing</div>
              <button onClick={addRow} className="inline-flex items-center gap-1.5 font-ui text-xs font-bold text-brand-primary">
                <RiAddLine size={15} /> Add variant
              </button>
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-ui text-[11px] font-semibold text-text-tertiary">From Settings › Variables:</span>
              {colorVar && <SoftChip>{colorVar.name}</SoftChip>}
              {sizeVar && <SoftChip>{sizeVar.name}</SoftChip>}
            </div>
            <p className="mb-2 font-ui text-[11px] leading-snug text-text-tertiary">
              Price varies per variant — set price, offer &amp; referral for each. Leave Color/Size as “—” for a
              single-price product. Affiliate commission is set once for the whole product below.
            </p>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Color', 'Size', 'Price', 'Offer', 'Referral', ''].map((h, i) => (
                    <th key={i} className="px-3 py-2 text-left font-ui text-[10px] font-bold uppercase tracking-[0.03em] text-text-tertiary">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="border-b border-border-subtle px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="h-3.5 w-3.5 flex-none rounded-[4px] border border-border-default" style={{ background: hexOf(r.colorId) ?? 'transparent' }} />
                        <MiniSelect value={r.colorId} onChange={(v) => updRow(r.key, { colorId: v })} options={colorOpts} />
                      </div>
                    </td>
                    <td className="border-b border-border-subtle px-2 py-1.5">
                      <MiniSelect value={r.sizeId} onChange={(v) => updRow(r.key, { sizeId: v })} options={sizeOpts} />
                    </td>
                    <MoneyCell value={r.price} onChange={(v) => updRow(r.key, { price: v })} tone="text-text-primary" error={rowErrors[r.key]?.price} />
                    <MoneyCell value={r.offer} onChange={(v) => updRow(r.key, { offer: v })} tone="text-success" error={rowErrors[r.key]?.offer} />
                    <MoneyCell value={r.referral} onChange={(v) => updRow(r.key, { referral: v })} tone="text-brand-gold-strong" error={rowErrors[r.key]?.referral} />
                    <td className="border-b border-border-subtle px-2 py-1.5 text-right">
                      <button onClick={() => delRow(r.key)} className="text-text-tertiary hover:text-error">
                        <RiCloseLine size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={6} className="px-2 py-2">
                    <button onClick={addRow} className="inline-flex items-center gap-1.5 font-ui text-[11px] font-bold text-brand-primary">
                      <RiAddLine size={14} /> Add row
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            {(liveLadderError ?? errors.pricing) && (
              <p className="mt-2 font-ui text-xs text-error">{liveLadderError ?? errors.pricing}</p>
            )}

            {/* Affiliate commission — one product-level setting (amount OR percent). */}
            <div className="mt-4 border-t border-border-subtle pt-4">
              <div className="mb-1 font-ui text-xs font-bold text-text-primary">Affiliate commission</div>
              <p className="mb-2.5 font-ui text-[11px] leading-snug text-text-tertiary">
                What the referrer earns when a referred customer buys this product — a fixed amount
                per unit, or a percentage of the sale. Both scale with quantity. Leave blank to pay
                no commission on this product.
              </p>
              <div className="flex items-center gap-2.5">
                <div className="inline-flex rounded-[8px] border border-border-default p-0.5">
                  {(['amount', 'percent'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setCommissionType(t)}
                      className={cn(
                        'rounded-[6px] px-3 py-1.5 font-ui text-xs font-bold transition-colors',
                        commissionType === t ? 'bg-brand-primary text-white' : 'text-text-secondary',
                      )}
                    >
                      {t === 'amount' ? 'Amount ₹' : 'Percent %'}
                    </button>
                  ))}
                </div>
                {commissionType === 'amount' ? (
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-ui text-xs text-text-tertiary">₹</span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={commissionAmount}
                      onChange={(e) => setCommissionAmount(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="0.00"
                      className={cn(inputCls, 'h-10 w-32 pl-6')}
                    />
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={commissionPercent}
                      onChange={(e) => setCommissionPercent(e.target.value)}
                      placeholder="5"
                      className={cn(inputCls, 'h-10 w-32 pr-6')}
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-ui text-xs text-text-tertiary">%</span>
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Specifications */}
          <Card>
            <div className="mb-3.5 flex items-center justify-between">
              <div className="font-display text-sm font-bold text-text-primary">Specifications</div>
              <button onClick={() => setSpecs((s) => [...s, { key: uid(), name: '', value: '' }])} className="inline-flex items-center gap-1.5 font-ui text-xs font-bold text-brand-primary">
                <RiAddLine size={15} /> Add field
              </button>
            </div>
            <div className="flex flex-col gap-2.5">
              {specs.length === 0 && <p className="font-ui text-xs text-text-tertiary">No specifications yet.</p>}
              {specs.map((s) => (
                <div key={s.key} className="flex items-center gap-2.5">
                  <input value={s.name} onChange={(e) => setSpecs((arr) => arr.map((x) => (x.key === s.key ? { ...x, name: e.target.value } : x)))} placeholder="Field name" className={cn(inputCls, 'flex-1 h-10')} />
                  <span className="text-text-tertiary">:</span>
                  <input value={s.value} onChange={(e) => setSpecs((arr) => arr.map((x) => (x.key === s.key ? { ...x, value: e.target.value } : x)))} placeholder="Value" className={cn(inputCls, 'h-10 flex-[1.4]')} />
                  <button onClick={() => setSpecs((arr) => arr.filter((x) => x.key !== s.key))} className="text-text-tertiary hover:text-error">
                    <RiCloseLine size={16} />
                  </button>
                </div>
              ))}
            </div>
          </Card>

          {/* Frequently bought together */}
          <Card>
            <div className="mb-3.5 flex items-center justify-between">
              <div className="font-display text-sm font-bold text-text-primary">Frequently bought together</div>
              <button onClick={() => setAttachOpen(true)} className="inline-flex items-center gap-1.5 font-ui text-xs font-bold text-brand-primary">
                <RiAddLine size={15} /> Attach product
              </button>
            </div>
            {fbt.length === 0 ? (
              <p className="font-ui text-xs text-text-tertiary">Nothing attached yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {fbt.map((pid) => {
                  const p = productById.get(pid);
                  return (
                    <div key={pid} className="flex items-center gap-2.5 rounded-[10px] border border-border-subtle px-2.5 py-2">
                      <span className="h-9 w-9 flex-none rounded-[6px]" style={{ background: p?.categoryTint ?? '#eee' }} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-ui text-xs font-semibold text-text-primary">{p?.name ?? pid}</div>
                        <div className="font-display text-[11px] font-bold text-brand-gold-strong">{p ? formatMoney2dp(p.offerPricePaise) : ''}</div>
                      </div>
                      <button onClick={() => setFbt((f) => f.filter((x) => x !== pid))} className="text-text-tertiary hover:text-error">
                        <RiCloseLine size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT — Images */}
        <div className="flex flex-col gap-4">
          <ImagesCard
            productId={id}
            tint={category?.categoryTint}
            images={images}
            onChange={setImages}
            onUploadingChange={setImagesUploading}
          />
        </div>
      </div>

      {attachOpen && (
        <ProductPickerModal
          products={allProducts.filter((p) => p.id !== id && !fbt.includes(p.id))}
          onClose={() => setAttachOpen(false)}
          onPick={(ids) => {
            setFbt((f) => [...f, ...ids]);
            setAttachOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ── Local components ───────────────────────────────────────────────
const inputCls =
  'w-full rounded-sm border border-border-default bg-surface-card px-3 py-2.5 font-ui text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none';

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-card p-5">
      {title && <div className="mb-3.5 font-display text-sm font-bold text-text-primary">{title}</div>}
      {children}
    </div>
  );
}
function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  /** Shown under the input when there is no error — same styling as TextField. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-ui text-xs font-bold text-text-primary">
        {label}
        {required && <span className="text-error"> *</span>}
      </span>
      {children}
      {error ? (
        <span className="font-ui text-xs text-error">{error}</span>
      ) : hint ? (
        <span className="font-ui text-[11px] text-text-tertiary">{hint}</span>
      ) : null}
    </label>
  );
}
function MerchToggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
  disabledTitle,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3" title={disabled ? disabledTitle : undefined}>
      <div>
        <div className="font-ui text-[13px] font-semibold text-text-primary">{label}</div>
        <div className="mt-0.5 font-ui text-[11px] text-text-tertiary">{hint}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function SoftChip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-pill bg-brand-primary-subtle px-2.5 py-1 font-ui text-[11px] font-semibold text-brand-primary">{children}</span>;
}
function MiniSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded border border-border-default bg-surface-card px-1.5 py-1 font-ui text-[12px] text-text-primary focus:border-brand-primary focus:outline-none">
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
function MoneyCell({ value, onChange, tone, error }: { value: Money; onChange: (v: Money) => void; tone: string; error?: string }) {
  return (
    <td className="border-b border-border-subtle px-2 py-1.5">
      <div
        title={error}
        className={cn(
          'flex items-center gap-0.5 rounded border px-1',
          error ? 'border-error bg-error-subtle' : 'border-transparent',
        )}
      >
        <span className={cn('font-display text-[12px] font-bold', error ? 'text-error' : tone)}>₹</span>
        <input
          type="number"
          min={0}
          value={value}
          aria-invalid={!!error}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className={cn('w-16 bg-transparent font-display text-[12px] font-bold focus:outline-none', error ? 'text-error' : tone)}
        />
      </div>
    </td>
  );
}

// One item still uploading (blob preview shown instantly, then swapped for the
// Storage URL). Errors keep the row with a retry, so nothing is silently lost.
interface Upload {
  id: string;
  name: string;
  previewUrl: string; // object URL — revoked on completion/removal
  status: 'uploading' | 'error';
  file: File;
}

function ImagesCard({
  productId,
  tint,
  images,
  onChange,
  onUploadingChange,
}: {
  productId: string;
  tint?: string;
  images: Product['images'];
  onChange: React.Dispatch<React.SetStateAction<Product['images']>>;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  // Ids the user removed mid-flight — their upload result is discarded on resolve.
  const abortedRef = useRef<Set<string>>(new Set());
  // Latest uploads, so the unmount cleanup revokes what's actually in flight.
  const uploadsRef = useRef<Upload[]>(uploads);
  uploadsRef.current = uploads;

  const reindex = (imgs: Product['images']): Product['images'] =>
    imgs.map((im, i) => ({ ...im, order: i, isPrimary: i === 0 }));

  // Tell the parent whether any upload is still running (blocks Save).
  useEffect(() => {
    onUploadingChange(uploads.some((u) => u.status === 'uploading'));
  }, [uploads, onUploadingChange]);

  // Revoke any outstanding object URLs on unmount (no memory leaks).
  useEffect(() => () => uploadsRef.current.forEach((u) => URL.revokeObjectURL(u.previewUrl)), []);

  const startUpload = (up: Upload) => {
    void (async () => {
      try {
        const url = await uploadProductImage(productId, up.file);
        if (abortedRef.current.has(up.id)) {
          abortedRef.current.delete(up.id);
          URL.revokeObjectURL(up.previewUrl);
          return; // removed while uploading — drop the result
        }
        onChange((prev) => reindex([...prev, { url, alt: up.name, order: prev.length, isPrimary: false }]));
        setUploads((prev) => prev.filter((u) => u.id !== up.id));
        URL.revokeObjectURL(up.previewUrl);
      } catch {
        setUploads((prev) => prev.map((u) => (u.id === up.id ? { ...u, status: 'error' } : u)));
        toast.error(`Couldn’t upload ${up.name}. Tap retry.`);
      }
    })();
  };

  const onPick = (files: FileList) => {
    const picked = Array.from(files).filter((f) => f.type.startsWith('image/'));
    const rejected = files.length - picked.length;
    if (rejected > 0) toast.info(`${rejected} non-image file${rejected > 1 ? 's' : ''} skipped.`);
    const created = picked.map<Upload>((file) => ({
      id: uid(),
      name: file.name,
      previewUrl: URL.createObjectURL(file), // instant preview — no waiting on the network
      status: 'uploading',
      file,
    }));
    if (created.length === 0) return;
    setUploads((prev) => [...prev, ...created]);
    created.forEach(startUpload);
  };

  const retry = (id: string) => {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, status: 'uploading' } : u)));
    const up = uploads.find((u) => u.id === id);
    if (up) startUpload({ ...up, status: 'uploading' });
  };

  const removeUpload = (id: string) => {
    const up = uploads.find((u) => u.id === id);
    if (!up) return;
    if (up.status === 'uploading') abortedRef.current.add(id); // discard result on resolve
    else URL.revokeObjectURL(up.previewUrl);
    setUploads((prev) => prev.filter((u) => u.id !== id));
  };

  const removeImage = (idx: number) => onChange((prev) => reindex(prev.filter((_, i) => i !== idx)));

  const hasAny = images.length > 0 || uploads.length > 0;
  // Main preview = first finalized image, else the first in-flight upload.
  const mainUrl = images[0]?.url ?? uploads[0]?.previewUrl ?? null;
  const mainLoading = images.length === 0 && uploads[0]?.status === 'uploading';

  return (
    <Card title="Images">
      {/* Main preview — full image on the category tint, never cropped. */}
      <div
        className="relative mb-2.5 grid h-[150px] w-full place-items-center overflow-hidden rounded-[10px]"
        style={{ background: tint ?? '#e6cfb4' }}
      >
        {mainUrl ? (
          <>
            <img src={mainUrl} alt="" className="max-h-full max-w-full object-contain" />
            {mainLoading && (
              <span className="absolute inset-0 grid place-items-center bg-surface-card/55">
                <Spinner className="h-5 w-5 text-brand-primary" />
              </span>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-text-tertiary">
            <RiImageLine size={30} />
            <span className="font-ui text-xs font-semibold">No image selected</span>
            <span className="font-ui text-[11px]">Click below to upload</span>
          </div>
        )}
      </div>

      {/* Thumbnail strip — finalized images, then in-flight uploads, then add tile.
          Matches the prototype: 52px tall, rounded-7, gap-8, dashed add tile. */}
      <div className="flex flex-wrap gap-2">
        {images.map((im, i) => (
          <div
            key={`${im.url}-${i}`}
            className="group relative h-[52px] w-[52px] flex-none overflow-hidden rounded-[7px] border border-border-subtle"
            style={{ background: tint ?? '#efe2cf' }}
          >
            <img src={im.url} alt={im.alt} className="h-full w-full object-contain" />
            {i === 0 && (
              <span className="absolute left-0.5 top-0.5 rounded bg-brand-primary px-1 py-px font-ui text-[8px] font-bold uppercase tracking-wide text-white">
                Main
              </span>
            )}
            <button
              onClick={() => removeImage(i)}
              className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-surface-card text-text-tertiary opacity-0 shadow-sm transition-opacity hover:text-error group-hover:opacity-100"
              aria-label="Remove image"
            >
              <RiCloseLine size={12} />
            </button>
          </div>
        ))}

        {uploads.map((u) => (
          <div
            key={u.id}
            className="group relative h-[52px] w-[52px] flex-none overflow-hidden rounded-[7px] border border-border-subtle bg-surface-app"
          >
            <img src={u.previewUrl} alt={u.name} className="h-full w-full object-contain opacity-60" />
            <span className="absolute inset-0 grid place-items-center">
              {u.status === 'uploading' ? (
                <Spinner className="h-4 w-4 text-brand-primary" />
              ) : (
                <button onClick={() => retry(u.id)} className="grid h-full w-full place-items-center text-error" title="Retry upload">
                  <RiRefreshLine size={16} />
                </button>
              )}
            </span>
            {u.status === 'error' && (
              <span className="absolute left-0.5 top-0.5 text-error"><RiErrorWarningLine size={12} /></span>
            )}
            <button
              onClick={() => removeUpload(u.id)}
              className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-surface-card text-text-tertiary opacity-0 shadow-sm transition-opacity hover:text-error group-hover:opacity-100"
              aria-label="Remove image"
            >
              <RiCloseLine size={12} />
            </button>
          </div>
        ))}

        <button
          onClick={() => fileRef.current?.click()}
          className="grid h-[52px] w-[52px] flex-none place-items-center rounded-[7px] border border-dashed border-border-default text-text-tertiary hover:border-brand-primary hover:text-brand-primary"
          aria-label="Add images"
        >
          <RiAddLine size={18} />
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onPick(e.target.files);
          e.target.value = '';
        }}
      />
      <p className="mt-2.5 font-ui text-[11px] leading-snug text-text-tertiary">
        {hasAny
          ? 'JPG/PNG up to 5 MB · the first image is the main. Hover a thumbnail to remove it.'
          : 'JPG/PNG up to 5 MB · select one or many. The first image becomes the main.'}
      </p>
    </Card>
  );
}
