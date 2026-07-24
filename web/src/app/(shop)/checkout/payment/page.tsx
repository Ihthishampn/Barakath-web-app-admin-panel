'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Razorpay now runs inline on /checkout (place order → Razorpay modal → verify),
 * so this standalone step is no longer part of the flow. Redirect any stray
 * navigation back to checkout.
 */
export default function PaymentRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/checkout');
  }, [router]);
  return <div className="min-h-[60vh]" />;
}
