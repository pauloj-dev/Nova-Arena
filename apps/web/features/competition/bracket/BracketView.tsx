'use client';

import type { Bracket, Match } from '@nova/schemas';
import { EmptyState } from '@nova/ui';
import { GitBranch } from 'lucide-react';
import { useMediaQuery } from '@/features/tournaments/useMediaQuery';
import { BracketCanvas } from './BracketCanvas';
import { BracketRoundList } from './BracketRoundList';

export interface BracketViewProps {
  bracket: Pick<Bracket, 'format' | 'matches' | 'state'>;
  /** Nome acessível da chave (ex.: "Chave da fase Mata-mata"). */
  label?: string;
  /** Inscrição do participante logado: o caminho dele na chave fica destacado. */
  highlightRegistrationId?: string | null;
  /** Chamado ao escolher uma partida (clique, Enter ou toque). */
  onSelectMatch?: (match: Match) => void;
  /** Força um dos layouts (útil em testes e no Storybook). Padrão: pela largura da tela. */
  layout?: 'auto' | 'canvas' | 'list';
}

/**
 * Chave de eliminação simples ou dupla (PRD §15.5).
 * Telas a partir de 768 px: SVG com zoom e arrastar. Celular: lista por rodada com abas.
 */
export function BracketView({ bracket, label = 'Chave', highlightRegistrationId, onSelectMatch, layout = 'auto' }: BracketViewProps) {
  const wide = useMediaQuery('(min-width: 48rem)');
  if (bracket.state === 'NONE' || bracket.matches.length === 0) {
    return <EmptyState icon={<GitBranch className="size-7" />} title="A chave ainda não foi gerada" description="Quando a organização sortear os confrontos, eles aparecem aqui." />;
  }
  const useCanvas = layout === 'canvas' || (layout === 'auto' && wide);
  return useCanvas ? (
    <BracketCanvas matches={bracket.matches} label={label} highlightRegistrationId={highlightRegistrationId} onSelectMatch={onSelectMatch} />
  ) : (
    <BracketRoundList matches={bracket.matches} label={label} highlightRegistrationId={highlightRegistrationId} onSelectMatch={onSelectMatch} />
  );
}
