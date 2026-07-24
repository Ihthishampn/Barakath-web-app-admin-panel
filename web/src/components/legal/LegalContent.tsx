'use client';
import { Fragment } from 'react';
import type { ContentPage } from '@barkath/shared';
import { useContentPage } from '@/lib/siteSettings';

type LegalContentProps = { fallbackTitle: string } & (
  | { contentId: string }
  /** Already-resolved page (e.g. looked up by slug) plus its own loading flag. */
  | { page: ContentPage | null; loading: boolean }
);

/**
 * Renders a legal/content page from Firestore (authored in the admin panel).
 *
 * Accepts either a `content/{id}` doc id — which it subscribes to itself — or a
 * page the caller already resolved, since slug lookups need the page object
 * (for its title) before they can render anything around this component.
 *
 * A page is a list of `sections` (heading + markdown body). Pages authored
 * before sections existed — or written by anything other than the admin — only
 * have the legacy single-blob `body`, so we fall back to it when `sections` is
 * empty. Both paths go through the same renderer, so they look identical.
 *
 * Section bodies are markdown. We render them with a deliberately minimal,
 * text-only formatter (headings + paragraphs + list items) rather than
 * injecting the stored `bodyHtml` — that keeps admin-authored content from
 * being able to inject markup into the storefront.
 */
export function LegalContent(props: LegalContentProps) {
  const { fallbackTitle } = props;
  // Hooks can't be conditional, so always subscribe — `null` makes it a no-op
  // when the caller handed us a resolved page instead of a doc id.
  const byId = useContentPage('contentId' in props ? props.contentId : null);
  const data = 'page' in props ? props.page : byId.data;
  const loading = 'page' in props ? props.loading : byId.loading;

  if (loading) {
    return <p className="font-ui text-sm text-text-secondary">Loading…</p>;
  }
  if (!data) {
    return (
      <div className="rounded-[12px] border border-dashed border-border bg-surface-card px-6 py-12 text-center">
        <p className="font-display text-base font-extrabold text-text-primary">{fallbackTitle}</p>
        <p className="mt-2 font-ui text-sm text-text-secondary">
          This page isn’t available yet. If you need this information now, our support team can
          help — get in touch and we’ll send it across.
        </p>
      </div>
    );
  }

  const updated = data.updatedAt?.toDate?.();

  return (
    <article className="max-w-[760px] rounded-[12px] border border-border bg-surface-card p-6 sm:p-8">
      <h2 className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-text-primary">{data.title}</h2>
      {updated && (
        <p className="mt-1 font-ui text-[12px] text-text-tertiary">
          Last updated {updated.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      )}
      <div className="mt-5 flex flex-col gap-3">{renderSections(data)}</div>
    </article>
  );
}

/**
 * A page's sections in `order`, falling back to the legacy blob body.
 *
 * Sorting here (rather than trusting document order) keeps display order tied
 * to the admin's `order` field, which is what reordering in the admin writes.
 */
function renderSections(page: ContentPage): React.ReactNode[] {
  const sections = page.sections ?? [];
  if (sections.length === 0) return renderMarkdown(page.body ?? '');

  return [...sections]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((section) => (
      <Fragment key={section.id}>
        {/* A section may be body-only, in which case it gets no heading element. */}
        {section.heading && <h3 className={headingClass(1)}>{section.heading}</h3>}
        {renderMarkdown(section.body ?? '')}
      </Fragment>
    ));
}

/**
 * Heading styling by markdown level, shared with section headings so a page
 * migrated from `# Heading` markdown into a section renders identically.
 */
function headingClass(level: number): string {
  const size = level === 1 ? 'text-[18px]' : level === 2 ? 'text-[16px]' : 'text-[14px]';
  return `font-display ${size} font-extrabold text-text-primary`;
}

/** Minimal markdown: `#`/`##`/`###` headings, `-`/`*` list items, paragraphs. */
function renderMarkdown(body: string): React.ReactNode[] {
  return body
    .split('\n')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((line, i) => {
      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      if (heading) {
        return (
          <h3 key={i} className={headingClass(heading[1]!.length)}>
            {heading[2]!}
          </h3>
        );
      }
      const bullet = /^[-*]\s+(.*)$/.exec(line);
      if (bullet) {
        return (
          <p key={i} className="flex gap-2 font-ui text-[14px] leading-relaxed text-text-secondary">
            <span aria-hidden className="text-text-tertiary">
              •
            </span>
            <span>{bullet[1]}</span>
          </p>
        );
      }
      return (
        <p key={i} className="font-ui text-[14px] leading-relaxed text-text-secondary">
          {line}
        </p>
      );
    });
}
