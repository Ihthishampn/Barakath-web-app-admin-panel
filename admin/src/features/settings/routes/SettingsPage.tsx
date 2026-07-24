import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner';
import type { SettingsTabId } from '../components/SettingsShell';
import { useContentPages } from '../api/content';
import { VariablesTab } from './VariablesTab';
import { DeliveryTaxTab } from './DeliveryTaxTab';
import { PaymentGatewayTab } from './PaymentGatewayTab';
import { ContentPageTab } from './ContentPageTab';
import { StorefrontTab } from './StorefrontTab';
import { SupportTab } from './SupportTab';

const VALID: SettingsTabId[] = ['variables', 'delivery', 'gateway', 'storefront', 'support', 'content'];

/**
 * `?tab=privacy` / `?tab=terms` were the routes before content pages became
 * dynamic. They may be bookmarked, so map them onto the docs they used to edit.
 */
const LEGACY_TABS: Record<string, string> = {
  privacy: 'privacyPolicy',
  terms: 'termsConditions',
};

/**
 * Settings — single `/settings` route with in-page tabs driven by `?tab=`.
 * Variables · Delivery & tax · Payment gateway · Storefront · Support, then one
 * tab per `content/*` page selected with `?tab=content&id=<docId>`.
 * Create-variant / Add-units are overlay modals inside the Variables tab.
 */
export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const legacyId = raw ? LEGACY_TABS[raw] : undefined;
  const tab: SettingsTabId = legacyId
    ? 'content'
    : raw && VALID.includes(raw as SettingsTabId)
      ? (raw as SettingsTabId)
      : 'variables';

  const { data: pages, loading } = useContentPages();
  const requestedId = legacyId ?? params.get('id');
  // An id that no longer exists (deleted page, stale bookmark) falls back to the
  // first page rather than rendering a dead editor.
  const resolvedId =
    tab === 'content'
      ? (pages.find((p) => p.id === requestedId)?.id ?? (loading ? null : (pages[0]?.id ?? null)))
      : null;

  useEffect(() => {
    if (tab !== 'content' || !resolvedId) return;
    if (raw === 'content' && params.get('id') === resolvedId) return;
    setParams({ tab: 'content', id: resolvedId }, { replace: true });
  }, [tab, resolvedId, raw, params, setParams]);

  switch (tab) {
    case 'delivery':
      return <DeliveryTaxTab />;
    case 'gateway':
      return <PaymentGatewayTab />;
    case 'storefront':
      return <StorefrontTab />;
    case 'support':
      return <SupportTab />;
    case 'content':
      if (!resolvedId) {
        // Either the list is still loading, or there are no content pages at all.
        return loading ? (
          <div className="grid place-items-center py-24">
            <Spinner className="h-7 w-7 text-brand-primary" />
          </div>
        ) : (
          <VariablesTab />
        );
      }
      return <ContentPageTab docId={resolvedId} />;
    case 'variables':
    default:
      return <VariablesTab />;
  }
}
