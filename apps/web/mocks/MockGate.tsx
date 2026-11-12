'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { isMockEnabled } from './handlers';

/**
 * Segura a renderização até a API simulada estar pronta, para nenhuma consulta
 * sair antes do service worker assumir. Com `NEXT_PUBLIC_API_MOCK=none` não faz nada.
 */
export function MockGate({ children }: { children: ReactNode }) {
  const enabled = isMockEnabled();
  const [ready, setReady] = useState(!enabled);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void import('./browser')
      .then((m) => m.startMockApi())
      .catch((error: unknown) => console.error('[mock] não foi possível iniciar a API simulada', error))
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg" role="status" aria-live="polite">
        <span className="font-display text-lg font-bold text-muted">Carregando a Nova Arena…</span>
      </div>
    );
  }
  return <>{children}</>;
}
