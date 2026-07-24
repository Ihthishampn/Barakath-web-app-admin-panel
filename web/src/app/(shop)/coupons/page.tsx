'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Coupons now live on the combined Rewards page (spin wheel + coupon wallet)
 * under the account area. Redirect any stray navigation there.
 */
export default function CouponsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/account/rewards');
  }, [router]);
  return <div className="min-h-[60vh]" />;
}
