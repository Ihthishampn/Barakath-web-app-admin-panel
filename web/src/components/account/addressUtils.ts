import type { CustomerAddress } from '@barkath/shared';

/** "42 Marine Drive, Kakkanad, Kochi, Kerala 682001 · +91 98765 43210" */
export function formatAddress(a: CustomerAddress): string {
  const head = [a.line1, a.line2, a.city].filter(Boolean).join(', ');
  const region = [a.state, a.pincode].filter(Boolean).join(' ');
  const location = [head, region].filter(Boolean).join(', ');
  return a.phone ? `${location} · ${a.phone}` : location;
}

export const ADDRESS_LABELS = ['Home', 'Office', 'Other'] as const;
