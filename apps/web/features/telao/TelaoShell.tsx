'use client';

import { cn } from '@nova/ui';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { LiveIndicator } from '@/shared/realtime/LiveIndicator';
import { useT } from '@/shared/i18n/react';
import type { Rotation } from './hooks';
import { messages } from './messages';

export interface TelaoShellProps {
  transparent: boolean;
  title: string;
  subtitle?: string;
  /** Rótulo da página atual (grupo, rodada) e posição na rotação. */
  pageLabel?: string;
  pageCount?: number;
  rotation?: Rotation;
  children: ReactNode;
}

const control =
  'flex size-11 items-center justify-center rounded-full border border-border-strong bg-surface text-text hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * Casca do telão: tela cheia, sem o cabeçalho do site, com o nome do campeonato, a fase, o indicador
 * "AO VIVO" e a página da rotação. Com fundo transparente, só os cartões têm fundo (para o OBS).
 * Teclado: ← e → trocam de página; espaço pausa a rotação.
 */
export function TelaoShell({ transparent, title, subtitle, pageLabel, pageCount = 0, rotation, children }: TelaoShellProps) {
  const t = useT(messages, 'TelaoShell');
  useEffect(() => {
    if (!rotation || pageCount <= 1) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.isContentEditable)) return;
      if (event.key === 'ArrowRight') rotation?.next();
      else if (event.key === 'ArrowLeft') rotation?.previous();
      else if (event.key === ' ') {
        event.preventDefault();
        rotation?.togglePause();
      } else return;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rotation, pageCount]);

  const panel = transparent ? 'rounded-xl bg-surface/90 shadow-lg' : '';

  return (
    <div className={cn('flex min-h-dvh flex-col gap-4 p-4 text-text md:gap-6 md:p-8 xl:p-10', transparent ? 'bg-transparent' : 'bg-bg')} data-testid="telao" data-fundo={transparent ? 'transparente' : 'padrao'}>
      <header className={cn('flex flex-wrap items-center justify-between gap-3 md:gap-6', panel, transparent && 'px-5 py-3')}>
        <div className="min-w-0">
          <h1 className="truncate text-2xl leading-tight md:text-4xl xl:text-5xl">{title}</h1>
          {subtitle && <p className="truncate text-base text-muted md:text-xl xl:text-2xl">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {pageLabel && (
            <p className="text-right" data-testid="telao-pagina">
              <span className="block text-lg font-semibold md:text-2xl">{pageLabel}</span>
              {pageCount > 1 && rotation && (
                <span className="tabular block text-sm text-muted md:text-base">
                  {t('pagina', { index: rotation.index + 1, count: pageCount, paused: rotation.paused ? 'sim' : 'nao' })}
                </span>
              )}
            </p>
          )}
          <LiveIndicator className="md:px-3 md:py-1 md:text-sm" />
        </div>
      </header>

      <main id="conteudo" className="flex min-h-0 flex-1 flex-col">
        {children}
      </main>

      {rotation && pageCount > 1 && (
        // Controles só aparecem para quem navega pelo teclado: na transmissão a tela fica limpa.
        <nav aria-label={t('paginas')} className="sr-only flex items-center justify-center gap-2 focus-within:not-sr-only focus-within:fixed focus-within:bottom-4 focus-within:left-1/2 focus-within:-translate-x-1/2">
          <button type="button" className={control} onClick={rotation.previous} aria-label={t('anterior')}>
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button type="button" className={control} onClick={rotation.togglePause} aria-label={t('rotacao', { paused: rotation.paused ? 'sim' : 'nao' })}>
            {rotation.paused ? <Play className="size-5" aria-hidden /> : <Pause className="size-5" aria-hidden />}
          </button>
          <button type="button" className={control} onClick={rotation.next} aria-label={t('proxima')}>
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </nav>
      )}
    </div>
  );
}
