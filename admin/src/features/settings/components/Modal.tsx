import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { RiCloseLine } from '@remixicon/react';

/** Lightweight centered modal (overlay) used for Create-variant / Add-units. */
export function Modal({
  open,
  title,
  onClose,
  footer,
  children,
  busy,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  busy?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[560px] rounded-xl border border-border-subtle bg-surface-card shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 className="font-display text-lg font-extrabold tracking-[-0.02em] text-text-primary">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="text-text-tertiary hover:text-text-primary"
            aria-label="Close"
          >
            <RiCloseLine size={20} />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2.5 border-t border-border-subtle px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
