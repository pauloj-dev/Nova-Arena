'use client';

import type { ExtraStatField, MatchType, ScoringRule, Tiebreaker } from '@nova/schemas';

export interface ScoringDraft {
  name: string;
  matchType: MatchType;
  rules: ScoringRule[];
  tiebreakers: Tiebreaker[];
}

export interface ScoringModelEditorProps {
  value: ScoringDraft;
  onChange: (value: ScoringDraft) => void;
  /** Estatísticas extras do jogo (ex.: pênaltis), oferecidas nas regras. */
  extraStats?: ExtraStatField[];
  /** Esconde o campo de nome (quando o modelo é editado dentro de uma fase). */
  hideName?: boolean;
  /** Trava o tipo de partida (dentro de uma fase, ele vem do formato). */
  lockMatchType?: boolean;
  errors?: string[];
}

/** Editor visual de modelo de pontuação com prévia ao vivo. Implementado em F1.7. */
export function ScoringModelEditor(_props: ScoringModelEditorProps) {
  return null;
}

/** Prévia somente leitura de um conjunto de regras ("7 kills + 1º lugar = 10 pts"). Implementado em F1.7. */
export function ScoringPreview(_props: { rules: ScoringRule[]; matchType: MatchType; extraStats?: ExtraStatField[] }) {
  return null;
}
