'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Spin & Win now lives on the combined Rewards page (spin wheel + coupon
 * wallet) under the account area. Redirect any stray navigation there.
 */
export default function SpinRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/account/rewards');
  }, [router]);
  return <div className="min-h-[60vh]" />;
}
