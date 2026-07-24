import { useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { RiCloseLine } from '@remixicon/react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { cn } from '@/lib/cn';
import { dateShort } from '@/lib/format';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { AuthError, changeMyPassword, loadAdminDoc } from '@/features/auth/api/auth';
import { ROLE_LABELS, updateSubAdmin } from '@/features/subadmin/api/subadmin';
import { usePrefs } from './prefs';

const inputCls =
  'w-full rounded-sm border border-border-default bg-surface-card px-[13px] py-[11px] font-ui text-[13px] font-medium text-text-primary placeholder:text-text-tertiary focus:border-brand-primary focus:outline-none disabled:bg-surface-app disabled:text-text-tertiary';

function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'var(--scrim)' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex w-full max-w-[440px] flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-card shadow-lg">
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 className="font-display text-base font-bold text-text-primary">{title}</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary"><RiCloseLine size={20} /></button>
        </div>
        <div className="flex flex-col gap-3.5 p-5">{children}</div>
        <div className="flex justify-end gap-2.5 border-t border-border-subtle p-4">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-ui text-xs font-bold text-text-primary">{label}</span>
      {children}
    </label>
  );
}

// ── Profile ────────────────────────────────────────────────────────
export function ProfileDialog({ onClose }: { onClose: () => void }) {
  const admin = useAuthStore((s) => s.admin);
  const setAdmin = useAuthStore((s) => s.setAdmin);
  const [name, setName] = useState(admin?.name ?? '');
  const [phone, setPhone] = useState(admin?.phone ?? '');
  const [saving, setSaving] = useState(false);
  if (!admin) return null;
  const canEdit = admin.role === 'super_admin';

  const save = async () => {
    if (!name.trim()) return toast.error('Name is required.');
    try {
      setSaving(true);
      await updateSubAdmin(admin.uid, {
        name: name.trim(), email: admin.email, phone: phone.trim() || null,
        role: admin.role, modulePermissions: admin.modulePermissions,
      });
      const fresh = await loadAdminDoc(admin.uid);
      if (fresh) setAdmin(fresh);
      toast.success('Profile updated');
      onClose();
    } catch {
      toast.error('Couldn’t update your profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title="My profile"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {canEdit && <Button variant="primary" loading={saving} onClick={save}>Save changes</Button>}
        </>
      }
    >
      <div className="flex items-center gap-3">
        <Avatar name={admin.name} size={48} />
        <div>
          <div className="font-display text-[15px] font-extrabold text-text-primary">{admin.name}</div>
          <div className="mt-0.5 font-ui text-xs text-text-tertiary">{ROLE_LABELS[admin.role]} · member since {dateShort(admin.createdAt?.toDate?.())}</div>
        </div>
      </div>
      <Field label="Name"><input className={inputCls} value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Email"><input className={inputCls} value={admin.email} disabled /></Field>
      <Field label="Phone"><input className={inputCls} value={phone} disabled={!canEdit} placeholder="—" onChange={(e) => setPhone(e.target.value)} /></Field>
      <div className="flex justify-between font-ui text-xs text-text-tertiary">
        <span>Role: <span className="font-semibold text-text-secondary">{ROLE_LABELS[admin.role]}</span></span>
        <span>Last login: {dateShort(admin.lastLoginAt?.toDate?.())}</span>
      </div>
      {!canEdit && <p className="font-ui text-[11px] text-text-tertiary">Ask a super admin to change your name or phone.</p>}
    </Sheet>
  );
}

// ── Change password ────────────────────────────────────────────────
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (next.length < 6) return toast.error('New password must be at least 6 characters.');
    if (next !== confirm) return toast.error('New passwords don’t match.');
    try {
      setBusy(true);
      await changeMyPassword(current, next);
      toast.success('Password changed');
      onClose();
    } catch (e) {
      toast.error(e instanceof AuthError ? e.message : 'Could not change password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Change password"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>Update password</Button>
        </>
      }
    >
      <Field label="Current password"><input className={inputCls} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
      <Field label="New password"><input className={inputCls} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Field label="Confirm new password"><input className={inputCls} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      <p className="font-ui text-[11px] text-text-tertiary">You’ll stay signed in on this device after changing your password.</p>
    </Sheet>
  );
}

// ── Preferences ────────────────────────────────────────────────────
export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const { denseTables, reducedMotion, set } = usePrefs();
  return (
    <Sheet title="Preferences" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <PrefRow label="Compact tables" hint="Tighter row spacing across every list." checked={denseTables} onChange={(v) => set({ denseTables: v })} />
      <PrefRow label="Reduce motion" hint="Turn off transitions and animations." checked={reducedMotion} onChange={(v) => set({ reducedMotion: v })} />
      <p className="font-ui text-[11px] text-text-tertiary">Saved on this device. Changes apply instantly.</p>
    </Sheet>
  );
}

function PrefRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={cn('flex items-center justify-between')}>
      <div>
        <div className="font-ui text-[13px] font-bold text-text-primary">{label}</div>
        <div className="mt-0.5 font-ui text-[11px] text-text-tertiary">{hint}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}
