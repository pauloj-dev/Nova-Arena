'use client';

import { useEffect, useState } from 'react';

/** Devolve o valor só depois que ele para de mudar por `delay` ms (busca enquanto digita). */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
