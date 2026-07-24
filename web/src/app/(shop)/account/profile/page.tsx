'use client';
import { useEffect, useRef, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { db, storage } from '@/lib/firebase';
import { Button } from '@/components/ui/Button';
import { AccountShell } from '@/components/account/AccountShell';
import { Field, ReadonlyField } from '@/components/account/AccountControls';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ProfilePage() {
  return (
    <AccountShell title="Personal information">
      <ProfileForm />
    </AccountShell>
  );
}

function ProfileForm() {
  const customer = useAuth((s) => s.customer)!; // AccountShell gates on customer

  const [name, setName] = useState(customer.name ?? '');
  const [email, setEmail] = useState(customer.email ?? '');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Avatar upload → Firebase Storage (avatars/{uid}/…) → customers/{uid}.avatarUrl.
  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Please choose an image file.');
    if (file.size > 5 * 1024 * 1024) return toast.error('Image must be under 5 MB.');
    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `avatars/${customer.uid}/avatar_${Date.now()}.${ext}`;
      const snap = await uploadBytes(storageRef(storage, path), file, { contentType: file.type });
      const url = await getDownloadURL(snap.ref);
      await updateDoc(doc(db, 'customers', customer.uid), { avatarUrl: url, updatedAt: serverTimestamp() });
      toast.success('Photo updated.');
    } catch {
      toast.error('Could not update your photo. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  // Keep local edits in sync when the live customer doc updates.
  useEffect(() => {
    setName(customer.name ?? '');
    setEmail(customer.email ?? '');
  }, [customer.name, customer.email]);

  const initial = (name.trim()[0] ?? 'B').toUpperCase();
  const memberSince = customer.createdAt?.toDate?.().getFullYear?.();
  const dirty = name.trim() !== (customer.name ?? '') || email.trim() !== (customer.email ?? '');

  async function save() {
    if (busy) return;
    if (!name.trim()) return toast.error('Please enter your display name.');
    if (email.trim() && !EMAIL_RE.test(email.trim())) return toast.error('That email address looks invalid.');
    setBusy(true);
    try {
      await updateDoc(doc(db, 'customers', customer.uid), {
        name: name.trim(),
        email: email.trim() || null,
        updatedAt: serverTimestamp(),
      });
      toast.success('Profile updated.');
    } catch {
      toast.error('Could not save changes. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-[18px] rounded-2xl border border-border-subtle bg-surface-card p-7">
      <div className="flex items-center gap-4 border-b border-border-subtle pb-5">
        {customer.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={customer.avatarUrl} alt={customer.name || 'Avatar'} className="h-[72px] w-[72px] flex-none rounded-full object-cover" />
        ) : (
          <div className="flex h-[72px] w-[72px] flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-primary to-brand-primary-dark font-display text-[28px] font-extrabold leading-none text-white">
            {initial}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate font-display text-lg font-extrabold text-text-primary">{customer.name || 'Your account'}</div>
          <div className="mt-1 font-ui text-[13px] font-medium text-text-tertiary">
            {memberSince ? `Member since ${memberSince}` : 'Barakath member'}
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="ml-auto flex-none self-start font-ui text-[13px] font-bold text-brand-primary hover:underline disabled:opacity-60"
        >
          {uploading ? 'Uploading…' : 'Edit photo'}
        </button>
      </div>

      <Field label="Display name" placeholder="Mira Osei" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />

      <ReadonlyField label="WhatsApp number" value={customer.phone || 'Verified number'} />

      <Field
        label="Email address"
        type="email"
        inputMode="email"
        placeholder="mira.osei@email.com"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <Button theme="primary" size="l" block onClick={save} disabled={busy || !dirty}>
        {busy ? 'Saving…' : 'Save changes'}
      </Button>
    </div>
  );
}
