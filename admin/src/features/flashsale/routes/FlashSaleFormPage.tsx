import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { RiAddLine, RiCloseLine, RiEyeLine, RiUploadCloud2Line, RiRefreshLine } from '@remixicon/react';
import type { FlashSale } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cn } from '@/lib/cn';
import { getCachedList } from '@/hooks/firestoreCache';
import { noPermissionTitle, useCan } from '@/features/auth/useCan';
import { useProductsList } from '@/features/products/api/products';
import { ProductPickerModal } from '@/features/products/components/ProductPickerModal';
import {
  FLASH_SALES_KEY,
  getFlashSale,
  newFlashSaleId,
  saveFlashSale,
  uploadFlashSaleImage,
  type FlashSaleFormValues,
} from '../api/flashSales';

const inputCls =
  'w-full rounded-sm border border-border-default bg-surface-card px-[13px] py-[11px] font-ui text-[13px] font-medium text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none';

/** `<input type="datetime-local">` works in local wall-clock time, no timezone
 *  suffix — this round-trips a Date through exactly that format. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** A sensible default window for a brand-new sale: starts in an hour, runs 24h. */
function defaultStart(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}
function defaultEnd(start: Date): Date {
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

export function FlashSaleFormPage() {
  const { id: routeId } = useParams();
  const isNew = !routeId || routeId === 'new';
  const navigate = useNavigate();

  const { data: products } = useProductsList();
  const canSave = useCan()('flashSale', isNew ? 'create' : 'edit');

  // Seed instantly from the list cache so opening an edit never blanks the
  // screen; getFlashSale still runs below to refresh from the server.
  const seed = useState<FlashSale | null>(() =>
    isNew ? null : (getCachedList<FlashSale>(FLASH_SALES_KEY).find((s) => s.id === routeId) ?? null),
  )[0];

  const [id] = useState(() => (isNew ? newFlashSaleId() : routeId!));
  const [loading, setLoading] = useState(!isNew && !seed);
  const [saving, setSaving] = useState(false);

  const seedStart = seed?.startsAt?.toDate?.() ?? defaultStart();
  const [name, setName] = useState(seed?.name ?? '');
  const [start, setStart] = useState(toLocalInput(seedStart));
  const [end, setEnd] = useState(toLocalInput(seed?.endsAt?.toDate?.() ?? defaultEnd(seedStart)));
  const [visible, setVisible] = useState((seed?.visibility ?? 'visible') === 'visible');
  const [productIds, setProductIds] = useState<string[]>(seed?.productIds ?? []);
  const [bannerImageUrl, setBannerImageUrl] = useState(seed?.bannerImageUrl ?? '');
  const [cancelled, setCancelled] = useState(seed?.status === 'cancelled');
  const [errors, setErrors] = useState<{ name?: string; window?: string }>({});
  const [showPicker, setShowPicker] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Image upload state (blob preview shown instantly, then swapped for the URL).
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'error'>('idle');
  const lastFileRef = useRef<File | null>(null);
  const previewRef = useRef<string | null>(null);
  previewRef.current = preview;

  // Load / refresh the sale from the server for edit.
  useEffect(() => {
    if (isNew) return;
    getFlashSale(routeId!)
      .then((s) => {
        if (!s) {
          toast.error('Flash sale not found.');
          navigate('/flash-sale');
          return;
        }
        if (!seed) {
          setName(s.name);
          setStart(toLocalInput(s.startsAt.toDate()));
          setEnd(toLocalInput(s.endsAt.toDate()));
          setVisible(s.visibility !== 'hidden');
          setProductIds(s.productIds ?? []);
          setBannerImageUrl(s.bannerImageUrl ?? '');
          setCancelled(s.status === 'cancelled');
        }
      })
      .catch(() => {
        toast.error("Couldn't load this flash sale.");
        navigate('/flash-sale');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, routeId, navigate]);

  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  const upload = (file: File) => {
    lastFileRef.current = file;
    const objUrl = URL.createObjectURL(file);
    setPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return objUrl; });
    setUploadState('uploading');
    void (async () => {
      try {
        const url = await uploadFlashSaleImage(id, file);
        setBannerImageUrl(url);
        setUploadState('idle');
        setPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
      } catch {
        setUploadState('error');
        toast.error('Couldn’t upload the image. Tap retry.');
      }
    })();
  };

  const onPick = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.info('Please choose an image file.');
      return;
    }
    upload(file);
  };

  const productName = (pid: string) => products.find((p) => p.id === pid)?.name ?? 'Unknown product';

  const onSave = async () => {
    const startDate = fromLocalInput(start);
    const endDate = fromLocalInput(end);
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Give the sale a name.';
    if (!startDate || !endDate) errs.window = 'Pick a start and end time.';
    else if (endDate.getTime() <= startDate.getTime()) errs.window = 'End must be after start.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error('Please fix the highlighted fields.');
      return;
    }
    if (uploadState === 'uploading') {
      toast.info('Please wait for the image to finish uploading.');
      return;
    }

    const values: FlashSaleFormValues = {
      id,
      name: name.trim(),
      startsAt: startDate!,
      endsAt: endDate!,
      bannerImageUrl: bannerImageUrl || null,
      productIds,
      visibility: visible ? 'visible' : 'hidden',
      cancelled,
    };

    try {
      setSaving(true);
      await saveFlashSale(values, isNew);
      toast.success(isNew ? 'Flash sale created' : 'Changes saved');
      navigate('/flash-sale');
    } catch {
      toast.error('Could not save the flash sale.');
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

  const shownUrl = preview ?? (bannerImageUrl || null);

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
          {isNew ? 'Create flash sale' : 'Edit flash sale'}
        </h1>
        <div className="flex gap-2.5">
          <Button variant="outline" className="h-[42px]" onClick={() => navigate('/flash-sale')}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="h-[42px]"
            loading={saving}
            disabled={!canSave}
            title={canSave ? undefined : noPermissionTitle('flashSale', isNew ? 'create' : 'edit')}
            onClick={onSave}
          >
            {isNew ? 'Create sale' : 'Save changes'}
          </Button>
        </div>
      </div>

      <div className="flex max-w-[720px] flex-col gap-4">
        {/* Banner image */}
        <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
          <div className="mb-1.5 font-display text-[13px] font-bold text-text-primary">Banner image</div>
          <div className="mb-3 font-ui text-[11px] font-medium text-brand-primary">
            Optional — shown above the countdown on the storefront rail.
          </div>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={cn(
              'relative flex aspect-video w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-[10px] border border-dashed text-text-tertiary transition-colors border-border-default hover:border-brand-primary',
            )}
            style={
              shownUrl
                ? { backgroundImage: `url(${shownUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                : undefined
            }
          >
            {shownUrl ? (
              (uploadState === 'uploading' || uploadState === 'error') && (
                <span className="absolute inset-0 grid place-items-center bg-surface-card/60">
                  {uploadState === 'uploading' ? (
                    <Spinner className="h-6 w-6 text-brand-primary" />
                  ) : (
                    <span
                      onClick={(e) => { e.stopPropagation(); if (lastFileRef.current) upload(lastFileRef.current); }}
                      className="inline-flex items-center gap-1.5 font-ui text-xs font-bold text-error"
                    >
                      <RiRefreshLine size={16} /> Retry upload
                    </span>
                  )}
                </span>
              )
            ) : (
              <>
                <RiEyeLine size={30} />
                <span className="font-ui text-xs font-semibold">Upload banner image</span>
              </>
            )}
          </button>

          {shownUrl && uploadState === 'idle' && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-2.5 inline-flex items-center gap-1.5 font-ui text-xs font-bold text-brand-primary"
            >
              <RiUploadCloud2Line size={15} /> Replace image
            </button>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              onPick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        {/* Details */}
        <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
          <div className="flex flex-col gap-[14px]">
            <label className="flex flex-col gap-1.5">
              <span className="font-ui text-xs font-bold text-text-primary">Sale name</span>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrors((x) => ({ ...x, name: undefined }));
                }}
                placeholder="Eid Flash Sale"
                className={cn(inputCls, errors.name && 'border-error focus:border-error')}
              />
              {errors.name && <span className="font-ui text-xs text-error">{errors.name}</span>}
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="font-ui text-xs font-bold text-text-primary">Starts</span>
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    setErrors((x) => ({ ...x, window: undefined }));
                  }}
                  className={cn(inputCls, errors.window && 'border-error focus:border-error')}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-ui text-xs font-bold text-text-primary">Ends</span>
                <input
                  type="datetime-local"
                  value={end}
                  onChange={(e) => {
                    setEnd(e.target.value);
                    setErrors((x) => ({ ...x, window: undefined }));
                  }}
                  className={cn(inputCls, errors.window && 'border-error focus:border-error')}
                />
              </label>
            </div>
            {errors.window && <span className="font-ui text-xs text-error">{errors.window}</span>}
            <span className="font-ui text-[11px] text-text-tertiary">
              Scheduled / Active / Ended updates on its own from these times — no need to set it by hand.
            </span>

            {/* Products */}
            <div className="border-t border-border-subtle pt-4">
              <div className="flex items-center justify-between">
                <span className="font-ui text-xs font-bold text-text-primary">Products in this sale</span>
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="inline-flex items-center gap-1.5 font-ui text-xs font-bold text-brand-primary"
                >
                  <RiAddLine size={15} /> Add products
                </button>
              </div>
              {productIds.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {productIds.map((pid) => (
                    <span
                      key={pid}
                      className="inline-flex items-center gap-1.5 rounded-[7px] border border-border-subtle bg-surface-app px-2.5 py-1.5 font-ui text-xs font-semibold text-text-primary"
                    >
                      {productName(pid)}
                      <button
                        type="button"
                        onClick={() => setProductIds((a) => a.filter((x) => x !== pid))}
                        className="text-text-tertiary hover:text-error"
                      >
                        <RiCloseLine size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <span className="mt-1.5 block font-ui text-[11px] text-text-tertiary">
                {productIds.length === 0
                  ? 'Empty — the storefront falls back to any product flagged Flash sale.'
                  : `${productIds.length} product${productIds.length === 1 ? '' : 's'}, shown in this order.`}
              </span>
            </div>

            <div className="flex items-center justify-between border-t border-border-subtle pt-4">
              <span className="font-ui text-[13px] font-semibold text-text-secondary">
                Visible on storefront
              </span>
              <Toggle checked={visible} onChange={setVisible} />
            </div>

            {!isNew && !cancelled && (
              <div className="flex items-center justify-between border-t border-border-subtle pt-4">
                <div>
                  <div className="font-ui text-[13px] font-semibold text-text-primary">Cancel this sale</div>
                  <div className="mt-0.5 font-ui text-[11px] text-text-tertiary">
                    Ends it immediately, regardless of the scheduled window.
                  </div>
                </div>
                <Button variant="danger" onClick={() => setConfirmCancel(true)}>
                  Cancel sale
                </Button>
              </div>
            )}
            {cancelled && (
              <p className="border-t border-border-subtle pt-4 font-ui text-[11px] text-error">
                This sale is cancelled — saving keeps it off the storefront regardless of its window.
              </p>
            )}
          </div>
        </div>
      </div>

      {showPicker && (
        <ProductPickerModal
          title="Add products to sale"
          confirmVerb="Add"
          products={products.filter((p) => !productIds.includes(p.id))}
          onClose={() => setShowPicker(false)}
          onPick={(ids) => {
            setProductIds((a) => [...a, ...ids]);
            setShowPicker(false);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmCancel}
        variant="danger"
        title="Cancel this flash sale?"
        body="It will stop showing on the storefront immediately, even if its scheduled window hasn't ended. This cannot be undone from here — create a new sale to run it again."
        confirmLabel="Cancel sale"
        onConfirm={() => {
          setCancelled(true);
          setConfirmCancel(false);
        }}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}
