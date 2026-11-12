import { EngineError } from '../errors';
import { snakeDistribute } from '../seeding';
import type { Entrant, MatchNode, StageGroup } from '../types';

/** Método do círculo: devolve as rodadas com os pares [mandante, visitante]. Ímpar = um folga por rodada. */
export function roundRobinRounds(ids: readonly string[], doubleRound: boolean): Array<Array<[string, string]>> {
  let ring: Array<string | null> = ids.length % 2 === 0 ? ids.slice() : [...ids, null];
  const n = ring.length;
  const rounds: Array<Array<[string, string]>> = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < n / 2; i++) {
      const a = ring[i] as string | null;
      const b = ring[n - 1 - i] as string | null;
      if (a === null || b === null) continue;
      // Alterna o mando do participante fixo para equilibrar.
      pairs.push(i === 0 && r % 2 === 1 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    ring = [ring[0] as string | null, ring[n - 1] as string | null, ...ring.slice(1, n - 1)];
  }
  if (!doubleRound) return rounds;
  return [...rounds, ...rounds.map((pairs) => pairs.map(([a, b]): [string, string] => [b, a]))];
}

export function buildRoundRobin(
  ids: readonly string[],
  options: { bestOf: number; doubleRound: boolean; groupId: string | null; idPrefix: string },
): { matches: MatchNode[]; rounds: number } {
  const rounds = roundRobinRounds(ids, options.doubleRound);
  const matches: MatchNode[] = [];
  rounds.forEach((pairs, r) => {
    pairs.forEach(([a, b], i) => {
      matches.push({
        id: `${options.idPrefix}-r${r + 1}-m${i + 1}`,
        round: r + 1,
        position: i + 1,
        bracket: null,
        groupId: options.groupId,
        kind: 'DUEL',
        slots: [{ entrantId: a }, { entrantId: b }],
        bestOf: options.bestOf,
        nextMatchId: null,
        loserNextMatchId: null,
        roundLabel: `Rodada ${r + 1}`,
      });
    });
  });
  return { matches, rounds: rounds.length };
}

/** Quedas de uma sala/grupo BR: uma partida `LOBBY` por queda, com todos os participantes. */
export function buildLobbyDrops(
  ids: readonly string[],
  options: { drops: number; dropMultipliers: readonly number[]; groupId: string; idPrefix: string; position: number },
): MatchNode[] {
  const matches: MatchNode[] = [];
  for (let drop = 1; drop <= options.drops; drop++) {
    matches.push({
      id: `${options.idPrefix}-q${drop}`,
      round: drop,
      position: options.position,
      bracket: null,
      groupId: options.groupId,
      kind: 'LOBBY',
      slots: ids.map((id) => ({ entrantId: id })),
      bestOf: 1,
      nextMatchId: null,
      loserNextMatchId: null,
      dropIndex: drop,
      multiplier: options.dropMultipliers[drop - 1] ?? 1,
      roundLabel: `Queda ${drop}`,
    });
  }
  return matches;
}

/** A, B, …, Z, AA, AB… */
export function groupLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export function buildGroups(
  entrants: readonly Entrant[],
  options: {
    groupCount: number;
    groupMode: 'ROUND_ROBIN' | 'BATTLE_ROYALE';
    bestOf: number;
    doubleRound: boolean;
    drops: number;
    dropMultipliers: readonly number[];
  },
): { groups: StageGroup[]; matches: MatchNode[]; rounds: number } {
  const { groupCount } = options;
  if (!Number.isInteger(groupCount) || groupCount < 1 || groupCount > Math.floor(entrants.length / 2)) {
    throw new EngineError('INVALID_CONFIG', 'Cada grupo precisa de ao menos 2 participantes. Reduza o número de grupos.');
  }
  const buckets = snakeDistribute(entrants.map((e) => e.id), groupCount);
  const groups: StageGroup[] = buckets.map((entrantIds, i) => ({
    id: `g${i + 1}`,
    name: `Grupo ${groupLetter(i)}`,
    entrantIds,
  }));
  const perGroup: MatchNode[][] = [];
  let rounds = 0;
  groups.forEach((group, i) => {
    if (options.groupMode === 'BATTLE_ROYALE') {
      perGroup.push(
        buildLobbyDrops(group.entrantIds, {
          drops: options.drops,
          dropMultipliers: options.dropMultipliers,
          groupId: group.id,
          idPrefix: group.id,
          position: i + 1,
        }),
      );
      rounds = options.drops;
    } else {
      const built = buildRoundRobin(group.entrantIds, {
        bestOf: options.bestOf,
        doubleRound: options.doubleRound,
        groupId: group.id,
        idPrefix: group.id,
      });
      perGroup.push(built.matches);
      rounds = Math.max(rounds, built.rounds);
    }
  });
  // Ordena por rodada e depois por grupo, para a agenda sair na ordem em que se joga.
  const matches = perGroup
    .flat()
    .map((match, index) => ({ match, index }))
    .sort((a, b) => a.match.round - b.match.round || a.index - b.index)
    .map((item) => item.match);
  return { groups, matches, rounds };
}

export function buildBattleRoyale(
  entrants: readonly Entrant[],
  options: { lobbySize: number; drops: number; dropMultipliers: readonly number[] },
): { groups: StageGroup[]; matches: MatchNode[]; rounds: number } {
  const lobbyCount = Math.ceil(entrants.length / options.lobbySize);
  const buckets = snakeDistribute(entrants.map((e) => e.id), lobbyCount);
  const groups: StageGroup[] = buckets.map((entrantIds, i) => ({ id: `s${i + 1}`, name: `Sala ${i + 1}`, entrantIds }));
  const matches: MatchNode[] = [];
  for (let drop = 1; drop <= options.drops; drop++) {
    groups.forEach((group, i) => {
      const all = buildLobbyDrops(group.entrantIds, {
        drops: options.drops,
        dropMultipliers: options.dropMultipliers,
        groupId: group.id,
        idPrefix: `br-${group.id}`,
        position: i + 1,
      });
      matches.push(all[drop - 1] as MatchNode);
    });
  }
  return { groups, matches, rounds: options.drops };
}
