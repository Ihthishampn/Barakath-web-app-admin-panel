import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { RiAddLine } from '@remixicon/react';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/Spinner';
import { useCanDo } from '@/features/auth/useCan';
import { createContentPage, useContentPages } from '../api/content';

export type SettingsTabId =
  | 'variables'
  | 'delivery'
  | 'gateway'
  | 'storefront'
  | 'support'
  | 'content';

/**
 * The bespoke tabs. Each one is a hand-built form over a fixed `settings/*`
 * doc, so they stay hardcoded — unlike content pages, which are just rows in
 * `content/*` and are appended to the rail from Firestore.
 */
export const SETTINGS_TABS: { id: SettingsTabId; label: string }[] = [
  { id: 'variables', label: 'Variables' },
  { id: 'delivery', label: 'Delivery & tax' },
  { id: 'gateway', label: 'Payment gateway' },
  { id: 'storefront', label: 'Storefront' },
  { id: 'support', label: 'Support' },
];

const chipCls =
  'inline-flex h-[26px] items-center rounded-pill px-3 font-ui text-[12px] font-semibold transition-colors';
const chipIdle =
  'border border-border-default bg-surface-card text-text-secondary hover:border-brand-primary hover:text-brand-primary';

/**
 * Shared Settings chrome: the "Settings" heading, optional subtitle, a
 * per-tab action button (Save / Publish / Create variant) and the tab rail.
 * Tabs are driven by the `?tab=` query param so the single `/settings` route
 * serves every panel; content pages add `&id=<docId>` to pick which page.
 */
export function SettingsShell({
  active,
  activeContentId,
  subtitle,
  action,
  children,
}: {
  active: SettingsTabId;
  /** Which content page is open — only meaningful when `active` is 'content'. */
  activeContentId?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [, setParams] = useSearchParams();
  const { data: pages } = useContentPages();
  const [creating, setCreating] = useState(false);
  // createContentPage writes a content/* doc, gated on canWrite('settings').
  const canCreatePage = useCanDo('settings', 'edit');

  const onCreate = async () => {
    try {
      setCreating(true);
      const id = await createContentPage();
      // Land the admin straight in the editor for the page they just made.
      setParams({ tab: 'content', id }, { replace: true });
    } catch {
      toast.error('Could not create the page.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="px-7 py-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
            Settings
          </h1>
          {subtitle && <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">{subtitle}</p>}
        </div>
        {action && <div className="flex flex-none gap-2.5">{action}</div>}
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {SETTINGS_TABS.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setParams({ tab: t.id }, { replace: true })}
              className={cn(chipCls, isActive ? 'bg-brand-primary text-white' : chipIdle)}
            >
              {t.label}
            </button>
          );
        })}

        {pages.map((p) => {
          const isActive = active === 'content' && p.id === activeContentId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setParams({ tab: 'content', id: p.id }, { replace: true })}
              className={cn(chipCls, isActive ? 'bg-brand-primary text-white' : chipIdle)}
            >
              {p.title || 'Untitled page'}
              {/* Unpublished pages still live in the rail, so mark the ones the
                  storefront isn't showing. */}
              {!p.published && (
                <span className={cn('ml-1.5 font-normal', isActive ? 'text-white/70' : 'text-text-tertiary')}>
                  Draft
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => void onCreate()}
          disabled={creating || !canCreatePage}
          title={canCreatePage ? undefined : 'You don’t have the settings.edit permission.'}
          className={cn(chipCls, chipIdle, 'gap-1 disabled:opacity-60')}
        >
          {creating ? <Spinner className="h-3 w-3" /> : <RiAddLine size={14} />}
          New page
        </button>
      </div>

      {children}
    </div>
  );
}
