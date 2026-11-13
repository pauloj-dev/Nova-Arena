'use client';

import type { Match } from '@nova/schemas';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { MatchDetailModal } from '@/features/matches/MatchDetailModal';

/**
 * Detalhe da partida aberto pela chave ou pela lista de rodadas.
 * Com `onMatchSelect`, quem usa o componente decide o que fazer e nada é aberto aqui.
 * A partida mostrada é sempre a da lista mais recente: se chegar resultado, o detalhe muda junto.
 */
export function useMatchDetail(matches: readonly Match[], onMatchSelect?: (match: Match) => void, renderMatchDetail?: (match: Match) => ReactNode) {
  const [openId, setOpenId] = useState<string | null>(null);
  const opener = useRef<Element | null>(null);
  const open = useCallback((match: Match) => {
    opener.current = document.activeElement;
    setOpenId(match.id);
  }, []);
  const close = useCallback(() => {
    setOpenId(null);
    // O `Modal` do design system só devolve o foco a elementos HTML. Na chave em SVG o confronto é um
    // `<g>`: sem isto, fechar o detalhe largaria o foco no topo da página (e o teclado perderia o lugar).
    const element = opener.current;
    opener.current = null;
    if (element instanceof SVGElement && element.isConnected) setTimeout(() => element.focus({ preventScroll: true }), 0);
  }, []);
  const current = openId !== null ? (matches.find((m) => m.id === openId) ?? null) : null;
  return {
    select: onMatchSelect ?? open,
    modal: onMatchSelect ? null : (
      <MatchDetailModal match={current} onClose={close}>
        {current && renderMatchDetail?.(current)}
      </MatchDetailModal>
    ),
  };
}
