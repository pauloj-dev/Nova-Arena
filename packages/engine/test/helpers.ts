import { applyResult, createPrng, createStageState, generateSwissRound, isStageComplete } from '../src/index';
import type { Entrant, MatchNode, MatchResultInput, Prng, StageSnapshot, StageState, StageStructure } from '../src/index';

export const makeEntrants = (n: number): Entrant[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Jogador ${i + 1}` }));

export const FIXED_SIZES = [2, 3, 5, 8, 13, 16, 64] as const;

export const slotIds = (match: MatchNode): Array<string | null> => match.slots.map((slot) => slot.entrantId);

export const byId = (structure: StageStructure, id: string): MatchNode => {
  const match = structure.matches.find((m) => m.id === id);
  if (!match) throw new Error(`partida ${id} não existe`);
  return match;
};

const isReady = (match: MatchNode, state: StageState): boolean =>
  match.slots.length >= 2 &&
  !state.results[match.id] &&
  !state.skipped.includes(match.id) &&
  match.slots.every((slot) => slot.entrantId !== null);

/** Resultado aleatório (mas determinístico) para uma partida pronta. */
export function randomResult(match: MatchNode, prng: Prng, allowDraw = false): MatchResultInput {
  if (match.kind === 'LOBBY') {
    const order = prng.shuffle(match.slots.map((slot) => slot.entrantId as string));
    return {
      matchId: match.id,
      entries: order.map((entrantId, i) => ({ entrantId, placement: i + 1, kills: prng.int(10) })),
    };
  }
  const [a, b] = match.slots.map((slot) => slot.entrantId as string) as [string, string];
  if (allowDraw && match.bracket === null && match.bestOf === 1 && prng.int(4) === 0) {
    const goals = prng.int(3);
    return { matchId: match.id, entries: [{ entrantId: a, score: goals }, { entrantId: b, score: goals }] };
  }
  const needed = Math.ceil(match.bestOf / 2);
  const winnerScore = match.bestOf > 1 ? needed : 1 + prng.int(3);
  const loserScore = prng.int(winnerScore);
  const aWins = prng.int(2) === 0;
  return {
    matchId: match.id,
    entries: [
      { entrantId: a, score: aWins ? winnerScore : loserScore },
      { entrantId: b, score: aWins ? loserScore : winnerScore },
    ],
  };
}

/** Joga a fase inteira com resultados sorteados a partir da seed. */
export function simulate(
  structure: StageStructure,
  seed = 'sim',
  onResult?: (match: MatchNode, snapshot: StageSnapshot) => void,
  allowDraw = false,
): StageSnapshot {
  const prng = createPrng(seed);
  let snapshot: StageSnapshot = { structure, state: createStageState() };
  for (;;) {
    const ready = snapshot.structure.matches.filter((match) => isReady(match, snapshot.state));
    if (ready.length === 0) {
      if (snapshot.structure.format === 'SWISS' && !isStageComplete(snapshot.structure, snapshot.state)) {
        snapshot = { structure: generateSwissRound(snapshot.structure, snapshot.state), state: snapshot.state };
        continue;
      }
      return snapshot;
    }
    for (const match of ready) {
      snapshot = applyResult(snapshot.structure, snapshot.state, randomResult(match, prng, allowDraw));
      onResult?.(match, snapshot);
    }
  }
}

/** Aplica uma lista de vitórias simples: [matchId, vencedor]. */
export function win(snapshot: StageSnapshot, matchId: string, winnerId: string): StageSnapshot {
  const match = byId(snapshot.structure, matchId);
  const needed = Math.ceil(match.bestOf / 2);
  return applyResult(snapshot.structure, snapshot.state, {
    matchId,
    entries: match.slots.map((slot) => ({
      entrantId: slot.entrantId as string,
      score: slot.entrantId === winnerId ? needed : 0,
    })),
  });
}

export const start = (structure: StageStructure): StageSnapshot => ({ structure, state: createStageState() });
