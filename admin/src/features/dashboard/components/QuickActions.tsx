import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RiAddLine,
  RiArrowDownSLine,
  RiShoppingBag3Line,
  RiGridLine,
  RiBookmarkLine,
  RiGiftLine,
  RiNotificationLine,
  type RemixiconComponentType,
} from '@remixicon/react';
import { Button } from '@/components/ui/Button';
import { useOnClickOutside } from '@/hooks/useOnClickOutside';
import { useAuthStore } from '@/features/auth/stores/authStore';
import type { ModuleKey } from '@barkath/shared';

interface Action {
  label: string;
  to: string;
  icon: RemixiconComponentType;
  module: ModuleKey;
}

const ACTIONS: Action[] = [
  { label: 'New product', to: '/products/new', icon: RiShoppingBag3Line, module: 'products' },
  { label: 'New category', to: '/categories/new', icon: RiGridLine, module: 'categories' },
  { label: 'New coupon', to: '/coupons/new', icon: RiBookmarkLine, module: 'coupons' },
  { label: 'New campaign', to: '/spinner/new', icon: RiGiftLine, module: 'spinnerCampaigns' },
  { label: 'Send notification', to: '/notifications/create', icon: RiNotificationLine, module: 'notifications' },
];

/** Prototype's top-right "Quick actions" primary button → real action menu. */
export function QuickActions() {
  const navigate = useNavigate();
  const admin = useAuthStore((s) => s.admin);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);

  const allowed = ACTIONS.filter(
    (a) => admin?.role === 'super_admin' || admin?.modulePermissions?.[a.module]?.create,
  );

  return (
    <div ref={ref} className="relative">
      <Button variant="primary" className="h-[42px]" onClick={() => setOpen((o) => !o)}>
        <RiAddLine size={17} />
        Quick actions
        <RiArrowDownSLine size={16} />
      </Button>

      {open && (
        <div className="absolute right-0 top-12 z-40 w-56 overflow-hidden rounded-md border border-border-subtle bg-surface-card py-1 shadow-lg">
          {allowed.length === 0 ? (
            <p className="px-4 py-3 font-ui text-xs text-text-tertiary">No actions available.</p>
          ) : (
            allowed.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.to}
                  onClick={() => {
                    setOpen(false);
                    navigate(a.to);
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left font-ui text-[13px] font-medium text-text-secondary hover:bg-surface-app"
                >
                  <Icon size={16} className="text-text-tertiary" />
                  {a.label}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
