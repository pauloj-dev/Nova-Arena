/**
 * Validação de modelo de pontuação com erro por campo (issue #74). O motor decide o que é válido
 * (`validateScoringModel`); aqui as mensagens dele viram erros por campo (`name`, `rules.0`, `tiebreakers`,
 * `rules`), iguais na tela, na API simulada e na API real.
 */
import { TIEBREAKERS, validateScoringModel } from './scoring';
import type { Rule, ScoringModel, Tiebreaker } from './types';

export interface ScoringDraft {
  name: string;
  matchType: ScoringModel['matchType'];
  rules: Rule[];
  tiebreakers: Tiebreaker[];
}

export const SCORING_NAME_ERROR = 'Informe o nome do modelo.';

/** Mensagens do motor para o modelo em edição. Lista vazia = pode salvar. */
export function validateScoringDraft(draft: ScoringDraft): string[] {
  // O motor também confere identificador e jogo, que o rascunho ainda não tem.
  return validateScoringModel({ id: 'rascunho', gameSlug: 'rascunho', name: draft.name, matchType: draft.matchType, rules: draft.rules, tiebreakers: draft.tiebreakers });
}

const RULE_PREFIX = /^Regra (\d+):\s*(.*)$/;
const capitalize = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

export interface GroupedScoringErrors {
  /** Mensagem do campo de nome, se houver. */
  name: string | null;
  /** Mensagens por índice de regra (base 0), já sem o prefixo "Regra N:". */
  byRule: Record<number, string[]>;
  /** Mensagens sobre os critérios de desempate. */
  tiebreakers: string[];
  /** O resto (ex.: "inclua pelo menos uma regra"). */
  general: string[];
}

export function groupScoringErrors(errors: readonly string[]): GroupedScoringErrors {
  const grouped: GroupedScoringErrors = { name: null, byRule: {}, tiebreakers: [], general: [] };
  for (const message of new Set(errors)) {
    const match = RULE_PREFIX.exec(message);
    if (match) {
      const index = Number(match[1]) - 1;
      (grouped.byRule[index] ??= []).push(capitalize(match[2] ?? ''));
    } else if (message === SCORING_NAME_ERROR) {
      grouped.name = message;
    } else if (/desempate/i.test(message)) {
      grouped.tiebreakers.push(message);
    } else {
      grouped.general.push(message);
    }
  }
  return grouped;
}

/** Mensagens do motor → erros por campo da API (`rules.0`, `name`, `tiebreakers`, `rules`). */
export function scoringFieldErrors(errors: readonly string[]): Record<string, string> {
  const grouped = groupScoringErrors(errors);
  const fields: Record<string, string> = {};
  if (grouped.name) fields.name = grouped.name;
  for (const [index, messages] of Object.entries(grouped.byRule)) {
    if (messages[0]) fields[`rules.${index}`] = messages[0];
  }
  if (grouped.tiebreakers[0]) fields.tiebreakers = grouped.tiebreakers[0];
  if (grouped.general[0]) fields.rules = grouped.general[0];
  return fields;
}

/** "Pontos" é sempre o primeiro critério e "sorteio", quando ligado, o último; sem repetidos nem desconhecidos. */
export function normalizeTiebreakers(list: readonly Tiebreaker[]): Tiebreaker[] {
  const seen = new Set<Tiebreaker>();
  const middle: Tiebreaker[] = [];
  for (const t of list) {
    if (!TIEBREAKERS.includes(t) || seen.has(t)) continue;
    seen.add(t);
    if (t !== 'points' && t !== 'draw') middle.push(t);
  }
  return ['points', ...middle, ...(seen.has('draw') ? (['draw'] as const) : [])];
}
