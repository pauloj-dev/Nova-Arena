'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Acompanha uma media query. No servidor (e na primeira pintura) vale `false`:
 * o layout de celular é o padrão (mobile primeiro).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** A partir de 1024 px (`lg:`), onde os filtros viram barra lateral. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 64rem)');
}
