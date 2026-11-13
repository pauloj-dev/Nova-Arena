import type { Match, MatchParticipant } from '@nova/schemas';
import type { ReactNode } from 'react';

/**
 * Pontos de extensão para a organização (prévia da chave, troca de participantes).
 * A chave do participante não passa nenhum deles.
 */
export interface SlotExtension {
  /** Participante selecionado para a troca: a vaga dele aparece marcada (`aria-pressed`). */
  selectedRegistrationId?: string | null;
  /**
   * Com a prop, cada vaga ocupada vira um botão (clique, Enter ou Espaço).
   * É a troca por clique/teclado: 1º clique seleciona, 2º clique em outra vaga troca.
   */
  onSlotClick?: (registrationId: string, match: Match) => void;
  /**
   * Atributos extras para o elemento de cada vaga ocupada (`<g>` na chave em SVG, `<div>`/`<button>`
   * nas listas): é onde entram os handlers de arrastar-e-soltar (`onPointerDown`, `data-*`, refs do dnd-kit…).
   */
  getSlotProps?: (participant: MatchParticipant, match: Match) => Record<string, unknown>;
  /** Conteúdo extra ao lado de cada vaga. Só nas visões em lista (HTML); a chave em SVG ignora. */
  renderSlotAction?: (participant: MatchParticipant, match: Match) => ReactNode;
}

export interface MatchSelection {
  /** Inscrição de quem está vendo: o caminho dela na chave fica destacado. */
  highlightRegistrationId?: string | null;
  /**
   * Chamado ao clicar ou apertar Enter em um confronto. Sem a prop, o próprio componente abre
   * o detalhe da partida (modal com o `MatchCard` completo).
   */
  onMatchSelect?: (match: Match) => void;
}
