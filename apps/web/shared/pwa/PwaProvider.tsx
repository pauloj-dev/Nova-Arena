'use client';

import { Button } from '@nova/ui';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isPwaEnabled } from './config';

/** URL do service worker servido pela rota `app/serwist/[path]/route.ts`. */
export const SW_URL = '/serwist/sw.js';
const UPDATE_CHECK_MS = 60 * 60_000;

export interface UpdateNoticeProps {
  onUpdate: () => void;
  onLater: () => void;
  updating?: boolean;
}

/** Aviso de versão nova: fica acima da barra inferior no celular e no canto no desktop. Não rouba o foco. */
export function UpdateNotice({ onUpdate, onLater, updating }: UpdateNoticeProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pwa-update"
      className="fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] z-[55] mx-auto flex max-w-md flex-col gap-3 rounded-lg border border-border-strong bg-surface p-4 text-text shadow-lg xs:flex-row xs:items-center md:inset-x-auto md:right-6 md:bottom-6"
    >
      <RefreshCw className="hidden size-5 shrink-0 text-primary-text xs:block" aria-hidden />
      <p className="flex-1 text-sm">
        <strong className="block font-semibold">Nova versão disponível</strong>
        Atualize para usar a versão mais recente da Nova Arena.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={onLater}>
          Depois
        </Button>
        <Button size="sm" loading={updating} onClick={onUpdate}>
          Atualizar
        </Button>
      </div>
    </div>
  );
}

/**
 * Registra o service worker do PWA (issue 105) e avisa quando há uma versão nova esperando.
 * A versão nova só assume quando a pessoa toca em "Atualizar" (o worker espera; ver `sw/sw.ts`).
 *
 * Fica desligado com a API simulada: o MSW ocupa o mesmo escopo (`/`) com o próprio worker (`isPwaEnabled`).
 */
export function PwaProvider() {
  const [waiting, setWaiting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const workerRef = useRef<import('@serwist/window').Serwist | null>(null);

  useEffect(() => {
    if (!isPwaEnabled() || !('serviceWorker' in navigator)) return;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void workerRef.current?.update();
    };

    void import('@serwist/window').then(({ Serwist }) => {
      if (disposed) return;
      const sw = new Serwist(SW_URL, { scope: '/', type: 'classic' });
      workerRef.current = sw;
      // Só há "versão nova" quando já existe uma versão no controle; na primeira instalação não há aviso.
      sw.addEventListener('waiting', () => setWaiting(true));
      sw.addEventListener('controlling', (event) => {
        // A troca foi pedida pelo botão "Atualizar": recarrega para todas as telas usarem a versão nova.
        if (event.isUpdate) window.location.reload();
      });
      void sw.register();
      timer = setInterval(() => void sw.update(), UPDATE_CHECK_MS);
      document.addEventListener('visibilitychange', onVisible);
    });

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!waiting) return null;
  return (
    <UpdateNotice
      updating={updating}
      onLater={() => setWaiting(false)}
      onUpdate={() => {
        setUpdating(true);
        workerRef.current?.messageSkipWaiting();
      }}
    />
  );
}
