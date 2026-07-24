'use client';
import { useState } from 'react';
import Link from 'next/link';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { RiMapPinLine, RiBriefcaseLine, RiMapPin2Line, RiEditLine, RiDeleteBinLine, RiAddLine } from '@remixicon/react';
import type { CustomerAddress } from '@barkath/shared';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/Button';
import { AccountShell } from '@/components/account/AccountShell';
import { formatAddress } from '@/components/account/addressUtils';

export default function AddressesPage() {
  return (
    <AccountShell>
      <AddressesBody />
    </AccountShell>
  );
}

function iconFor(label: string) {
  const l = label.toLowerCase();
  if (l.includes('office') || l.includes('work')) return RiBriefcaseLine;
  if (l.includes('home')) return RiMapPinLine;
  return RiMapPin2Line;
}

function AddressesBody() {
  const customer = useAuth((s) => s.customer)!;
  const addresses = customer.addresses ?? [];
  const [deleting, setDeleting] = useState<string | null>(null);

  async function remove(id: string) {
    if (deleting) return;
    if (!confirm('Delete this address?')) return;
    setDeleting(id);
    try {
      await updateDoc(doc(db, 'customers', customer.uid), {
        addresses: addresses.filter((a) => a.id !== id),
        updatedAt: serverTimestamp(),
      });
      toast.success('Address removed.');
    } catch {
      toast.error('Could not delete the address.');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-text-primary">Saved addresses</h1>
        {addresses.length > 0 && addresses.length < 10 && (
          <Link href="/account/addresses/new">
            <Button theme="primary" size="m">
              <RiAddLine size={17} /> Add new address
            </Button>
          </Link>
        )}
      </div>

      {addresses.length === 0 ? (
        <div className="grid max-w-[840px] place-items-center rounded-2xl border border-dashed border-border-default bg-surface-card px-8 py-14 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-brand-primary-subtle text-brand-primary">
            <RiMapPinLine size={26} />
          </div>
          <p className="mt-4 font-display text-lg font-extrabold text-text-primary">No saved addresses yet</p>
          <p className="mt-1.5 max-w-sm font-ui text-sm text-text-secondary">Add a delivery address to check out faster next time.</p>
          <Link href="/account/addresses/new" className="mt-5">
            <Button theme="primary" size="m">
              <RiAddLine size={17} /> Add new address
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid max-w-[840px] gap-4 sm:grid-cols-2">
          {addresses.map((a) => (
            <AddressCard key={a.id} address={a} deleting={deleting === a.id} onDelete={() => void remove(a.id)} />
          ))}
        </div>
      )}
    </>
  );
}

function AddressCard({ address, deleting, onDelete }: { address: CustomerAddress; deleting: boolean; onDelete: () => void }) {
  const Icon = iconFor(address.label);
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-card p-[22px]">
      <div className="flex items-start gap-3.5">
        <span className="mt-0.5 flex-none text-brand-primary">
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-ui text-[15px] font-bold text-text-primary">{address.label}</span>
            {address.isDefault && (
              <span className="rounded-pill bg-brand-primary-subtle px-2 py-1 font-ui text-[10px] font-extrabold tracking-[0.04em] text-brand-primary">
                DEFAULT
              </span>
            )}
          </div>
          <div className="mt-1.5 font-ui text-[13px] font-medium leading-[1.6] text-text-secondary">{formatAddress(address)}</div>
        </div>
        <div className="flex flex-none gap-3.5 text-text-tertiary">
          <Link href={`/account/addresses/new?id=${address.id}`} aria-label="Edit address" className="transition-colors hover:text-brand-primary">
            <RiEditLine size={18} />
          </Link>
          <button type="button" onClick={onDelete} disabled={deleting} aria-label="Delete address" className="transition-colors hover:text-error disabled:opacity-50">
            <RiDeleteBinLine size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
