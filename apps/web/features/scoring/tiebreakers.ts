/** Critérios de desempate (PRD §10.6): nomes em pt-BR, quais valem em cada tipo de partida e as regras de ordem. */
import type { MatchType, Tiebreaker } from '@nova/schemas';
import { getT } from '@/shared/i18n/core';
import type { DescribeOptions } from './describe';
import { messages } from './messages';

/**
 * Todos os critérios que o motor conhece. São os 8 do PRD: `wins`/`booyahs` (nº de vitórias ou de Booyahs)
 * e `score`/`kills` (total a favor) são o mesmo critério com o nome de cada tipo de partida.
 */
export const ALL_TIEBREAKERS: readonly Tiebreaker[] = ['points', 'wins', 'booyahs', 'kills', 'score', 'avgPlacement', 'headToHead', 'scoreDiff', 'lastDropKills', 'draw'];

const BATTLE_ROYALE_TIEBREAKERS: readonly Tiebreaker[] = ['points', 'booyahs', 'kills', 'avgPlacement', 'lastDropKills', 'draw'];
const VERSUS_TIEBREAKERS: readonly Tiebreaker[] = ['points', 'wins', 'scoreDiff', 'score', 'headToHead', 'draw'];

/** Critérios que fazem sentido para o tipo de partida, na ordem sugerida. */
export function tiebreakersFor(matchType: MatchType): readonly Tiebreaker[] {
  return matchType === 'BATTLE_ROYALE' ? BATTLE_ROYALE_TIEBREAKERS : VERSUS_TIEBREAKERS;
}

export function tiebreakerLabel(tiebreaker: Tiebreaker, opts: DescribeOptions = {}): string {
  const t = getT(messages, 'tiebreakers');
  const score = opts.scoreLabel?.trim().toLowerCase();
  if (tiebreaker === 'score' && score) return t('scoreDoJogo', { placar: score });
  if (tiebreaker === 'scoreDiff' && score) return t('scoreDiffDoJogo', { placar: score });
  return t(tiebreaker);
}

/** Observação que acompanha alguns critérios na tela. */
export function tiebreakerHint(tiebreaker: Tiebreaker, matchType?: MatchType): string | null {
  const t = getT(messages, 'tiebreakers');
  if (tiebreaker === 'points') return t('dicaPontos');
  if (tiebreaker === 'draw') return t('dicaSorteio');
  if (matchType && !tiebreakersFor(matchType).includes(tiebreaker)) return t('dicaNaoSeAplica');
  return null;
}

/** Ordem canônica (vem do motor: a API usa a mesma). */
import { normalizeTiebreakers } from '@nova/engine';

export { normalizeTiebreakers };

/** "Pontos" e "sorteio" têm lugar fixo; os demais podem trocar de posição entre si. */
export function isFixedTiebreaker(tiebreaker: Tiebreaker): boolean {
  return tiebreaker === 'points' || tiebreaker === 'draw';
}

/** Move um critério ligado. Posições fixas (primeira e a do sorteio) não são invadidas. */
export function moveTiebreaker(list: readonly Tiebreaker[], tiebreaker: Tiebreaker, to: number): Tiebreaker[] {
  const current = normalizeTiebreakers(list);
  const from = current.indexOf(tiebreaker);
  if (from < 0 || isFixedTiebreaker(tiebreaker)) return current;
  const last = current.includes('draw') ? current.length - 2 : current.length - 1;
  const target = Math.max(1, Math.min(last, to));
  if (target === from) return current;
  const next = [...current];
  next.splice(from, 1);
  next.splice(target, 0, tiebreaker);
  return next;
}

/** Liga ou desliga um critério. Ao ligar, ele entra no fim (antes do sorteio). "Pontos" não desliga. */
export function toggleTiebreaker(list: readonly Tiebreaker[], tiebreaker: Tiebreaker, on: boolean): Tiebreaker[] {
  const current = normalizeTiebreakers(list);
  if (tiebreaker === 'points') return current;
  if (!on) return current.filter((t) => t !== tiebreaker);
  if (current.includes(tiebreaker)) return current;
  return normalizeTiebreakers([...current, tiebreaker]);
}

/** Ordem sugerida para um modelo novo. */
export function defaultTiebreakers(matchType: MatchType): Tiebreaker[] {
  return matchType === 'BATTLE_ROYALE'
    ? ['points', 'booyahs', 'kills', 'avgPlacement', 'lastDropKills', 'draw']
    : ['points', 'scoreDiff', 'score', 'headToHead', 'draw'];
}
