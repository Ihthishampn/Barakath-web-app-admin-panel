import { useMemo } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import type { ContentPage, ContentSection } from '@barkath/shared';
import { auth, db } from '@/lib/firebase';
import { useLiveCollection, useLiveDoc } from '@/hooks/firestoreCache';

export const CONTENT_PAGES_KEY = 'content:all';

/**
 * Every content page, ordered by the admin-controlled `order`, real-time.
 * Drives both the settings chip rail and the slug-uniqueness check, so the two
 * can never disagree about what exists.
 *
 * Read unordered and sorted in memory (as web and app already do): an
 * `orderBy('order')` query silently omits documents that have no `order` field,
 * and pages written outside this screen (the production bootstrap) have none —
 * they disappeared from the rail entirely and could never be opened or edited.
 */
export function useContentPages() {
  const state = useLiveCollection<ContentPage>(CONTENT_PAGES_KEY, () => collection(db, 'content'));
  const data = useMemo(
    () => [...state.data].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [state.data],
  );
  return { ...state, data };
}

/** A single page by doc id. Pass null before an id is known (no listener). */
export function useContentPage(docId: string | null) {
  return useLiveDoc<ContentPage>(docId ? `content/${docId}` : null);
}

// ── Slug helpers ───────────────────────────────────────────────────
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Derive a URL-safe slug from a title (used to prefill, never to overwrite). */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Validate a slug against the shape the storefront route expects and against
 * every other page. Returns an error message, or null when the slug is fine.
 * `selfId` is excluded so a page never collides with itself.
 */
export function validateSlug(slug: string, pages: ContentPage[], selfId: string): string | null {
  const s = slug.trim();
  if (!s) return 'Add a slug — it’s the storefront URL for this page.';
  if (!SLUG_RE.test(s)) return 'Use lowercase letters, digits and hyphens only.';
  if (pages.some((p) => p.id !== selfId && p.slug === s)) return 'Another page already uses this slug.';
  return null;
}

/** Escape + wrap plain text into paragraph HTML for the stored bodyHtml. */
function toBodyHtml(body: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/**
 * Drop sections the admin left entirely blank and renumber what's left, so
 * `order` stays a clean 10, 20, 30… sequence no matter how the list was
 * reordered in the editor. Every field is coalesced: Firestore rejects
 * `undefined` inside array elements just as it does at the top level.
 */
export function normaliseSections(sections: ContentSection[]): ContentSection[] {
  return sections
    .filter((s) => (s.heading ?? '').trim() !== '' || (s.body ?? '').trim() !== '')
    .map((s, i) => ({
      id: s.id ?? newSectionId(),
      heading: (s.heading ?? '').trim(),
      body: s.body ?? '',
      order: (i + 1) * 10,
    }));
}

/**
 * Flatten sections back into the legacy single-blob `body`. Anything still
 * reading `body` — older storefront builds, exports — keeps working after a
 * sectioned save, which is why `body` is never dropped.
 */
export function sectionsToMarkdown(sections: ContentSection[]): string {
  return sections
    .map((s) => {
      const heading = (s.heading ?? '').trim();
      const body = (s.body ?? '').trim();
      return heading ? `## ${heading}\n${body}`.trimEnd() : body;
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * A collision-free section id. Array indices can't be used: reordering or
 * removing a section would silently reassign one section's id to another's
 * content, and React would reuse the wrong DOM node.
 */
export function newSectionId(): string {
  return `sec_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export interface ContentPageValues {
  title: string;
  slug: string;
  sections: ContentSection[];
  order: number;
  published: boolean;
}

/**
 * Write a content page (direct client write; rules allow admin write on
 * content/* via canWrite('settings')). Bumps `version` off the current stored
 * value and records the editing admin's uid, so the page keeps its edit history
 * counter. `publishedAt` only moves while the page is published — an
 * unpublished page keeps the timestamp of the last version the storefront saw.
 *
 * Every field is coalesced: Firestore rejects `undefined`, and a half-seeded
 * form used to be the easiest way to hit that.
 */
export async function saveContentPage(docId: string, values: ContentPageValues): Promise<void> {
  const ref = doc(db, 'content', docId);
  const snap = await getDoc(ref);
  const prevVersion = snap.exists() ? ((snap.data().version as number) ?? 0) : 0;
  const published = values.published ?? false;
  const sections = normaliseSections(values.sections ?? []);
  // `body` is derived, never authored: keeping it in step with `sections` on
  // every write is what makes the legacy readers safe to leave in place.
  const body = sectionsToMarkdown(sections);
  await setDoc(
    ref,
    {
      id: docId,
      title: values.title.trim(),
      slug: values.slug.trim(),
      sections,
      body,
      bodyHtml: toBodyHtml(body),
      order: Number.isFinite(values.order) ? values.order : 0,
      published,
      version: prevVersion + 1,
      lastEditorUid: auth.currentUser?.uid ?? '',
      ...(published ? { publishedAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * Create a blank page the admin then fills in. It lands unpublished and
 * non-system: only the seeded pages are `system`, and only `system` pages are
 * undeletable. `order` is read fresh from the server rather than from the cached
 * list so two admins creating at once still get distinct slots.
 */
export async function createContentPage(): Promise<string> {
  // Unordered for the same reason as useContentPages: an ordered query would
  // skip pages that carry no `order`, and this scan only needs the maximum.
  const snap = await getDocs(collection(db, 'content'));
  const maxOrder = snap.docs.reduce((m, d) => Math.max(m, (d.data().order as number) ?? 0), 0);

  const ref = doc(collection(db, 'content'));
  // A unique placeholder slug: the doc id guarantees no collision with an
  // existing page while the admin is still deciding on the real one.
  const slug = `page-${ref.id.slice(0, 6).toLowerCase()}`;
  await setDoc(ref, {
    id: ref.id,
    title: 'New page',
    slug,
    // Empty rather than one blank section: the editor seeds a starter row for
    // the admin, and a blank section would only be dropped again on save.
    sections: [],
    body: '',
    bodyHtml: '',
    order: maxOrder + 10,
    published: false,
    system: false,
    version: 0,
    lastEditorUid: auth.currentUser?.uid ?? '',
    publishedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Delete a page. System pages are refused here as well as in the UI — the chip
 * rail is not the only way this could be reached.
 */
export async function deleteContentPage(docId: string): Promise<void> {
  const ref = doc(db, 'content', docId);
  const snap = await getDoc(ref);
  if (snap.exists() && snap.data().system === true) {
    throw new Error('Built-in pages cannot be deleted.');
  }
  await deleteDoc(ref);
}
