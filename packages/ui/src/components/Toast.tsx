'use client';

import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';

export type ToastTone = 'success' | 'error' | 'info';
export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Duração em ms. 0 = fica até a pessoa fechar. */
  duration?: number;
}
interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

const toneClasses: Record<ToastTone, string> = {
  success: 'border-primary bg-primary-soft text-primary-soft-text',
  error: 'border-danger bg-danger-soft text-danger-soft-text',
  info: 'border-border-strong bg-surface text-text',
};
const toneIcon = { success: CheckCircle2, error: AlertCircle, info: Info };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { ...toast, id }]);
      const duration = toast.duration ?? (toast.tone === 'error' ? 8000 : 5000);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6" aria-live="polite" role="status">
        {items.map((t) => {
          const tone = t.tone ?? 'info';
          const Icon = toneIcon[tone];
          return (
            <div key={t.id} className={cn('pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border px-4 py-3 shadow-md animate-slide-up', toneClasses[tone])}>
              <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
              <div className="flex-1 text-sm">
                <p className="font-semibold">{t.title}</p>
                {t.description && <p className="mt-0.5">{t.description}</p>}
              </div>
              <button type="button" aria-label="Fechar aviso" onClick={() => dismiss(t.id)} className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-surface/60">
                <X className="size-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast precisa estar dentro de <ToastProvider>.');
  return useMemo(
    () => ({
      toast: push,
      success: (title: string, description?: string) => push({ title, description, tone: 'success' }),
      error: (title: string, description?: string) => push({ title, description, tone: 'error' }),
    }),
    [push],
  );
}
