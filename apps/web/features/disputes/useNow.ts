'use client';

import { useEffect, useState } from 'react';

/** O instante atual, atualizado a cada `intervalMs` — para prazos que vencem com a tela aberta. */
export function useNow(intervalMs = 15_000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}
