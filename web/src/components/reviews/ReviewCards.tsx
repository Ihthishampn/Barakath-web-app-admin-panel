import { RiStarFill } from '@remixicon/react';
import type { Review } from '@barkath/shared';
import { reviewStatusClass, reviewStatusLabel } from '@/components/reviews/ReviewForm';

/**
 * The two review card variants, extracted so the product-detail preview and the
 * dedicated reviews page render byte-identical cards. Markup is unchanged from
 * the original inline product-page version.
 */

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <RiStarFill key={i} size={13} className={i < Math.round(rating) ? 'text-brand-gold' : 'text-neutral-300'} />
      ))}
    </span>
  );
}

/** A public (approved) review from another customer. */
export function PublicReviewCard({ review: r }: { review: Review }) {
  return (
    <article className="rounded-2xl border border-border-subtle bg-surface-card p-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-ui text-[14px] font-bold text-text-primary">{r.customerName || 'Verified buyer'}</span>
        <Stars rating={r.rating} />
      </div>
      {r.title && <div className="mb-1 font-ui text-[14px] font-bold text-text-primary">{r.title}</div>}
      {r.body && <p className="font-ui text-[14px] leading-relaxed text-text-secondary">{r.body}</p>}
      {r.photoUrls?.length > 0 && (
        <div className="mt-3 flex gap-2">
          {r.photoUrls.slice(0, 4).map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={u} alt="" className="h-14 w-14 rounded-lg object-cover" />
          ))}
        </div>
      )}
    </article>
  );
}

/** The signed-in author's own review, with a moderation-status badge. */
export function OwnReviewCard({ review: r }: { review: Review }) {
  return (
    <article className="rounded-2xl border border-brand-gold-border bg-brand-gold-subtle/40 p-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-ui text-[14px] font-bold text-text-primary">You</span>
        <Stars rating={r.rating} />
      </div>
      {r.title && <div className="mb-1 font-ui text-[14px] font-bold text-text-primary">{r.title}</div>}
      {r.body && <p className="font-ui text-[14px] leading-relaxed text-text-secondary">{r.body}</p>}
      <span
        className={`mt-3 inline-flex items-center gap-1 rounded-pill px-2.5 py-1 font-ui text-[11px] font-bold ${reviewStatusClass(r.status)}`}
      >
        {reviewStatusLabel(r.status)}
      </span>
    </article>
  );
}
