'use client';

import { useEffect, useState } from 'react';

/**
 * A hora atual, relida a cada `intervalMs` enquanto `enabled`.
 * Usado pela contagem regressiva do check-in (1 s) e pelo tempo relativo dos cartões (30 s).
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}
