import { useEffect, useState } from 'react';

/** Devolve `value` só depois de `ms` sem mudar — para não consultar a API a cada tecla. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
