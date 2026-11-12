import { EngineError } from '../errors';
import type { MatchNode, StageState, StageStructure } from '../types';

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

function swissNodes(round: number, pairs: ReadonlyArray<readonly [string, string]>, bye: string | null, bestOf: number): MatchNode[] {
  const base = {
    round,
    bracket: null,
    groupId: null,
    kind: 'DUEL' as const,
    bestOf,
    nextMatchId: null,
    loserNextMatchId: null,
    roundLabel: `Rodada ${round}`,
  };
  const nodes: MatchNode[] = pairs.map(([a, b], i) => ({
    ...base,
    id: `sw-r${round}-m${i + 1}`,
    position: i + 1,
    slots: [{ entrantId: a }, { entrantId: b }],
  }));
  if (bye !== null) {
    nodes.push({
      ...base,
      id: `sw-r${round}-bye`,
      position: pairs.length + 1,
      slots: [{ entrantId: bye, isBye: true }],
    });
  }
  return nodes;
}

/** Rodada 1: metade de cima contra a metade de baixo (1 x N/2+1). Ímpar: o último folga. */
export function buildSwissFirstRound(ids: readonly string[], bestOf: number): MatchNode[] {
  const bye = ids.length % 2 === 1 ? (ids[ids.length - 1] as string) : null;
  const playing = bye === null ? ids : ids.slice(0, -1);
  const half = playing.length / 2;
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < half; i++) pairs.push([playing[i] as string, playing[i + half] as string]);
  return swissNodes(1, pairs, bye, bestOf);
}

/** Máximo de rodadas sem repetir confronto. */
export function maxSwissRounds(entrantCount: number): number {
  return entrantCount % 2 === 0 ? entrantCount - 1 : entrantCount;
}

const STEP_LIMIT = 200_000;

/**
 * Pareia a lista (já ordenada por pontuação) sem repetir confronto: cada um
 * enfrenta o mais próximo disponível, voltando atrás quando trava.
 */
function pairWithoutRematch(ordered: readonly string[], played: ReadonlySet<string>): Array<[string, string]> | null {
  const n = ordered.length;
  const used = new Array<boolean>(n).fill(false);
  const pairs: Array<[string, string]> = [];
  let steps = 0;
  const solve = (from: number): boolean => {
    let i = from;
    while (i < n && used[i]) i++;
    if (i === n) return true;
    const a = ordered[i] as string;
    used[i] = true;
    for (let j = i + 1; j < n; j++) {
      if (used[j]) continue;
      const b = ordered[j] as string;
      if (played.has(pairKey(a, b))) continue;
      if (++steps > STEP_LIMIT) break;
      used[j] = true;
      pairs.push([a, b]);
      if (solve(i + 1)) return true;
      pairs.pop();
      used[j] = false;
    }
    used[i] = false;
    return false;
  };
  return solve(0) ? pairs : null;
}

/**
 * Gera a próxima rodada do suíço a partir dos resultados (Monrad): pareia quem
 * tem pontuação parecida, sem repetir confronto. Com número ímpar, o bye vai
 * para o pior colocado que ainda não folgou. Quem desistiu ou foi
 * desclassificado fica fora (RN-06).
 */
export function generateSwissRound(structure: StageStructure, state: StageState): StageStructure {
  if (structure.format !== 'SWISS') {
    throw new EngineError('INVALID_CONFIG', 'Só o formato suíço gera rodadas a partir dos resultados.');
  }
  const current = structure.matches.reduce((max, match) => Math.max(max, match.round), 0);
  if (current >= structure.rounds) {
    throw new EngineError('INVALID_CONFIG', 'Todas as rodadas do suíço já foram geradas.');
  }
  const pending = structure.matches.some((match) => match.slots.length === 2 && !state.results[match.id]);
  if (pending) {
    throw new EngineError('STAGE_INCOMPLETE', 'Conclua todas as partidas da rodada atual antes de gerar a próxima.');
  }

  const score = new Map<string, number>();
  const played = new Set<string>();
  const hadBye = new Set<string>();
  for (const entrant of structure.entrants) score.set(entrant.id, 0);
  const add = (id: string, value: number): void => {
    score.set(id, (score.get(id) ?? 0) + value);
  };
  for (const match of structure.matches) {
    const first = match.slots[0]?.entrantId as string;
    if (match.slots.length === 1) {
      hadBye.add(first);
      add(first, 1);
      continue;
    }
    const second = match.slots[1]?.entrantId as string;
    played.add(pairKey(first, second));
    const result = state.results[match.id];
    if (!result || result.voided) continue;
    if (result.draw) {
      add(first, 0.5);
      add(second, 0.5);
    } else if (result.winnerId !== null) {
      add(result.winnerId, 1);
    }
  }

  const ordered = structure.entrants
    .filter((entrant) => state.entrantStatus[entrant.id] === undefined)
    .map((entrant, index) => ({ id: entrant.id, index, score: score.get(entrant.id) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.id);

  if (ordered.length < 2) {
    throw new EngineError('SWISS_PAIRING_IMPOSSIBLE', 'Não há participantes suficientes para uma nova rodada.');
  }

  const bestOf = structure.config.bestOf ?? 1;
  const round = current + 1;
  const impossible = new EngineError(
    'SWISS_PAIRING_IMPOSSIBLE',
    'Não foi possível parear a rodada sem repetir confronto. Reduza o número de rodadas.',
  );

  if (ordered.length % 2 === 0) {
    const pairs = pairWithoutRematch(ordered, played);
    if (!pairs) throw impossible;
    return { ...structure, matches: [...structure.matches, ...swissNodes(round, pairs, null, bestOf)] };
  }

  for (let i = ordered.length - 1; i >= 0; i--) {
    const candidate = ordered[i] as string;
    if (hadBye.has(candidate)) continue;
    const pairs = pairWithoutRematch(
      ordered.filter((id) => id !== candidate),
      played,
    );
    if (pairs) return { ...structure, matches: [...structure.matches, ...swissNodes(round, pairs, candidate, bestOf)] };
  }
  throw impossible;
}
