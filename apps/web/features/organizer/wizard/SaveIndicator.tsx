'use client';

import { AlertCircle, Check, CloudOff, Loader2, PencilLine } from 'lucide-react';
import { formatTime } from '@/shared/lib/datetime';
import type { SaveState } from './useAutosave';

interface SaveIndicatorProps {
  state: SaveState;
  savedAt: string | null;
  /** Campeonato já publicado: não há rascunho automático. */
  manual: boolean;
  dirty: boolean;
  onRetry: () => void;
}

/** "Salvando…" / "Salvo às 20h14": o organizador sempre sabe se o rascunho está guardado. */
export function SaveIndicator({ state, savedAt, manual, dirty, onRetry }: SaveIndicatorProps) {
  let icon = <Check className="size-4" aria-hidden />;
  let text: string;
  if (state === 'saving') {
    icon = <Loader2 className="size-4 animate-spin" aria-hidden />;
    text = 'Salvando…';
  } else if (state === 'error') {
    icon = <AlertCircle className="size-4 text-danger" aria-hidden />;
    text = 'Não foi possível salvar.';
  } else if (manual) {
    icon = dirty ? <PencilLine className="size-4" aria-hidden /> : icon;
    text = dirty ? 'Alterações ainda não salvas' : savedAt ? `Salvo às ${formatTime(savedAt)}` : 'Tudo salvo';
  } else if (state === 'unsaved') {
    icon = <CloudOff className="size-4" aria-hidden />;
    text = 'O rascunho é salvo assim que o campeonato tiver nome';
  } else if (state === 'dirty') {
    icon = <Loader2 className="size-4 animate-spin" aria-hidden />;
    text = 'Salvando…';
  } else {
    text = savedAt ? `Salvo às ${formatTime(savedAt)}` : 'Rascunho salvo';
  }
  return (
    <div className="flex items-center gap-2 text-sm text-muted" data-testid="save-indicator" data-state={state}>
      <p role="status" aria-live="polite" className="flex items-center gap-1.5">
        {icon}
        {text}
      </p>
      {state === 'error' && (
        <button type="button" onClick={onRetry} className="min-h-11 rounded-md px-2 font-semibold text-text underline hover:bg-neutral-soft md:min-h-8">
          Tentar de novo
        </button>
      )}
    </div>
  );
}
