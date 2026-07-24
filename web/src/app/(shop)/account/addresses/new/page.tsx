'use client';
import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Timestamp, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import type { CustomerAddress } from '@barkath/shared';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/Button';
import { AccountShell } from '@/components/account/AccountShell';
import { Field } from '@/components/account/AccountControls';
import { ADDRESS_LABELS } from '@/components/account/addressUtils';
import { cn } from '@/lib/cn';

const PIN_RE = /^\d{6}$/;
const PHONE_RE = /^[6-9]\d{9}$/;

export default function AddAddressPage() {
  return (
    <AccountShell>
      <Suspense fallback={<div className="font-ui text-sm text-text-tertiary">Loading…</div>}>
        <AddressForm />
      </Suspense>
    </AccountShell>
  );
}

function AddressForm() {
  const router = useRouter();
  const params = useSearchParams();
  const editId = params.get('id');
  const customer = useAuth((s) => s.customer)!;
  const addresses = useMemo(() => customer.addresses ?? [], [customer.addresses]);
  const existing = editId ? addresses.find((a) => a.id === editId) : undefined;

  const [label, setLabel] = useState<string>(existing?.label ?? 'Home');
  const [name, setName] = useState(existing?.name ?? customer.name ?? '');
  const [phone, setPhone] = useState((existing?.phone ?? customer.phone ?? '').replace(/^\+91\s?/, ''));
  const [line1, setLine1] = useState(existing?.line1 ?? '');
  const [line2, setLine2] = useState(existing?.line2 ?? '');
  const [city, setCity] = useState(existing?.city ?? '');
  const [state, setState] = useState(existing?.state ?? '');
  const [pincode, setPincode] = useState(existing?.pincode ?? '');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const localPhone = phone.replace(/\D/g, '').slice(-10);
  const errors = {
    name: !name.trim() ? 'Required' : null,
    phone: !PHONE_RE.test(localPhone) ? 'Enter a valid 10-digit mobile number' : null,
    line1: !line1.trim() ? 'Required' : null,
    city: !city.trim() ? 'Required' : null,
    state: !state.trim() ? 'Required' : null,
    pincode: !PIN_RE.test(pincode.trim()) ? 'Enter a valid 6-digit pincode' : null,
  };
  const valid = !Object.values(errors).some(Boolean);

  async function save() {
    setTouched(true);
    if (busy) return;
    if (!valid) return toast.error('Please fix the highlighted fields.');
    if (!existing && addresses.length >= 10) return toast.error('You can save up to 10 addresses.');
    setBusy(true);

    const now = Timestamp.now();
    const record: CustomerAddress = {
      id: existing?.id ?? crypto.randomUUID(),
      label,
      name: name.trim(),
      phone: `+91 ${localPhone.slice(0, 5)} ${localPhone.slice(5)}`,
      line1: line1.trim(),
      line2: line2.trim() || null,
      city: city.trim(),
      state: state.trim(),
      pincode: pincode.trim(),
      country: 'India',
      latitude: existing?.latitude ?? null,
      longitude: existing?.longitude ?? null,
      isDefault: existing?.isDefault ?? addresses.length === 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const next = existing ? addresses.map((a) => (a.id === existing.id ? record : a)) : [...addresses, record];

    try {
      await updateDoc(doc(db, 'customers', customer.uid), { addresses: next, updatedAt: serverTimestamp() });
      toast.success(existing ? 'Address updated.' : 'Address saved.');
      router.push('/account/addresses');
    } catch {
      toast.error('Could not save the address.');
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[720px]">
      <h1 className="mb-5 font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">
        {existing ? 'Edit address' : 'Add new address'}
      </h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} error={touched ? errors.name : null} />
        <Field
          label="Mobile number"
          inputMode="numeric"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={touched ? errors.phone : null}
        />
        <div className="sm:col-span-2">
          <Field label="Address line" value={line1} onChange={(e) => setLine1(e.target.value)} error={touched ? errors.line1 : null} />
        </div>
        <Field label="City" value={city} onChange={(e) => setCity(e.target.value)} error={touched ? errors.city : null} />
        <Field label="State" value={state} onChange={(e) => setState(e.target.value)} error={touched ? errors.state : null} />
        <Field
          label="Pincode"
          inputMode="numeric"
          value={pincode}
          onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          error={touched ? errors.pincode : null}
        />
        <Field label="Landmark" optional value={line2} onChange={(e) => setLine2(e.target.value)} />
      </div>

      <div className="mt-5 flex gap-2.5">
        {ADDRESS_LABELS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLabel(l)}
            className={cn(
              'rounded-pill px-4 py-2 font-ui text-[13px] font-bold transition-colors',
              label === l
                ? 'bg-brand-primary text-white'
                : 'border border-border-default text-text-secondary hover:bg-surface-app',
            )}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="mt-6 max-w-[280px]">
        <Button theme="primary" size="l" block onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save address'}
        </Button>
      </div>
    </div>
  );
}
