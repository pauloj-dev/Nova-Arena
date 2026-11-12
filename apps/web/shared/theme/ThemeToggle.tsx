'use client';

import { Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { getTheme, setTheme, type Theme } from './theme';

function subscribe(cb: () => void) {
  window.addEventListener('nova-theme', cb);
  return () => window.removeEventListener('nova-theme', cb);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => 'light');
}

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
      className={`flex size-11 items-center justify-center rounded-md hover:bg-neutral-soft ${className ?? ''}`}
    >
      {theme === 'dark' ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
    </button>
  );
}
