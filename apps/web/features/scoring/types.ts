import type { MatchType, ScoringRule, Tiebreaker } from '@nova/schemas';

/** Modelo de pontuação em edição: o que o editor recebe e devolve. */
export interface ScoringDraft {
  name: string;
  matchType: MatchType;
  rules: ScoringRule[];
  tiebreakers: Tiebreaker[];
}

export type RuleType = ScoringRule['type'];
