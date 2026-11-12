'use client';

import { ToastProvider } from '@nova/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { MockGate } from '@/mocks/MockGate';
import { ApiError } from '@/shared/api/client';
import { DevSwitcher } from '@/shared/layout/DevSwitcher';
import { RealtimeProvider } from '@/shared/realtime/RealtimeProvider';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Erros 4xx não melhoram tentando de novo.
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MockGate>
          <RealtimeProvider>
            {children}
            <DevSwitcher />
          </RealtimeProvider>
        </MockGate>
      </ToastProvider>
    </QueryClientProvider>
  );
}
