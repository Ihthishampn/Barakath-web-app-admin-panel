import { useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { Category, Product } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { cn } from '@/lib/cn';
import { cfError } from '@/lib/cfError';
import { useCanView } from '@/features/auth/useCanView';
import { noPermissionTitle, useCanDo } from '@/features/auth/useCan';
import { useCustomersList } from '@/features/customers/api/customers';
import { useProductsList } from '@/features/products/api/products';
import { useCategories } from '@/features/categories/api/categories';
import {
  AUDIENCES,
  BODY_MAX,
  DEEP_LINK_TYPES,
  TITLE_MAX,
  audienceLabel,
  deepLinkNeedsTarget,
  estimateReach,
  isHttpUrl,
  sendBroadcast,
  type BroadcastTemplate,
  type DeepLink,
  type DeepLinkType,
} from '../api/notifications';

const inputCls =
  'w-full rounded-sm border border-border-default bg-surface-card px-[13px] py-[11px] font-ui text-[13px] font-medium text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none';

const fieldLabel = 'font-ui text-xs font-bold text-text-primary';

export function NotificationCreatePage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Estimated reach is derived from the customer roster, but `customers` is
  // gated on the customers module while this screen is gated on notifications.
  // Rules are not filters, so a notifications-only sub-admin must not fire the
  // query at all; the estimate reads as unavailable instead of a confident "0".
  const canViewCustomers = useCanView('customers');
  // adminSendBroadcast calls requireModule(req, 'notifications', 'create').
  const canSend = useCanDo('notifications', 'create');
  const { data: customers } = useCustomersList(canViewCustomers);
  const { data: products } = useProductsList();
  const { data: categories } = useCategories();

  // "Send similar" hands the source broadcast over in router state; the header
  // "+ Create notification" button passes none, so the form starts blank.
  const from = (location.state as { from?: BroadcastTemplate } | null)?.from ?? null;

  const [title, setTitle] = useState(from?.title ?? '');
  const [body, setBody] = useState(from?.body ?? '');
  const [audience, setAudience] = useState(from?.audience ?? 'all');
  const [linkType, setLinkType] = useState<DeepLinkType>(from?.deepLink?.type ?? 'home');
  const [target, setTarget] = useState(from?.deepLink?.target ?? ''); // productId / categoryId / url
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; body?: string; audience?: string; target?: string }>({});

  // Idempotency key for this composed message: a send that dies part-way is
  // retried by hand, and the Cloud Function must resume the same broadcast
  // rather than fan out to everyone already written a second time.
  const requestIdRef = useRef<string>(crypto.randomUUID());

  const reach = useMemo(() => estimateReach(audience, customers), [audience, customers]);

  // Only offer targets the storefront will actually show: a draft/archived or
  // hidden product deep-links to a full product page for an unreleased item,
  // and a hidden category opens an empty grid.
  const productOptions = useMemo(
    () =>
      products
        .filter((p: Product) => p.status === 'published' && p.visibility !== 'hidden' && !p.deletedAt)
        .map((p: Product) => ({ value: p.id, label: p.name })),
    [products],
  );
  const categoryOptions = useMemo(
    () =>
      categories
        .filter((c: Category) => c.visibility !== 'hidden')
        .map((c: Category) => ({ value: c.id, label: c.name })),
    [categories],
  );

  const needsTarget = deepLinkNeedsTarget(linkType);

  const targetLabel = (): string => {
    if (linkType === 'home') return 'Home';
    if (linkType === 'url') return target;
    if (linkType === 'product') return products.find((p) => p.id === target)?.name ?? '';
    if (linkType === 'category') return categories.find((c) => c.id === target)?.name ?? '';
    return '';
  };

  const onChangeLinkType = (t: string) => {
    setLinkType(t as DeepLinkType);
    setTarget('');
    setErrors((e) => ({ ...e, target: undefined }));
  };

  const validate = () => {
    const next: typeof errors = {};
    if (!title.trim()) next.title = 'Title is required.';
    else if (title.length > TITLE_MAX) next.title = `Keep the title under ${TITLE_MAX} characters.`;
    if (!body.trim()) next.body = 'Message is required.';
    else if (body.length > BODY_MAX) next.body = `Keep the message under ${BODY_MAX} characters.`;
    if (!audience) next.audience = 'Choose an audience.';
    if (needsTarget && !target.trim()) {
      next.target = linkType === 'url' ? 'Enter a URL to link to.' : `Choose a ${linkType} to link to.`;
    } else if (linkType === 'url' && !isHttpUrl(target)) {
      // The app only launches http(s) links, so anything else would send a
      // notification whose card does nothing at all when tapped.
      next.target = 'Enter a full https:// URL.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSend = async () => {
    if (!validate()) {
      toast.error('Please fix the highlighted fields.');
      return;
    }
    const deepLink: DeepLink =
      linkType === 'home'
        ? { type: 'home', target: '', label: 'Home' }
        : { type: linkType, target: target.trim(), label: targetLabel() };

    setSending(true);
    try {
      await sendBroadcast({
        title: title.trim(),
        body: body.trim(),
        audience,
        deepLink,
        requestId: requestIdRef.current,
      });
      toast.success('Notification sent');
      navigate('/notifications');
    } catch (e) {
      toast.error(cfError(e, 'send the notification'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
          Create notification
        </h1>
        <div className="flex gap-2.5">
          <Button variant="outline" className="h-[42px]" onClick={() => navigate('/notifications')}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="h-[42px]"
            loading={sending}
            disabled={!canSend}
            title={canSend ? undefined : noPermissionTitle('notifications', 'create')}
            onClick={onSend}
          >
            Send notification
          </Button>
        </div>
      </div>

      <div className="flex max-w-[720px] flex-col gap-4">
        {/* Form */}
        <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
          <div className="flex flex-col gap-3.5">
            {/* Title */}
            <label className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between">
                <span className={fieldLabel}>
                  Title<span className="text-error"> *</span>
                </span>
                <span className={cn('font-ui text-[11px]', title.length > TITLE_MAX ? 'text-error' : 'text-text-tertiary')}>
                  {title.length} / {TITLE_MAX}
                </span>
              </span>
              <input
                value={title}
                maxLength={TITLE_MAX + 20}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setErrors((x) => ({ ...x, title: undefined }));
                }}
                placeholder="Eid sale is live"
                className={cn(inputCls, errors.title && 'border-error focus:border-error')}
              />
              {errors.title && <span className="font-ui text-xs text-error">{errors.title}</span>}
            </label>

            {/* Message */}
            <label className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between">
                <span className={fieldLabel}>
                  Message<span className="text-error"> *</span>
                </span>
                <span className={cn('font-ui text-[11px]', body.length > BODY_MAX ? 'text-error' : 'text-text-tertiary')}>
                  {body.length} / {BODY_MAX}
                </span>
              </span>
              <textarea
                value={body}
                rows={3}
                maxLength={BODY_MAX + 40}
                onChange={(e) => {
                  setBody(e.target.value);
                  setErrors((x) => ({ ...x, body: undefined }));
                }}
                placeholder="Up to 40% off signature oud — shop the Eid edit now."
                className={cn(inputCls, 'resize-y', errors.body && 'border-error focus:border-error')}
              />
              {errors.body && <span className="font-ui text-xs text-error">{errors.body}</span>}
            </label>

            {/* Audience + Deep link */}
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Select
                  label="Audience"
                  required
                  value={audience}
                  onChange={(v) => {
                    setAudience(v);
                    setErrors((x) => ({ ...x, audience: undefined }));
                  }}
                  options={AUDIENCES}
                  error={errors.audience}
                />
                <span className="font-ui text-[11px] text-text-tertiary">
                  Estimated reach:{' '}
                  <span className="font-bold text-text-secondary">
                    {canViewCustomers ? reach.toLocaleString('en-IN') : '—'}
                  </span>{' '}
                  {canViewCustomers ? (reach === 1 ? 'user' : 'users') : 'users'}
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <Select
                  label="Deep link"
                  value={linkType}
                  onChange={onChangeLinkType}
                  options={DEEP_LINK_TYPES}
                />
              </div>
            </div>

            {/* Dependent deep-link target */}
            {needsTarget && (
              <div className="grid grid-cols-1 sm:grid-cols-2">
                {linkType === 'url' ? (
                  <label className="flex flex-col gap-1.5">
                    <span className={fieldLabel}>
                      Link URL<span className="text-error"> *</span>
                    </span>
                    <input
                      value={target}
                      onChange={(e) => {
                        setTarget(e.target.value);
                        setErrors((x) => ({ ...x, target: undefined }));
                      }}
                      placeholder="https://…"
                      className={cn(inputCls, errors.target && 'border-error focus:border-error')}
                    />
                    {errors.target && <span className="font-ui text-xs text-error">{errors.target}</span>}
                  </label>
                ) : (
                  <Select
                    label={linkType === 'product' ? 'Product' : 'Category'}
                    required
                    value={target}
                    onChange={(v) => {
                      setTarget(v);
                      setErrors((x) => ({ ...x, target: undefined }));
                    }}
                    options={linkType === 'product' ? productOptions : categoryOptions}
                    placeholder={linkType === 'product' ? 'Select a product…' : 'Select a category…'}
                    error={errors.target}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Live preview */}
        <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
          <div className="mb-2.5 font-display text-[13px] font-bold text-text-primary">Preview</div>
          <div className="flex gap-3 rounded-[10px] bg-surface-app p-3.5">
            <BrandLogo height={34} withWordmark={false} className="flex-none" />
            <div className="min-w-0">
              <div className="truncate font-ui text-[13px] font-bold text-text-primary">
                {title.trim() || 'Notification title'}
              </div>
              <div className="mt-1 font-ui text-xs leading-relaxed text-text-secondary">
                {body.trim() || 'Your message will appear here.'}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 font-ui text-[11px] text-text-tertiary">
                <span>To {audienceLabel(audience)}</span>
                <span>·</span>
                <span>{needsTarget ? `Opens ${targetLabel() || `${linkType}…`}` : 'Opens Home'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
