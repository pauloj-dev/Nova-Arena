'use client';

import type { Bracket, Match } from '@nova/schemas';
import { cn, EmptyState } from '@nova/ui';
import { ListOrdered } from 'lucide-react';
import type { ReactNode } from 'react';
import { MatchList, RoundTabs } from './RoundList';
import { stageRounds, type RoundGroup, type StageRoundGroup } from './rounds';
import type { MatchSelection, SlotExtension } from './types';
import { useMatchDetail } from './useMatchDetail';

export interface RoundsViewProps extends MatchSelection, SlotExtension {
  /** Fase de grupos, pontos corridos, suíço ou Battle Royale (formatos sem chave em árvore). */
  bracket: Pick<Bracket, 'format' | 'matches' | 'state'>;
  /** Conteúdo extra no detalhe que o próprio componente abre (ignorado com `onMatchSelect`). */
  renderMatchDetail?: (match: Match) => ReactNode;
  className?: string;
}

const TAB_LABEL: Partial<Record<Bracket['format'], string>> = { BATTLE_ROYALE: 'Quedas da fase', GROUPS: 'Rodadas da fase de grupos', SWISS: 'Rodadas do suíço', ROUND_ROBIN: 'Rodadas' };

/**
 * Partidas de uma fase sem chave em árvore, agrupadas por rodada (ou queda) e, dentro dela,
 * por grupo ou sala. Mesmas regras de acessibilidade da chave: cada partida é um botão com
 * nome completo, as setas andam entre elas e Enter abre o detalhe.
 */
export function RoundsView({ bracket, highlightRegistrationId, onMatchSelect, renderMatchDetail, className, ...slots }: RoundsViewProps) {
  const rounds = stageRounds(bracket.matches);
  const { select, modal } = useMatchDetail(bracket.matches, onMatchSelect, renderMatchDetail);

  if (rounds.length === 0) {
    return <EmptyState icon={<ListOrdered className="size-7" />} title="Nenhuma partida nesta fase ainda" description="As partidas aparecem aqui quando a organização gerar e confirmar a chave da fase." className={className} />;
  }

  const renderRound = (group: RoundGroup) => {
    const round = group as StageRoundGroup;
    const grouped = round.sections.length > 1 || round.sections.some((s) => s.name !== null);
    if (!grouped) return <MatchList matches={round.matches} label={`Partidas: ${round.label}`} highlightRegistrationId={highlightRegistrationId} onSelect={select} {...slots} />;
    return (
      <div className="flex flex-col gap-5">
        {round.sections.map((section) => (
          <section key={section.key} className="flex flex-col gap-2">
            <h5 className="text-sm font-semibold text-muted">{section.name ?? 'Partidas'}</h5>
            <MatchList matches={section.matches} label={`${section.name ?? 'Partidas'}: ${round.label}`} highlightRegistrationId={highlightRegistrationId} onSelect={select} {...slots} />
          </section>
        ))}
      </div>
    );
  };

  return (
    <div className={cn('flex flex-col gap-3', className)} data-testid="rounds-view">
      <RoundTabs rounds={rounds} label={TAB_LABEL[bracket.format] ?? 'Rodadas'} highlightRegistrationId={highlightRegistrationId} onSelect={select} renderRound={renderRound} {...slots} />
      {modal}
    </div>
  );
}
