import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  RiAddLine,
  RiArrowDownLine,
  RiArrowUpLine,
  RiBold,
  RiCloseLine,
  RiDeleteBinLine,
  RiH2,
  RiListUnordered,
  RiLink,
} from '@remixicon/react';
import type { ContentPage, ContentSection, Ts } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { noPermissionTitle, useCanDo } from '@/features/auth/useCan';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import { Toggle } from '@/components/ui/Toggle';
import { cn } from '@/lib/cn';
import { SettingsShell } from '../components/SettingsShell';
import { Card, CardTitle, Field, ToggleRow, inputCls } from '../components/fields';
import {
  deleteContentPage,
  newSectionId,
  saveContentPage,
  slugify,
  useContentPage,
  useContentPages,
  validateSlug,
} from '../api/content';

const PLACEHOLDER = '1. Information we collect. Barakath collects your name, mobile number…';

/** A fresh empty section slotted after everything already in the list. */
function blankSection(existing: ContentSection[]): ContentSection {
  const maxOrder = existing.reduce((m, s) => Math.max(m, s.order ?? 0), 0);
  return { id: newSectionId(), heading: '', body: '', order: maxOrder + 10 };
}

/**
 * The sections to open the editor with. Pages migrated to `sections` use those;
 * a page that still only has the legacy `body` is lifted into a single section
 * so nothing an admin previously wrote disappears from the form. The editor
 * always shows at least one row — there is nothing to type into otherwise.
 */
function seedSections(page: ContentPage | null | undefined): ContentSection[] {
  const stored = page?.sections ?? [];
  if (stored.length) {
    return [...stored].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  const legacy = page?.body ?? '';
  if (legacy.trim()) return [{ id: newSectionId(), heading: '', body: legacy, order: 10 }];
  return [blankSection([])];
}

function toDate(ts: Ts | null | undefined): Date | null {
  if (!ts) return null;
  const anyTs = ts as unknown as { toDate?: () => Date; seconds?: number };
  if (typeof anyTs.toDate === 'function') return anyTs.toDate();
  if (typeof anyTs.seconds === 'number') return new Date(anyTs.seconds * 1000);
  return null;
}

export function ContentPageTab({ docId }: { docId: string }) {
  const [, setParams] = useSearchParams();
  const { data: pages } = useContentPages();
  const { data, loading: l, error } = useContentPage(docId);
  const loading = l && !data;

  const [saving, setSaving] = useState(false);
  // Content pages are direct writes gated on canWrite('settings').
  const canEdit = useCanDo('settings', 'edit');
  const canDelete = useCanDo('settings', 'delete');
  const [seeded, setSeeded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [order, setOrder] = useState('0');
  const [published, setPublished] = useState(false);
  const [sections, setSections] = useState<ContentSection[]>([]);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  // Once the admin touches the slug it stops tracking the title — renaming a
  // live page must never silently move its storefront URL.
  const [slugTouched, setSlugTouched] = useState(false);

  // Re-seed when the selected page changes.
  useEffect(() => {
    setSeeded(false);
    setSlugTouched(false);
    setConfirmRemove(null);
  }, [docId]);

  useEffect(() => {
    if (seeded || loading) return;
    setTitle(data?.title ?? '');
    setSlug(data?.slug ?? '');
    setOrder(String(data?.order ?? 0));
    setPublished(data?.published ?? false);
    setSections(seedSections(data));
    setSeeded(true);
  }, [seeded, loading, data]);

  const lastUpdated = toDate(data?.updatedAt);
  const isSystem = data?.system ?? false;

  const onTitleChange = (v: string) => {
    setTitle(v);
    // Only auto-derive while the page has never been given a slug of its own,
    // i.e. right after "+ New page".
    if (!slugTouched && !data?.slug) setSlug(slugify(v));
  };

  const patchSection = (id: string, patch: Partial<ContentSection>) =>
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const addSection = () => setSections((prev) => [...prev, blankSection(prev)]);

  const removeSection = (id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
    setConfirmRemove(null);
  };

  /** Swap a section with its neighbour. `dir` is -1 for up, +1 for down. */
  const moveSection = (id: string, dir: -1 | 1) =>
    setSections((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      const a = prev[i];
      const b = prev[j];
      if (!a || !b) return prev;
      const next = [...prev];
      next[i] = b;
      next[j] = a;
      return next;
    });

  const hasContent = sections.some((s) => s.heading.trim() || s.body.trim());
  const removeTarget = sections.find((s) => s.id === confirmRemove);

  const onPublish = async () => {
    if (!title.trim()) {
      toast.error('Add a page title.');
      return;
    }
    const slugError = validateSlug(slug, pages, docId);
    if (slugError) {
      toast.error(slugError);
      return;
    }
    const orderNum = Number(order);
    if (!Number.isFinite(orderNum)) {
      toast.error('Order must be a number.');
      return;
    }
    if (published && !hasContent) {
      toast.error('Add some content — every section is empty.');
      return;
    }
    try {
      setSaving(true);
      await saveContentPage(docId, {
        title,
        slug,
        sections,
        order: orderNum,
        published,
      });
      toast.success(published ? 'Published' : 'Saved as draft');
    } catch {
      toast.error('Could not save the page.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    try {
      await deleteContentPage(docId);
      setConfirmDelete(false);
      toast.success('Page deleted');
      // The deleted page's chip is gone — fall back to the first remaining one.
      const next = pages.find((p) => p.id !== docId);
      setParams(next ? { tab: 'content', id: next.id } : { tab: 'variables' }, { replace: true });
    } catch {
      toast.error('Could not delete the page.');
    }
  };

  const action = (
    <Button
      variant="primary"
      className="h-[42px]"
      loading={saving}
      disabled={loading || !canEdit}
      title={canEdit ? undefined : noPermissionTitle('settings', 'edit')}
      onClick={() => void onPublish()}
    >
      {published ? 'Publish' : 'Save draft'}
    </Button>
  );

  return (
    <SettingsShell active="content" activeContentId={docId} action={action}>
      {loading ? (
        <div className="grid place-items-center py-24">
          <Spinner className="h-7 w-7 text-brand-primary" />
        </div>
      ) : error || !data ? (
        <div className="rounded-xl border border-border-subtle bg-surface-card p-8 text-center font-ui text-sm text-text-tertiary">
          Couldn’t load this page. Please refresh.
        </div>
      ) : (
        <div className="flex max-w-[840px] flex-col gap-4">
          <Card>
            <div className="mb-3.5 flex items-center justify-between gap-4">
              <input
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent p-0 font-display text-sm font-bold text-text-primary focus:outline-none"
                aria-label="Page title"
              />
              <span className="flex-none font-ui text-[11px] text-text-tertiary">
                {lastUpdated
                  ? `Last updated ${lastUpdated.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}${
                      data?.version ? ` · v${data.version}` : ''
                    }`
                  : 'Not published yet'}
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {sections.map((s, i) => (
                <div
                  key={s.id}
                  className="overflow-hidden rounded-[10px] border border-border-default"
                >
                  <div className="flex items-center gap-1 border-b border-border-subtle bg-surface-app px-4 py-2">
                    <span className="mr-auto font-ui text-[11px] font-bold text-text-tertiary">
                      Section {i + 1}
                    </span>
                    <button
                      onClick={() => moveSection(s.id, -1)}
                      disabled={i === 0}
                      className="grid h-6 w-6 place-items-center rounded text-text-tertiary hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-tertiary"
                      aria-label="Move section up"
                    >
                      <RiArrowUpLine size={14} />
                    </button>
                    <button
                      onClick={() => moveSection(s.id, 1)}
                      disabled={i === sections.length - 1}
                      className="grid h-6 w-6 place-items-center rounded text-text-tertiary hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-tertiary"
                      aria-label="Move section down"
                    >
                      <RiArrowDownLine size={14} />
                    </button>
                    <button
                      onClick={() => setConfirmRemove(s.id)}
                      // The last section can't go: a page with none has nothing
                      // for the storefront to render.
                      disabled={sections.length === 1}
                      className="grid h-6 w-6 place-items-center rounded text-text-tertiary hover:text-error disabled:opacity-30 disabled:hover:text-text-tertiary"
                      aria-label="Remove section"
                    >
                      <RiCloseLine size={15} />
                    </button>
                  </div>

                  <div className="px-[18px] pt-[18px]">
                    <input
                      value={s.heading}
                      onChange={(e) => patchSection(s.id, { heading: e.target.value })}
                      placeholder="Section heading (optional)"
                      className={cn(inputCls, 'font-bold')}
                      aria-label={`Section ${i + 1} heading`}
                    />
                  </div>

                  {/* Formatting hint bar (markdown is stored as-is). */}
                  <div className="flex items-center gap-3 px-[18px] py-2.5 text-text-tertiary">
                    <RiBold size={16} />
                    <RiH2 size={16} />
                    <RiListUnordered size={16} />
                    <RiLink size={16} />
                    <span className="ml-1 font-ui text-[11px]">Markdown supported</span>
                  </div>

                  <textarea
                    value={s.body}
                    onChange={(e) => patchSection(s.id, { body: e.target.value })}
                    placeholder={PLACEHOLDER}
                    className={cn(
                      inputCls,
                      'min-h-[200px] resize-y rounded-none border-0 px-[18px] pb-[18px] pt-0 leading-[1.7] focus:outline-none',
                    )}
                    aria-label={`Section ${i + 1} body`}
                  />
                </div>
              ))}
            </div>

            <Button variant="outline" size="sm" className="mt-3" onClick={addSection}>
              <RiAddLine size={15} />
              Add section
            </Button>
          </Card>

          <Card>
            <CardTitle>Page settings</CardTitle>
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Field
                    label="Slug"
                    value={slug}
                    onChange={(v) => {
                      setSlugTouched(true);
                      setSlug(v);
                    }}
                    placeholder="privacy-policy"
                    required
                    error={slug ? (validateSlug(slug, pages, docId) ?? undefined) : undefined}
                  />
                  <p className="mt-1.5 font-ui text-[11px] text-text-tertiary">
                    The storefront URL segment. Lowercase letters, digits and hyphens only.
                  </p>
                </div>
                <div>
                  <Field
                    label="Order"
                    value={order}
                    onChange={setOrder}
                    type="number"
                    inputMode="numeric"
                  />
                  <p className="mt-1.5 font-ui text-[11px] text-text-tertiary">
                    Lower numbers come first, in this rail and on the storefront.
                  </p>
                </div>
              </div>

              <ToggleRow
                label="Published"
                hint="Off keeps the page here in the admin but hides it from the storefront."
                divided
              >
                <Toggle checked={published} onChange={setPublished} />
              </ToggleRow>
            </div>
          </Card>

          <Card>
            <CardTitle>Delete page</CardTitle>
            {isSystem ? (
              <p className="font-ui text-[11px] text-text-tertiary">
                {/* Storefront routes link to these three by name, so removing one
                    would break live links — renaming and unpublishing is enough. */}
                Built-in pages can’t be deleted. Turn off “Published” to hide this page from the
                storefront instead.
              </p>
            ) : (
              <>
                <p className="mb-3.5 font-ui text-[11px] text-text-tertiary">
                  Removes the page and its content permanently. This cannot be undone.
                </p>
                <Button
                  variant="outline"
                  className="h-[42px]"
                  disabled={!canDelete}
                  title={canDelete ? undefined : noPermissionTitle('settings', 'delete')}
                  onClick={() => setConfirmDelete(true)}
                >
                  <RiDeleteBinLine size={16} />
                  Delete page
                </Button>
              </>
            )}
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={confirmRemove !== null}
        title={
          removeTarget?.heading.trim()
            ? `Remove “${removeTarget.heading.trim()}”?`
            : 'Remove this section?'
        }
        body="The section and its text are removed from the editor. Nothing changes on the storefront until you save."
        confirmLabel="Remove"
        variant="danger"
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() => {
          if (confirmRemove) removeSection(confirmRemove);
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${data?.title || 'this page'}?`}
        body="The page disappears from the storefront immediately. This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={onDelete}
      />
    </SettingsShell>
  );
}
