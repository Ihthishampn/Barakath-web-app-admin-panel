import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { RiCloseLine, RiCheckLine, RiWalletLine } from '@remixicon/react';
import { Button } from './Button';
import { cn } from '@/lib/cn';
import { cfError } from '@/lib/cfError';

type Variant = 'danger' | 'primary' | 'money' | 'success';

const MEDALLION: Record<Variant, { icon: typeof RiCloseLine; ring: string; fg: string }> = {
  danger: { icon: RiCloseLine, ring: 'bg-error-subtle', fg: 'text-error' },
  primary: { icon: RiCheckLine, ring: 'bg-brand-primary-subtle', fg: 'text-brand-primary' },
  money: { icon: RiWalletLine, ring: 'bg-brand-gold-subtle', fg: 'text-brand-gold-strong' },
  success: { icon: RiCheckLine, ring: 'bg-success-subtle', fg: 'text-success' },
};

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: Variant;
  /** Return a promise to show a spinner until it resolves. */
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Reusable confirm dialog (spec §10). Overlay — never changes the route/breadcrumb.
 * Title/body centered, Cancel left + primary right.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;
  const M = MEDALLION[variant];
  const Icon = M.icon;

  // A rejected onConfirm used to be swallowed here: the dialog just stopped
  // spinning and the operator had no way to tell the write had failed. Handlers
  // that report their own failure swallow it themselves; this is the net that
  // catches everything else, and it never closes the dialog on failure.
  const confirm = async () => {
    try {
      setBusy(true);
      await onConfirm();
    } catch (e) {
      toast.error(cfError(e, `${confirmLabel.toLowerCase()}`));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'var(--scrim)' }}
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[420px] rounded-lg bg-surface-card p-7 text-center shadow-lg"
      >
        <div className={cn('mx-auto grid h-14 w-14 place-items-center rounded-pill', M.ring)}>
          <Icon size={26} className={M.fg} />
        </div>
        <h2 className="mt-4 font-display text-xl font-extrabold tracking-[-0.02em] text-text-primary">{title}</h2>
        {body && <div className="mt-2 font-ui text-sm text-text-secondary">{body}</div>}
        <div className="mt-6 flex gap-3">
          <Button variant="outline" size="lg" block onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={variant === 'danger' ? 'danger' : 'primary'} size="lg" block loading={busy} onClick={confirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
