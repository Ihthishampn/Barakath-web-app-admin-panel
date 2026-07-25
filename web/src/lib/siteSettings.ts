'use client';
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import type {
  ContentPage,
  SettingsAffiliate,
  SettingsAnnouncement,
  SettingsDelivery,
  SettingsReturns,
  SettingsSearchSuggestions,
  SettingsSupport,
} from '@barkath/shared';
import { db } from './firebase';
import { useCollection } from './useCollection';

/** Live single-document subscription for public site settings/content. */
function useDoc<T>(path: string | null): { data: T | null; loading: boolean } {
  const [state, setState] = useState<{ data: T | null; loading: boolean }>({ data: null, loading: true });
  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false });
      return;
    }
    const unsub = onSnapshot(
      doc(db, path),
      (s) => setState({ data: s.exists() ? (s.data() as T) : null, loading: false }),
      () => setState({ data: null, loading: false }),
    );
    return unsub;
  }, [path]);
  return state;
}

/** Support contact details (settings/support), maintained by an admin. */
export function useSupportSettings() {
  return useDoc<SettingsSupport>('settings/support');
}

/** Announcement strip (settings/announcement), maintained by an admin. */
export function useAnnouncement() {
  return useDoc<SettingsAnnouncement>('settings/announcement');
}

/** Quick-search chips (settings/searchSuggestions), maintained by an admin. */
export function useSearchSuggestions() {
  return useDoc<SettingsSearchSuggestions>('settings/searchSuggestions');
}

/** Return policy window (settings/returns), maintained by an admin. */
export function useReturnSettings() {
  return useDoc<SettingsReturns>('settings/returns');
}

/**
 * Delivery day range + fees (settings/delivery), maintained by an admin.
 *
 * The SAME doc checkout quotes from (useStoreSettings), so any delivery promise
 * a product page makes is the one honoured at the bag — there is no second,
 * hardcoded source of truth to drift from.
 */
export function useDeliverySettings() {
  return useDoc<SettingsDelivery>('settings/delivery');
}

/** Withdrawal fee schedule + limits (settings/affiliate), maintained by an admin. */
export function useAffiliateSettings() {
  return useDoc<SettingsAffiliate>('settings/affiliate');
}

/** A legal/content page (content/{id}) — e.g. privacyPolicy, termsConditions. */
export function useContentPage(id: string | null) {
  return useDoc<ContentPage>(id ? `content/${id}` : null);
}

/**
 * Every published content page, in admin-defined `order`.
 *
 * The query filters on `published` only and sorts in memory — combining
 * `where(published)` with `orderBy(order)` would require a composite index,
 * which we deliberately avoid across the storefront.
 *
 * Callers use this to build navigation, so a page an admin creates shows up
 * without a code change.
 */
export function useContentPages(): { pages: ContentPage[]; loading: boolean } {
  const { data, loading } = useCollection<ContentPage>(
    () => query(collection(db, 'content'), where('published', '==', true)),
    [],
  );

  const pages = useMemo(() => [...data].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [data]);

  return { pages, loading };
}

/**
 * A published content page addressed by its url slug rather than its doc id.
 *
 * `slug` is a field, not the doc id, so this resolves off the published list —
 * which also means `loading` stays true until the list arrives and the caller
 * can avoid flashing a not-found state.
 */
export function useContentPageBySlug(slug: string | null): { data: ContentPage | null; loading: boolean } {
  const { pages, loading } = useContentPages();
  const data = useMemo(() => (slug ? (pages.find((p) => p.slug === slug) ?? null) : null), [pages, slug]);
  return { data, loading };
}

/** Digits-only, for tel: and wa.me links. */
export function phoneDigits(phone: string | undefined | null): string {
  return (phone ?? '').replace(/\D/g, '');
}
