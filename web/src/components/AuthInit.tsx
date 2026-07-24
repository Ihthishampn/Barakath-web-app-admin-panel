'use client';
import { useEffect } from 'react';
import { initAuth } from '@/lib/auth';

/** Boots the Firebase auth listener once, app-wide. */
export function AuthInit() {
  useEffect(() => {
    initAuth();
  }, []);
  return null;
}
