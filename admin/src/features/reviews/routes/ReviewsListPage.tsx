import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { RiStarFill } from '@remixicon/react';
import type { Review } from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cn } from '@/lib/cn';
import { matchesSearch } from '@/lib/search';
import { useSearchStore } from '@/stores/searchStore';
import { noPermissionTitle, useCan } from '@/features/auth/useCan';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { useProductsList } from '@/features/products/api/products';
import {
  approveReview,
  countReviews,
  rejectReview,
  useReviewsList,
  type ReviewTab,
} from '../api/reviews';

const TABS: { key: ReviewTab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const PAGE = 10;

export function ReviewsListPage() {
  const { data: reviews, loading } = useReviewsList();
  const { data: products } = useProductsList();
  const { query } = useSearchStore();
  const [tab, setTab] = useState<ReviewTab>('pending');
  const [page, setPage] = useState(1);
  const [approve, setApprove] = useState<Review | null>(null);
  const [reject, setReject] = useState<Review | null>(null);
  // adminModerateReview's own gate (requireReviewModeration) accepts EITHER
  // reviews.approve or reviews.edit, so mirror that exactly — a moderator
  // granted only `edit` must still see the buttons.
  const can = useCan();
  const canModerate = can('reviews', 'approve') || can('reviews', 'edit');

  const counts = useMemo(() => countReviews(reviews), [reviews]);
  const nameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);
  const productName = (r: Review) => nameById.get(r.productId) ?? r.productId;

  const rows = useMemo(() => {
    let list = reviews.filter((r) => r.status === tab);
    if (query.trim()) {
      list = list.filter((r) => matchesSearch(query, [r.customerName, productName(r), r.title ?? '', r.body ?? '']));
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviews, tab, query, nameById]);
  const pageRows = paginate(rows, page, PAGE);

  const doApprove = async () => {
    if (!approve) return;
    try {
      await approveReview(approve);
      toast.success('Review published');
      setApprove(null);
    } catch {
      toast.error('Could not approve the review.');
    }
  };

  const doReject = async () => {
    if (!reject) return;
    try {
      await rejectReview(reject);
      toast.success('Review rejected');
      setReject(null);
    } catch {
      toast.error('Could not reject the review.');
    }
  };

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Reviews</h1>
          <p className="mt-1.5 font-ui text-[13px] text-text-tertiary">
            {counts.pending} pending · {counts.approved} approved · {counts.rejected} rejected
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                setPage(1);
              }}
              className={cn(
                'rounded-pill px-3 py-1.5 font-ui text-xs font-bold transition-colors',
                active
                  ? 'bg-brand-primary text-white'
                  : 'border border-border-default bg-surface-card text-text-secondary hover:border-brand-primary hover:text-brand-primary',
              )}
            >
              {t.label} {counts[t.key]}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Customer', 'Product', 'Rating', 'Review', 'Action'].map((h, i) => (
                <th key={i} className="whitespace-nowrap border-b border-border-subtle px-4 py-3 text-left font-ui text-[11px] font-bold uppercase tracking-[0.04em] text-text-tertiary">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && reviews.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center font-ui text-[13px] text-text-tertiary">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center font-ui text-[13px] text-text-tertiary">
                  {reviews.length === 0 ? 'No reviews yet.' : `No ${tab} reviews.`}
                </td>
              </tr>
            ) : (
              pageRows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-surface-app">
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-bold text-text-primary">{r.customerName}</td>
                  <td className="max-w-[180px] border-b border-border-subtle px-4 py-3 font-ui text-[13px] font-medium text-text-secondary">{productName(r)}</td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                    <span className="inline-flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <RiStarFill key={i} size={13} className={i < Math.round(r.rating) ? 'text-brand-gold' : 'text-neutral-300'} />
                      ))}
                    </span>
                  </td>
                  <td className="max-w-[360px] border-b border-border-subtle px-4 py-3">
                    {r.title && <div className="font-ui text-[13px] font-bold text-text-primary">{r.title}</div>}
                    {r.body && <div className="mt-0.5 font-ui text-[13px] leading-relaxed text-text-secondary">{r.body}</div>}
                  </td>
                  <td className="whitespace-nowrap border-b border-border-subtle px-4 py-3">
                    {tab === 'pending' ? (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={!canModerate}
                          title={canModerate ? undefined : noPermissionTitle('reviews', 'approve')}
                          onClick={() => setApprove(r)}
                        >
                          Approve
                        </Button>
                        <button
                          onClick={() => setReject(r)}
                          disabled={!canModerate}
                          title={canModerate ? undefined : noPermissionTitle('reviews', 'approve')}
                          className="font-ui text-xs font-bold text-error hover:underline disabled:opacity-40 disabled:no-underline"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <Badge tone={r.status === 'approved' ? 'success' : 'error'}>
                        {r.status === 'approved' ? 'Published' : 'Rejected'}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && <Pagination page={page} total={rows.length} pageSize={PAGE} onPage={setPage} noun="reviews" />}

      {/* Approve confirm */}
      <ConfirmDialog
        open={!!approve}
        variant="success"
        title="Publish this review?"
        body={
          approve ? (
            <>
              This {approve.rating}-star review by <strong className="text-text-primary">{approve.customerName}</strong> will go live on{' '}
              <strong className="text-text-primary">{productName(approve)}</strong> and update its rating.
            </>
          ) : null
        }
        confirmLabel="Publish review"
        onConfirm={doApprove}
        onCancel={() => setApprove(null)}
      />

      {/* Reject confirm */}
      <ConfirmDialog
        open={!!reject}
        variant="danger"
        title="Reject this review?"
        body={
          reject ? (
            <>
              <strong className="text-text-primary">{reject.customerName}</strong>’s review of{' '}
              <strong className="text-text-primary">{productName(reject)}</strong> will be hidden and won’t appear on the product page.
            </>
          ) : null
        }
        confirmLabel="Reject review"
        onConfirm={doReject}
        onCancel={() => setReject(null)}
      />
    </div>
  );
}
