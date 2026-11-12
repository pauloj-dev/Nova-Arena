/** Operações puras sobre o rascunho do modelo: criar, trocar o tipo e reordenar regras. */
import type { ExtraStatField, MatchType, ScoringRule, Tiebreaker } from '@nova/schemas';
import { ruleStatOptions } from './describe';
import { defaultTiebreakers } from './tiebreakers';
import type { RuleType, ScoringDraft } from './types';

/** Tabela de colocação no estilo das ligas oficiais (PRD §11.2): 12/9/8/7/6/5/4/3/2/1 e zero do 11º em diante. */
export const LEAGUE_TABLE: Record<string, number> = { '1': 12, '2': 9, '3': 8, '4': 7, '5': 6, '6': 5, '7': 4, '8': 3, '9': 2, '10': 1, '11': 0, '12': 0 };

/** Deixa a tabela com as colocações de 1 a `count`, mantendo os pontos que já existiam. */
export function fillPlacements(table: Record<string, number>, count: number): Record<string, number> {
  const next: Record<string, number> = {};
  const total = Math.max(1, Math.min(100, Math.floor(count)));
  for (let place = 1; place <= total; place += 1) next[String(place)] = table[String(place)] ?? 0;
  return next;
}

function firstStat(matchType: MatchType, extraStats?: ExtraStatField[]): string {
  return ruleStatOptions(matchType, { extraStats })[0]?.key ?? 'score';
}

/**
 * Regra nova, já com valores que fazem sentido para o tipo de partida.
 * Com `existing`, o limite (`CAP`) já nasce apontando para uma estatística que alguma regra pontua.
 */
export function newRule(type: RuleType, matchType: MatchType, extraStats?: ExtraStatField[], existing: readonly ScoringRule[] = []): ScoringRule {
  const stat = firstStat(matchType, extraStats);
  const br = matchType === 'BATTLE_ROYALE';
  switch (type) {
    case 'PER_UNIT':
      return { type, stat, points: 1 };
    case 'TABLE':
      return br ? { type, stat: 'placement', table: { '1': 3 } } : { type, stat, table: { '1': 1 } };
    case 'OUTCOME':
      return { type, win: 3, draw: 1, loss: 0 };
    case 'BONUS':
      return { type, stat, op: 'gte', value: br ? 10 : 3, points: 2 };
    case 'CAP': {
      const scored = existing.find((rule) => rule.type === 'PER_UNIT' || rule.type === 'TABLE' || rule.type === 'BONUS');
      return { type, stat: scored?.stat ?? stat, max: 15 };
    }
    case 'MULTIPLIER':
      return { type, factor: 2, when: { matchIndex: 'last' } };
  }
}

/** Troca o tipo de uma regra, aproveitando a estatística escolhida quando o novo tipo também usa uma. */
export function changeRuleType(rule: ScoringRule, type: RuleType, matchType: MatchType, extraStats?: ExtraStatField[]): ScoringRule {
  if (rule.type === type) return rule;
  const next = newRule(type, matchType, extraStats);
  if ('stat' in rule && 'stat' in next && next.type !== 'TABLE') return { ...next, stat: rule.stat };
  return next;
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** Regras padrão de um modelo novo: BR → kill 1 + Booyah 3; duelo e equipe → 3 / 1 / 0. */
export function defaultRules(matchType: MatchType): ScoringRule[] {
  if (matchType === 'BATTLE_ROYALE') {
    return [
      { type: 'PER_UNIT', stat: 'kills', points: 1 },
      { type: 'TABLE', stat: 'placement', table: { '1': 3 } },
    ];
  }
  return [{ type: 'OUTCOME', win: 3, draw: 1, loss: 0 }];
}

export function newDraft(matchType: MatchType, name = ''): ScoringDraft {
  return { name, matchType, rules: defaultRules(matchType), tiebreakers: defaultTiebreakers(matchType) };
}

/**
 * Troca o tipo de partida do rascunho. Ficam as regras que ainda fazem sentido no novo tipo;
 * se não sobrar nenhuma que pontue, entram as regras padrão. O desempate volta ao padrão do tipo.
 */
export function changeMatchType(draft: ScoringDraft, matchType: MatchType, extraStats?: ExtraStatField[]): ScoringDraft {
  if (draft.matchType === matchType) return draft;
  const allowed = new Set(ruleStatOptions(matchType, { extraStats }).map((s) => s.key));
  const kept = draft.rules.filter((rule) => {
    if (rule.type === 'MULTIPLIER') return true;
    if (rule.type === 'OUTCOME') return matchType !== 'BATTLE_ROYALE';
    return allowed.has(rule.stat);
  });
  const scores = kept.some((rule) => rule.type !== 'CAP' && rule.type !== 'MULTIPLIER');
  const tiebreakers: Tiebreaker[] = defaultTiebreakers(matchType);
  return { ...draft, matchType, rules: scores ? kept : [...defaultRules(matchType), ...kept.filter((r) => r.type === 'MULTIPLIER')], tiebreakers };
}
