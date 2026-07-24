import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RiMenuLine } from '@remixicon/react';
import { cn } from '@/lib/cn';

export interface MenuItem {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}

const ROW_H = 36;

/**
 * Row action menu — hamburger trigger (prototype's MenuLine). The menu is
 * portaled to <body> with fixed positioning so it is never clipped by a table's
 * `overflow-hidden`, and it flips upward near the viewport bottom.
 */
export function DropdownMenu({ items, align = 'right' }: { items: MenuItem[]; align?: 'right' | 'left' }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number }>({});

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const menuH = items.length * ROW_H + 8;
    const openUp = window.innerHeight - r.bottom < menuH + 8 && r.top > menuH + 8;
    const p: typeof pos = {};
    if (openUp) p.bottom = window.innerHeight - r.top + 4;
    else p.top = r.bottom + 4;
    if (align === 'right') p.right = window.innerWidth - r.right;
    else p.left = r.left;
    setPos(p);
  }, [open, items.length, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="grid h-7 w-7 place-items-center rounded-sm text-text-tertiary hover:bg-surface-app hover:text-text-secondary"
        aria-label="Row actions"
      >
        <RiMenuLine size={18} />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', ...pos, zIndex: 60 }}
            className="w-44 overflow-hidden rounded-md border border-border-subtle bg-surface-card py-1 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {items.map((item) => (
              <button
                key={item.label}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-4 py-2 text-left font-ui text-[13px] disabled:opacity-40',
                  item.danger ? 'text-error hover:bg-error-subtle' : 'text-text-secondary hover:bg-surface-app',
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
