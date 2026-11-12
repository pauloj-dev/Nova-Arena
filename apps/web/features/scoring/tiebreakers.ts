/** Critérios de desempate (PRD §10.6): nomes em pt-BR, quais valem em cada tipo de partida e as regras de ordem. */
import type { MatchType, Tiebreaker } from '@nova/schemas';
import type { DescribeOptions } from './describe';

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
  const score = opts.scoreLabel?.trim().toLowerCase();
  switch (tiebreaker) {
    case 'points':
      return 'Pontos totais';
    case 'wins':
      return 'Vitórias';
    case 'booyahs':
      return 'Booyahs (vitórias na queda)';
    case 'kills':
      return 'Total de kills';
    case 'score':
      return score ? `Placar feito (${score})` : 'Placar feito (coroas, gols, frames)';
    case 'avgPlacement':
      return 'Melhor colocação média';
    case 'headToHead':
      return 'Confronto direto';
    case 'scoreDiff':
      return score ? `Saldo de ${score}` : 'Saldo do placar';
    case 'lastDropKills':
      return 'Kills na última queda';
    case 'draw':
      return 'Sorteio';
  }
}

/** Observação que acompanha alguns critérios na tela. */
export function tiebreakerHint(tiebreaker: Tiebreaker, matchType?: MatchType): string | null {
  if (tiebreaker === 'points') return 'Sempre o primeiro critério.';
  if (tiebreaker === 'draw') return 'Sempre o último; fica registrado na auditoria.';
  if (matchType && !tiebreakersFor(matchType).includes(tiebreaker)) return 'Não se aplica a este tipo de partida. Desligue para tirar da lista.';
  return null;
}

/** Tira repetidos e desconhecidos, põe "pontos" em primeiro e "sorteio" (se ligado) por último. */
export function normalizeTiebreakers(list: readonly Tiebreaker[]): Tiebreaker[] {
  const seen = new Set<Tiebreaker>();
  const middle: Tiebreaker[] = [];
  for (const t of list) {
    if (!ALL_TIEBREAKERS.includes(t) || seen.has(t)) continue;
    seen.add(t);
    if (t !== 'points' && t !== 'draw') middle.push(t);
  }
  return ['points', ...middle, ...(seen.has('draw') ? (['draw'] as const) : [])];
}

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
