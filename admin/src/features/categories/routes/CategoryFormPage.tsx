import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { RiAddLine, RiCloseLine } from '@remixicon/react';
import type { Category, SubCategory } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { noPermissionTitle, useCan } from '@/features/auth/useCan';
import { Spinner } from '@/components/ui/Spinner';
import { Toggle } from '@/components/ui/Toggle';
import { cn } from '@/lib/cn';
import {
  countSubCategoryProducts,
  fanOutCategoryTint,
  getCategory,
  saveCategory,
  slugify,
  uploadCategoryImage,
  useCategories,
  type CategoryFormValues,
} from '../api/categories';

const inputCls =
  'w-full rounded-sm border border-border-default bg-surface-card px-3.5 py-2.5 font-ui text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none';

export function CategoryFormPage() {
  const { id: routeId } = useParams();
  const isNew = !routeId || routeId === 'new';
  const navigate = useNavigate();
  const { data: categories } = useCategories();
  // Seed from the categories cache so opening Edit is instant (no spinner).
  const seed = isNew ? null : categories.find((c) => c.id === routeId) ?? null;

  const [loading, setLoading] = useState(!isNew && !seed);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(seed?.name ?? '');
  const [tint, setTint] = useState(seed?.categoryTint ?? '#e6cfb4');
  const [initialTint, setInitialTint] = useState(seed?.categoryTint ?? '#e6cfb4');
  const [visible, setVisible] = useState(seed ? seed.visibility === 'visible' : true);
  const [iconUrl, setIconUrl] = useState<string | null>(seed?.iconUrl ?? null);
  const [preview, setPreview] = useState<string | null>(null); // instant object-URL preview while uploading
  const [subs, setSubs] = useState<SubCategory[]>(seed?.subCategories ?? []);
  const [subInput, setSubInput] = useState('');
  // Menu position. `order` is the only thing the storefront sorts categories by
  // (orderBy('order','asc')), and it was written once at creation and never
  // again — so this is the only way to reorder the menu.
  const [order, setOrder] = useState<number | ''>(seed?.order ?? '');
  const [nameErr, setNameErr] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const seededRef = useRef(!!seed);
  // The stored category — the form has no inputs for description / tag colour,
  // so they're carried through from here instead of being reset on every save.
  const storedRef = useRef<Category | null>(seed);
  const fileRef = useRef<HTMLInputElement>(null);
  const [id] = useState(() => (isNew ? '' : routeId!));
  // The route only proves `categories.view`; the write needs create/edit.
  const canSave = useCan()('categories', isNew ? 'create' : 'edit');

  useEffect(() => {
    if (isNew) return;
    getCategory(routeId!).then((c) => {
      if (!c) {
        toast.error('Category not found.');
        navigate('/categories');
        return;
      }
      storedRef.current = c; // always refresh (used to preserve unedited fields on save)
      // If seeded from cache, don't clobber fields the user may be editing.
      if (!seededRef.current) {
        setName(c.name);
        setTint(c.categoryTint);
        setInitialTint(c.categoryTint);
        setVisible(c.visibility === 'visible');
        setIconUrl(c.iconUrl);
        setSubs(c.subCategories ?? []);
        setOrder(c.order ?? 0);
      }
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, routeId, navigate]);

  // Where this category would land, so the number means something before it is
  // saved. Categories arrive already sorted by `order` (the list query does it).
  const orderPreview = (() => {
    const others = categories.filter((c) => c.id !== id);
    if (others.length === 0) return '';
    const n = order === '' ? (isNew ? categories.length : (seed?.order ?? 0)) : Number(order);
    const before = others.filter((c) => (c.order ?? 0) < n).length;
    const after = others[before];
    if (before === 0) return `Currently first, before ${others[0]!.name}.`;
    return after
      ? `Currently after ${others[before - 1]!.name}, before ${after.name}.`
      : `Currently last, after ${others[before - 1]!.name}.`;
  })();

  const addSub = () => {
    const label = subInput.trim();
    if (!label) return;
    const slug = slugify(label);
    // An empty slug is stored silently here (no doc path is involved), and the
    // product form then offers a sub-category whose value is '' — unselectable.
    if (!slug) {
      toast.error('Use at least one Latin letter or digit in the sub-category name.');
      return;
    }
    if (subs.some((s) => s.slug === slug)) {
      toast.info('That sub-category already exists.');
      return;
    }
    setSubs((s) => [...s, { id: slug, slug, name: label, order: s.length, visibility: 'visible', productCount: 0 }]);
    setSubInput('');
  };

  // Removing a sub-category that still has products strands them outside every
  // storefront query (and the product form can no longer re-select it), so run
  // the same guard the sub-categories screen enforces before dropping the chip.
  // Subs added in this session can't have products yet — skip the round trip.
  const removeSub = async (s: SubCategory) => {
    const stored = storedRef.current?.subCategories?.some((x) => x.id === s.id) ?? false;
    if (!isNew && stored) {
      try {
        const n = await countSubCategoryProducts(id, s.id);
        if (n > 0) {
          toast.error(`${s.name} has ${n} product${n > 1 ? 's' : ''} — reassign them first.`);
          return;
        }
      } catch {
        toast.error(`Could not check ${s.name} for attached products.`);
        return;
      }
    }
    setSubs((arr) => arr.filter((x) => x.id !== s.id));
  };

  const onImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.info('Please choose an image file.');
      return;
    }
    // Category id is the slug; needs a name first for a new category.
    const catId = isNew ? slugify(name) : id;
    if (!catId) {
      // A typed name can still slugify to '' — don't ask for a name they gave.
      toast.info(
        name.trim()
          ? 'Use at least one Latin letter or digit in the category name.'
          : 'Enter the category name first, then add an image.',
      );
      return;
    }
    const localUrl = URL.createObjectURL(file); // show it instantly
    setPreview(localUrl);
    try {
      setUploading(true);
      const url = await uploadCategoryImage(catId, file);
      setIconUrl(url);
      toast.success('Image uploaded');
    } catch {
      toast.error('Image upload failed. Please try again.');
    } finally {
      setUploading(false);
      setPreview(null);
      URL.revokeObjectURL(localUrl);
    }
  };

  const onSave = async () => {
    if (!name.trim()) {
      setNameErr('Category name is required.');
      toast.error('Category name is required.');
      return;
    }
    // The doc id is the slug too: a name with no Latin letters or digits (Arabic,
    // Urdu, pure punctuation) slugifies to '' and setDoc() on an empty id fails
    // with an opaque path error, so say what's actually wrong.
    if (isNew && !slugify(name)) {
      setNameErr('Use at least one Latin letter or digit in the name.');
      toast.error('Use at least one Latin letter or digit in the category name.');
      return;
    }
    // The doc id is the slug, so a duplicate name would silently overwrite an
    // existing category — block it on create.
    if (isNew && categories.some((c) => c.slug === slugify(name))) {
      setNameErr('A category with this name already exists.');
      toast.error('A category with this name already exists.');
      return;
    }
    const values: CategoryFormValues = {
      id: isNew ? slugify(name) : id,
      name: name.trim(),
      description: storedRef.current?.description ?? '',
      categoryTint: tint,
      categoryTagColor: storedRef.current?.categoryTagColor ?? 'amber',
      iconUrl,
      visibility: visible ? 'visible' : 'hidden',
      subCategories: subs,
      // Blank means "leave it where it is" — a new category goes to the end,
      // an existing one keeps the position it already had.
      order:
        order === ''
          ? isNew
            ? categories.length
            : (categories.find((c) => c.id === id)?.order ?? 0)
          : Number(order),
    };
    let savedId: string;
    try {
      setSaving(true);
      savedId = await saveCategory(values, isNew);
    } catch {
      toast.error('Could not save the category.');
      setSaving(false);
      return;
    }
    // Denormalized tint lives on products — fan out if it changed. The category
    // is already committed at this point, so a fan-out failure must not be
    // reported as a failed save: that left the operator retrying a save which
    // had in fact succeeded. `initialTint` only advances once the fan-out went
    // through, so a retry re-runs exactly the part that failed.
    if (!isNew && tint !== initialTint) {
      try {
        await fanOutCategoryTint(savedId, tint);
      } catch {
        setSaving(false);
        toast.error('Category saved, but the product tints could not be updated.');
        return;
      }
    }
    setInitialTint(tint);
    setSaving(false);
    toast.success(isNew ? 'Category created' : 'Changes saved');
    navigate('/categories');
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
      <div className="mb-5 flex items-start justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
          {isNew ? 'Add category' : 'Edit category'}
        </h1>
        <div className="flex gap-2.5">
          <Button variant="outline" className="h-[42px]" onClick={() => navigate('/categories')}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="h-[42px]"
            loading={saving}
            disabled={!canSave}
            title={canSave ? undefined : noPermissionTitle('categories', isNew ? 'create' : 'edit')}
            onClick={onSave}
          >
            {isNew ? 'Save category' : 'Save changes'}
          </Button>
        </div>
      </div>

      <div className="flex max-w-[640px] flex-col gap-4">
        {/* Details */}
        <div className="rounded-md border border-border-subtle bg-surface-card p-5">
          <div className="flex items-start gap-[18px]">
            {/* Image tile */}
            <button
              onClick={() => fileRef.current?.click()}
              className="relative grid h-[110px] w-[110px] flex-none place-items-center overflow-hidden rounded-md border border-dashed border-border-default text-text-tertiary hover:border-brand-primary hover:text-brand-primary"
              style={{ background: preview || iconUrl ? tint : undefined }}
            >
              {preview || iconUrl ? (
                <>
                  <img src={preview ?? iconUrl ?? ''} alt="" className="max-h-full max-w-full object-contain" />
                  {uploading && (
                    <span className="absolute inset-0 grid place-items-center bg-surface-card/55">
                      <Spinner className="h-5 w-5 text-brand-primary" />
                    </span>
                  )}
                </>
              ) : (
                <span className="flex flex-col items-center gap-1.5">
                  <RiAddLine size={22} />
                  <span className="font-ui text-[11px] font-medium">Image</span>
                </span>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImage(f);
                e.target.value = '';
              }}
            />

            <div className="flex-1 pt-1.5">
              <label className="flex flex-col gap-1.5">
                <span className="font-ui text-xs font-bold text-text-primary">
                  Category name<span className="text-error"> *</span>
                </span>
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameErr(undefined);
                  }}
                  placeholder="Perfumes"
                  className={cn(inputCls, nameErr && 'border-error focus:border-error')}
                />
                {nameErr && <span className="font-ui text-xs text-error">{nameErr}</span>}
              </label>

              {/* Tint + visibility (spec §5.7 / admin dep §D — required by the data model) */}
              <div className="mt-3.5 flex items-center gap-5">
                <label className="flex items-center gap-2">
                  <span className="font-ui text-xs font-bold text-text-primary">Tint</span>
                  <input type="color" value={tint} onChange={(e) => setTint(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-border-default bg-surface-card" />
                  <span className="font-ui text-xs text-text-tertiary">{tint}</span>
                </label>
                <label className="flex items-center gap-2">
                  <span className="font-ui text-xs font-bold text-text-primary">Visible</span>
                  <Toggle checked={visible} onChange={setVisible} />
                </label>
                {/* Menu position. Lower sorts first; ties keep whatever order
                    Firestore returns, so give each category its own number. */}
                <label className="flex items-center gap-2">
                  <span className="font-ui text-xs font-bold text-text-primary">Order</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={order}
                    onChange={(e) => setOrder(e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder={isNew ? String(categories.length) : '0'}
                    className={cn(inputCls, 'h-8 w-20 px-2 py-0')}
                  />
                </label>
              </div>
              <p className="mt-2 font-ui text-[11px] text-text-tertiary">
                Order controls where this category sits in the storefront menu — lowest number first.{' '}
                {orderPreview}
              </p>
            </div>
          </div>
        </div>

        {/* Sub-categories */}
        <div className="rounded-md border border-border-subtle bg-surface-card p-5">
          <div className="mb-3.5 font-display text-sm font-bold text-text-primary">Sub-categories</div>
          <div className="mb-3.5 flex gap-2.5">
            <input
              value={subInput}
              onChange={(e) => setSubInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSub())}
              placeholder="New sub-category name…"
              className={inputCls}
            />
            <Button variant="primary" className="h-[42px]" onClick={addSub}>
              Add
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {subs.length === 0 && <span className="font-ui text-xs text-text-tertiary">No sub-categories yet.</span>}
            {subs.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5 rounded-[7px] border border-border-subtle bg-surface-app px-2.5 py-1.5 font-ui text-xs font-semibold text-text-primary">
                {s.name}
                <button onClick={() => void removeSub(s)} className="text-text-tertiary hover:text-error">
                  <RiCloseLine size={13} />
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
