'use client';

import type { ReactNode } from 'react';
import { AccountNav } from '@/features/profile/AccountNav';
import { RequireRole } from '@/shared/layout/RequireRole';

/**
 * Área da conta: exige login e mostra a navegação secundária.
 * Não renderiza `<main>`: cada página traz o próprio `PageContainer` (que é o `<main id="conteudo">`).
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole>
      <AccountNav />
      {children}
    </RequireRole>
  );
}
