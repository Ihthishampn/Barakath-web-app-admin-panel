import { useRef, useState } from 'react';
import { RiArrowDownSLine, RiLogoutBoxRLine } from '@remixicon/react';
import { Avatar } from '@/components/ui/Avatar';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { useOnClickOutside } from '@/hooks/useOnClickOutside';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ProfileDialog, ChangePasswordDialog, PreferencesDialog } from '@/features/account/AccountDialogs';

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin',
  sub_admin: 'Sub admin',
};

type Dialog = 'profile' | 'password' | 'prefs' | 'logout' | null;

export function ProfileMenu() {
  const { admin, signOut } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);

  if (!admin) return null;

  const openDialog = (d: Dialog) => {
    setOpen(false);
    setDialog(d);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 rounded-md py-1 pl-1 pr-2 hover:bg-surface-app"
      >
        <Avatar name={admin.name} size={30} />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block font-ui text-xs font-bold text-text-primary">{admin.name}</span>
          <span className="mt-0.5 block font-ui text-[10px] text-text-tertiary">
            {ROLE_LABEL[admin.role] ?? admin.role}
          </span>
        </span>
        <RiArrowDownSLine size={16} className="text-text-tertiary" />
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-40 w-52 overflow-hidden rounded-md border border-border-subtle bg-surface-card py-1 shadow-lg">
          <div className="border-b border-border-subtle px-4 py-2.5">
            <p className="font-ui text-sm font-bold text-text-primary">{admin.name}</p>
            <p className="font-ui text-xs text-text-tertiary">{admin.email}</p>
          </div>
          <button onClick={() => openDialog('profile')} className="menu-item">Profile</button>
          <button onClick={() => openDialog('password')} className="menu-item">Change password</button>
          <button onClick={() => openDialog('prefs')} className="menu-item">Preferences</button>
          <button
            onClick={() => openDialog('logout')}
            className="menu-item flex items-center gap-2 border-t border-border-subtle text-error"
          >
            <RiLogoutBoxRLine size={16} /> Log out
          </button>
        </div>
      )}

      {dialog === 'profile' && <ProfileDialog onClose={() => setDialog(null)} />}
      {dialog === 'password' && <ChangePasswordDialog onClose={() => setDialog(null)} />}
      {dialog === 'prefs' && <PreferencesDialog onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog === 'logout'}
        variant="danger"
        title="Log out?"
        body={<>You’ll need to sign in again to access the admin panel.</>}
        confirmLabel="Log out"
        onConfirm={() => signOut()}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
