'use client';

import type { Bracket, Match } from '@nova/schemas';
import { cn, EmptyState, Tabs } from '@nova/ui';
import { GitBranch } from 'lucide-react';
import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { BracketCanvas } from './BracketCanvas';
import { eliminationMatches } from './layout';
import { RoundTabs } from './RoundList';
import { bracketSides, defaultSide, isEliminationFormat } from './rounds';
import { RoundsView } from './RoundsView';
import type { MatchSelection, SlotExtension } from './types';
import { useMatchDetail } from './useMatchDetail';

export interface BracketViewProps extends MatchSelection, SlotExtension {
  bracket: Bracket;
  /**
   * `auto` (padrão): SVG a partir de 768 px, lista por rodada com abas abaixo disso.
   * `canvas` e `list` forçam uma das duas (prévia da organização, testes).
   */
  mode?: 'auto' | 'canvas' | 'list';
  /** Conteúdo extra no detalhe que a própria chave abre (ignorado com `onMatchSelect`). */
  renderMatchDetail?: (match: Match) => ReactNode;
  className?: string;
}

const WIDE_QUERY = '(min-width: 48rem)';

/** A partir de 768 px (`md:`). No servidor e na primeira pintura vale o celular (mobile primeiro). */
function useIsWide(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window.matchMedia !== 'function') return () => {};
    const mql = window.matchMedia(WIDE_QUERY);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY).matches : false),
    () => false,
  );
}

/**
 * Chave eliminatória (simples, equipe x equipe e dupla, com chave de perdedores, Grande Final,
 * reset e disputa de 3º lugar). Desktop/tablet: SVG com zoom e arrastar. Celular: lista por
 * rodada com abas. Formatos sem árvore são entregues ao `RoundsView`.
 */
export function BracketView({ bracket, mode = 'auto', highlightRegistrationId, onMatchSelect, renderMatchDetail, className, ...slots }: BracketViewProps) {
  const wide = useIsWide();
  const { select, modal } = useMatchDetail(bracket.matches, onMatchSelect, renderMatchDetail);

  if (!isEliminationFormat(bracket.format)) {
    return <RoundsView bracket={bracket} highlightRegistrationId={highlightRegistrationId} onMatchSelect={onMatchSelect} renderMatchDetail={renderMatchDetail} className={className} {...slots} />;
  }

  const matches = eliminationMatches(bracket.matches);
  if (matches.length === 0) {
    return <EmptyState icon={<GitBranch className="size-7" />} title="A chave ainda não foi gerada" description="Os confrontos aparecem aqui quando a organização gerar e confirmar a chave desta fase." className={className} />;
  }

  const canvas = mode === 'canvas' || (mode === 'auto' && wide);
  const sides = bracketSides(matches);
  const label = `Chave com ${matches.length} ${matches.length === 1 ? 'confronto' : 'confrontos'}`;

  return (
    <div className={cn('flex flex-col gap-3', className)} data-testid="bracket-view" data-mode={canvas ? 'canvas' : 'list'}>
      {canvas ? (
        <BracketCanvas matches={matches} label={label} highlightRegistrationId={highlightRegistrationId} onMatchSelect={select} {...slots} />
      ) : sides.length === 1 && sides[0] ? (
        <RoundTabs rounds={sides[0].rounds} label="Rodadas da chave" highlightRegistrationId={highlightRegistrationId} onSelect={select} {...slots} />
      ) : (
        <Tabs
          label="Lados da chave"
          defaultValue={defaultSide(sides, highlightRegistrationId)}
          items={sides.map((side) => ({
            value: side.side,
            label: side.label,
            content: <RoundTabs rounds={side.rounds} label={`Rodadas: ${side.label}`} highlightRegistrationId={highlightRegistrationId} onSelect={select} {...slots} />,
          }))}
        />
      )}
      {modal}
    </div>
  );
}
