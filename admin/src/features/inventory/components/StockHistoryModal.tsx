import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RiCloseLine } from '@remixicon/react';
import { Spinner } from '@/components/ui/Spinner';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { getStockHistory, type StockLogEntry } from '../api/inventory';

/** Read-only stock-change ledger for a single product (all its SKUs). */
export function StockHistoryModal({
  productId,
  productName,
  onClose,
}: {
  productId: string;
  productName: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<StockLogEntry[] | null>(null);
  // A failed read used to land on the same empty array as "no history yet", so
  // the modal stated as fact that the ledger was empty — an admin reading that
  // would re-apply corrections that are already recorded. Keep the two apart.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getStockHistory(productId)
      .then((rows) => alive && setEntries(rows))
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setEntries([]);
      });
    return () => {
      alive = false;
    };
  }, [productId]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[80vh] w-full max-w-[620px] flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-card shadow-lg">
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <div>
            <h2 className="font-display text-base font-bold text-text-primary">Stock history</h2>
            <p className="mt-0.5 font-ui text-xs text-text-tertiary">{productName}</p>
          </div>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary">
            <RiCloseLine size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {entries === null ? (
            <div className="grid place-items-center py-16">
              <Spinner className="h-6 w-6 text-brand-primary" />
            </div>
          ) : entries.length === 0 ? (
            <p className="px-5 py-12 text-center font-ui text-[13px] text-text-tertiary">
              {failed ? 'Couldn’t load stock history — close and try again.' : 'No stock changes recorded yet.'}
            </p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['When', 'SKU', 'Change', 'After', 'Reason', 'By'].map((h, i) => (
                    <th
                      key={i}
                      className="sticky top-0 whitespace-nowrap border-b border-border-subtle bg-surface-card px-4 py-2.5 text-left font-ui text-[10px] font-bold uppercase tracking-[0.04em] text-text-tertiary"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-2.5 font-ui text-[12px] text-text-tertiary">
                      {timeAgo(e.createdAt?.toDate?.())}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-2.5 font-ui text-[12px] font-medium text-text-secondary">
                      {e.sku}
                      {e.variantLabel !== '—' && <span className="text-text-tertiary"> · {e.variantLabel}</span>}
                    </td>
                    <td className={cn('whitespace-nowrap border-b border-border-subtle px-4 py-2.5 font-display text-[13px] font-bold', e.delta > 0 ? 'text-success' : 'text-error')}>
                      {e.delta > 0 ? `+${e.delta}` : e.delta}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-2.5 font-ui text-[13px] font-bold text-text-primary">
                      {e.after}
                    </td>
                    <td className="border-b border-border-subtle px-4 py-2.5 font-ui text-[12px] text-text-secondary">
                      {e.reason}
                      {e.reference && <span className="text-text-tertiary"> · {e.reference}</span>}
                    </td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-4 py-2.5 font-ui text-[12px] text-text-tertiary">
                      {e.adminName}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
