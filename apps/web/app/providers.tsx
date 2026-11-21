'use client';

import { ToastProvider } from '@nova/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useState, type ReactNode } from 'react';
import { MockGate } from '@/mocks/MockGate';
import { ApiError } from '@/shared/api/client';
import { PwaProvider } from '@/shared/pwa/PwaProvider';
import { isMockApiEnabled } from '@/shared/api/mode';
import { RealtimeProvider } from '@/shared/realtime/RealtimeProvider';
import { TimeZoneSync } from '@/shared/session/TimeZoneSync';

// Só no protótipo (API simulada): fora do JS inicial de produção (#111).
const DevSwitcher = dynamic(() => import('@/shared/layout/DevSwitcher').then((m) => m.DevSwitcher), { ssr: false });

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
            <TimeZoneSync>{children}</TimeZoneSync>
            {isMockApiEnabled() && <DevSwitcher />}
          </RealtimeProvider>
        </MockGate>
        <PwaProvider />
      </ToastProvider>
    </QueryClientProvider>
  );
}
