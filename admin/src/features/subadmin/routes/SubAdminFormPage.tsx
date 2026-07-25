import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ALL_ACTIONS_FALSE,
  ALL_ACTIONS_TRUE,
  ADMIN_ROLES,
  MODULE_KEYS,
  type AdminRole,
  type ModuleKey,
  type ModulePermissions,
} from '@barkath/shared';
import { Button } from '@/components/ui/Button';
import { useIsSuperAdmin } from '@/features/auth/useCan';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { cfError } from '@/lib/cfError';
import {
  MODULE_LABELS,
  ROLE_LABELS,
  createSubAdmin,
  emptyModulePermissions,
  fullModulePermissions,
  isModuleEnabled,
  updateSubAdmin,
  useAdmin,
} from '../api/subadmin';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  role?: string;
  permissions?: string;
}

export function SubAdminFormPage() {
  const navigate = useNavigate();
  // createSubAdmin / updateSubAdmin call requireSuperAdmin.
  const isSuper = useIsSuperAdmin();
  const { id } = useParams();
  const isEdit = !!id;
  const { data: admin, loading } = useAdmin(id ?? null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<AdminRole>('sub_admin');
  const [perms, setPerms] = useState<ModulePermissions>(() => emptyModulePermissions());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Seed the form from the loaded admin doc (edit mode).
  useEffect(() => {
    if (!isEdit || seeded || !admin) return;
    setName(admin.name);
    setEmail(admin.email);
    setPhone(admin.phone ?? '');
    setRole(admin.role);
    setPerms(admin.modulePermissions ?? emptyModulePermissions());
    setSeeded(true);
  }, [isEdit, seeded, admin]);

  const superAdmin = role === 'super_admin';
  // A super-admin implicitly holds every module; the matrix is shown all-on & locked.
  const effectivePerms = useMemo(() => (superAdmin ? fullModulePermissions() : perms), [superAdmin, perms]);

  const toggleModule = (key: ModuleKey, on: boolean) => {
    setPerms((prev) => ({ ...prev, [key]: { ...(on ? ALL_ACTIONS_TRUE : ALL_ACTIONS_FALSE) } }));
    setErrors((e) => ({ ...e, permissions: undefined }));
  };

  const validate = (): boolean => {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = 'Name is required.';
    if (!email.trim()) next.email = 'Email is required.';
    else if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email.';
    if (!isEdit && !password) next.password = 'Password is required.';
    else if (!isEdit && password.length < 8) next.password = 'Use at least 8 characters.';
    if (!role) next.role = 'Role is required.';
    if (role === 'sub_admin' && !MODULE_KEYS.some((k) => isModuleEnabled(perms, k)))
      next.permissions = 'Enable at least one module.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async () => {
    if (!validate()) return;
    setSaving(true);
    const base = {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || null,
      role,
      modulePermissions: effectivePerms,
    };
    try {
      if (isEdit && id) {
        await updateSubAdmin(id, base);
        toast.success('Admin updated');
      } else {
        await createSubAdmin({ ...base, password });
        toast.success('Admin created');
      }
      navigate('/sub-admin');
    } catch (e) {
      toast.error(cfError(e, isEdit ? 'update this admin' : 'create this admin'));
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && loading && !admin) {
    return <div className="grid place-items-center py-24"><Spinner className="h-7 w-7 text-brand-primary" /></div>;
  }
  if (isEdit && !loading && !admin) {
    return (
      <div className="px-7 py-6">
        <p className="font-ui text-sm text-text-tertiary">Admin not found.</p>
        <button onClick={() => navigate('/sub-admin')} className="mt-3 font-ui text-[13px] font-semibold text-brand-primary hover:underline">‹ Back to sub admins</button>
      </div>
    );
  }

  return (
    <div className="px-7 py-6">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
          {isEdit ? 'Edit sub admin' : 'Create sub admin'}
        </h1>
        <div className="flex gap-2.5">
          <Button variant="outline" className="h-[42px]" onClick={() => navigate('/sub-admin')} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="h-[42px]"
            loading={saving}
            disabled={!isSuper}
            title={isSuper ? undefined : 'Only super admins can manage admins.'}
            onClick={() => void onSubmit()}
          >
            {isEdit ? 'Save changes' : 'Create admin'}
          </Button>
        </div>
      </div>

      <div className="grid max-w-[900px] grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Details */}
        <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
          <div className="mb-3.5 font-display text-sm font-bold text-text-primary">Details</div>
          <div className="flex flex-col gap-3.5">
            <Field label="Full name" required error={errors.name}>
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }}
                placeholder="Name"
                className={inputCls(!!errors.name)}
              />
            </Field>

            <Field label="Email" required error={errors.email}>
              <input
                type="email"
                value={email}
                disabled={isEdit}
                onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })); }}
                placeholder="name@barakath.com"
                className={inputCls(!!errors.email)}
              />
            </Field>

            {!isEdit && (
              <Field label="Password" required error={errors.password}>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: undefined })); }}
                  placeholder="Min. 8 characters"
                  className={inputCls(!!errors.password)}
                />
              </Field>
            )}

            <Field label="Phone">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 00000"
                className={inputCls(false)}
              />
            </Field>

            <Select
              label="Role"
              required
              value={role}
              onChange={(v) => { setRole(v as AdminRole); setErrors((x) => ({ ...x, role: undefined, permissions: undefined })); }}
              options={ADMIN_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
              error={errors.role}
            />
          </div>
        </div>

        {/* Module permissions */}
        <div className="rounded-xl border border-border-subtle bg-surface-card p-5">
          <div className="mb-1.5 font-display text-sm font-bold text-text-primary">Module permissions</div>
          <div className="mb-2.5 font-ui text-xs text-text-tertiary">
            {superAdmin ? 'Super admins have full access to every module.' : 'Set individually for this admin'}
          </div>
          {errors.permissions && <div className="mb-2 font-ui text-xs text-error">{errors.permissions}</div>}
          <div className="max-h-[340px] overflow-auto">
            {MODULE_KEYS.map((key) => (
              <div
                key={key}
                className="flex items-center justify-between border-b border-border-subtle px-3.5 py-2.5 last:border-b-0"
              >
                <span className="font-ui text-[13px] font-semibold text-text-primary">{MODULE_LABELS[key]}</span>
                <Toggle
                  checked={isModuleEnabled(effectivePerms, key)}
                  disabled={superAdmin || saving}
                  onChange={(v) => toggleModule(key, v)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Local helpers ───────────────────────────────────────────────────
function inputCls(hasError: boolean): string {
  return cn(
    'h-[42px] w-full rounded-sm border bg-surface-card px-3.5 font-ui text-[13px] text-text-primary',
    'placeholder:text-text-tertiary focus:outline-none disabled:opacity-60',
    hasError ? 'border-error focus:border-error' : 'border-border-default focus:border-brand-primary',
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-ui text-xs font-bold text-text-primary">
        {label}
        {required && <span className="text-error"> *</span>}
      </span>
      {children}
      {error && <span className="font-ui text-xs text-error">{error}</span>}
    </label>
  );
}
