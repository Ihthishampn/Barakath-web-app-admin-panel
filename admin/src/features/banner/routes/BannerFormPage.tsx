import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { RiEyeLine, RiUploadCloud2Line, RiRefreshLine } from '@remixicon/react';
import type { Banner, BannerPlacement } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { getCachedList } from '@/hooks/firestoreCache';
import { noPermissionTitle, useCan } from '@/features/auth/useCan';
import { useProductsList } from '@/features/products/api/products';
import {
  APP_PLACEMENT,
  BANNERS_KEY,
  getBanner,
  newBannerId,
  saveBanner,
  uploadBannerImage,
  useBannersList,
  type BannerFormValues,
} from '../api/banners';

const inputCls =
  'w-full rounded-sm border border-border-default bg-surface-card px-[13px] py-[11px] font-ui text-[13px] font-medium text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none';

export function BannerFormPage() {
  const { id: routeId } = useParams();
  const isNew = !routeId || routeId === 'new';
  const navigate = useNavigate();

  const { data: products } = useProductsList();
  // The other banners, so the position field can say where this one will land.
  const { data: banners } = useBannersList();
  const canSave = useCan()('banner', isNew ? 'create' : 'edit');

  // Seed instantly from the banners cache so opening an edit never blanks the
  // screen; getBanner still runs below to refresh from the server.
  const seed = useState<Banner | null>(() =>
    isNew ? null : (getCachedList<Banner>(BANNERS_KEY).find((b) => b.id === routeId) ?? null),
  )[0];

  const [id] = useState(() => (isNew ? newBannerId() : routeId!));
  const [loading, setLoading] = useState(!isNew && !seed);
  const [saving, setSaving] = useState(false);
  const placementRef = useRef<BannerPlacement>(seed?.placement ?? APP_PLACEMENT);

  const [title, setTitle] = useState(seed?.title ?? '');
  const [imageUrl, setImageUrl] = useState(seed?.imageUrl ?? '');
  const [attachedProductId, setAttachedProductId] = useState<string>(seed?.attachedProductId ?? '');
  const [publishLive, setPublishLive] = useState(seed?.publishLive ?? false);
  // Carousel position. `order` was stamped once at creation and never written
  // again, so the hero could only ever run in creation order.
  const [order, setOrder] = useState<number | ''>(seed?.order ?? '');
  const [errors, setErrors] = useState<{ title?: string; image?: string }>({});

  // Image upload state (blob preview shown instantly, then swapped for the URL).
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null); // object URL while uploading
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'error'>('idle');
  const lastFileRef = useRef<File | null>(null);
  const previewRef = useRef<string | null>(null);
  previewRef.current = preview;

  // Load / refresh the banner from the server for edit.
  useEffect(() => {
    if (isNew) return;
    getBanner(routeId!)
      .then((b) => {
        if (!b) {
          toast.error('Banner not found.');
          navigate('/banner');
          return;
        }
        placementRef.current = b.placement ?? APP_PLACEMENT;
        if (!seed) {
          setTitle(b.title);
          setImageUrl(b.imageUrl);
          setAttachedProductId(b.attachedProductId ?? '');
          setPublishLive(b.publishLive);
          setOrder(b.order ?? '');
        }
      })
      // Without this the read rejecting (offline on a direct link, so there is
      // no cache seed) left `loading` true forever — a spinner with no message
      // and an unhandled rejection. Fail like the not-found branch instead.
      .catch(() => {
        toast.error('Couldn’t load this banner.');
        navigate('/banner');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, routeId, navigate]);

  // Revoke any outstanding object URL on unmount.
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  const upload = (file: File) => {
    lastFileRef.current = file;
    const objUrl = URL.createObjectURL(file);
    setPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return objUrl; });
    setUploadState('uploading');
    setErrors((x) => ({ ...x, image: undefined }));
    void (async () => {
      try {
        const url = await uploadBannerImage(id, file);
        setImageUrl(url);
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

  const onSave = async () => {
    const errs: typeof errors = {};
    if (!title.trim()) errs.title = 'Banner title is required.';
    if (!imageUrl) errs.image = 'A 16:9 image is required.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error('Please fix the highlighted fields.');
      return;
    }
    if (uploadState === 'uploading') {
      toast.info('Please wait for the image to finish uploading.');
      return;
    }

    const values: BannerFormValues = {
      id,
      title: title.trim(),
      imageUrl,
      attachedProductId: attachedProductId || null,
      publishLive,
      placement: placementRef.current,
      order: order === '' ? null : Number(order),
    };

    try {
      setSaving(true);
      await saveBanner(values, isNew);
      toast.success(isNew ? 'Banner created' : 'Changes saved');
      navigate('/banner');
    } catch {
      toast.error('Could not save the banner.');
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

  const shownUrl = preview ?? (imageUrl || null);

  // Where this banner would land. `banners` arrive already sorted by `order`.
  const others = banners.filter((b) => b.id !== id);
  const orderHint = (() => {
    if (order === '') return isNew ? 'Blank — added to the end.' : 'Blank — position unchanged.';
    const n = Number(order);
    const before = others.filter((b) => (b.order ?? 0) < n).length;
    if (others.length === 0) return 'The only banner.';
    if (before === 0) return `Shows first, before “${others[0]!.title || 'Untitled'}”.`;
    const after = others[before];
    return after
      ? `Shows after “${others[before - 1]!.title || 'Untitled'}”, before “${after.title || 'Untitled'}”.`
      : `Shows last, after “${others[before - 1]!.title || 'Untitled'}”.`;
  })();

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
          {isNew ? 'Add banner' : 'Edit banner'}
        </h1>
        <div className="flex gap-2.5">
          <Button variant="outline" className="h-[42px]" onClick={() => navigate('/banner')}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="h-[42px]"
            loading={saving}
            disabled={!canSave}
            title={canSave ? undefined : noPermissionTitle('banner', isNew ? 'create' : 'edit')}
            onClick={onSave}
          >
            {isNew ? 'Save banner' : 'Save changes'}
          </Button>
        </div>
      </div>

      <div className="flex max-w-[720px] flex-col gap-4">
        {/* Banner image */}
        <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
          <div className="mb-1.5 font-display text-[13px] font-bold text-text-primary">Banner image</div>
          <div className="mb-3 font-ui text-[11px] font-medium text-brand-primary">
            Recommended aspect ratio 16:9 (e.g. 1920×1080)
          </div>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={cn(
              'relative flex aspect-video w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-[10px] border border-dashed text-text-tertiary transition-colors',
              errors.image ? 'border-error' : 'border-border-default hover:border-brand-primary',
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
                <span className="font-ui text-xs font-semibold">Upload 16:9 image</span>
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
          {errors.image && <p className="mt-2 font-ui text-xs text-error">{errors.image}</p>}

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
              <span className="font-ui text-xs font-bold text-text-primary">Banner title</span>
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setErrors((x) => ({ ...x, title: undefined }));
                }}
                placeholder="The Eid Edit"
                className={cn(inputCls, errors.title && 'border-error focus:border-error')}
              />
              {errors.title && <span className="font-ui text-xs text-error">{errors.title}</span>}
            </label>

            <Select
              label="Attach product"
              value={attachedProductId}
              placeholder="No product"
              onChange={setAttachedProductId}
              options={products.map((p) => ({ value: p.id, label: p.name }))}
            />

            {/* Carousel position — lowest first, matching the list's and both
                storefronts' orderBy('order','asc'). Existing banners were
                stamped with Date.now() at creation, so their numbers are large
                epoch values; any smaller number moves a banner to the front. */}
            <label className="flex flex-col gap-1.5">
              <span className="font-ui text-xs font-bold text-text-primary">Carousel position</span>
              <input
                type="number"
                min={0}
                step={1}
                value={order}
                onChange={(e) => setOrder(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder={isNew ? 'Added to the end' : 'Unchanged'}
                className={inputCls}
              />
              <span className="font-ui text-[11px] text-text-tertiary">{orderHint}</span>
            </label>

            <div className="flex items-center justify-between">
              <span className="font-ui text-[13px] font-semibold text-text-secondary">Publish live</span>
              <Toggle checked={publishLive} onChange={setPublishLive} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
