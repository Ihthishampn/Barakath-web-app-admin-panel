import { useEffect, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { queryClient } from '@/lib/queryClient';
import { initAuthListener } from '@/features/auth/stores/authStore';

export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(() => initAuthListener(), []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="top-right"
        toastOptions={{ style: { fontFamily: 'var(--font-ui)' } }}
      />
    </QueryClientProvider>
  );
}
