import { EngineError } from '../errors';
import { bracketOrder, nextPowerOfTwo } from '../seeding';
import type { BracketSide, Entrant, MatchNode, MatchSlot } from '../types';

/**
 * A chave é montada primeiro "cheia" (potência de 2, com vagas vazias no lugar
 * dos byes) e depois enxugada: partida com um lado vazio some e quem estava
 * sozinho avança; partida com os dois lados vazios some de vez. Assim a mesma
 * rotina serve para eliminação simples e dupla com qualquer número de inscritos.
 */
type Feed =
  | { kind: 'entrant'; id: string; bye: boolean }
  | { kind: 'match'; key: string; outcome: 'winner' | 'loser' }
  | { kind: 'empty' };

interface VirtualMatch {
  key: string;
  bracket: BracketSide;
  round: number;
  position: number;
  feeds: [Feed, Feed];
  ifNecessary?: boolean;
}

const EMPTY: Feed = { kind: 'empty' };
const winnerOf = (key: string): Feed => ({ kind: 'match', key, outcome: 'winner' });
const loserOf = (key: string): Feed => ({ kind: 'match', key, outcome: 'loser' });
const wKey = (round: number, position: number): string => `W${round}-${position}`;
const lKey = (round: number, position: number): string => `L${round}-${position}`;

interface RealMatch extends VirtualMatch {
  slots: [Feed, Feed];
}

function prune(virtual: VirtualMatch[]): RealMatch[] {
  const outputs = new Map<string, { winner: Feed; loser: Feed }>();
  const real: RealMatch[] = [];
  const resolve = (feed: Feed): Feed => {
    if (feed.kind !== 'match') return feed;
    return (outputs.get(feed.key) as { winner: Feed; loser: Feed })[feed.outcome];
  };
  for (const match of virtual) {
    const a = resolve(match.feeds[0]);
    const b = resolve(match.feeds[1]);
    if (a.kind !== 'empty' && b.kind !== 'empty') {
      real.push({ ...match, slots: [a, b] });
      outputs.set(match.key, { winner: winnerOf(match.key), loser: loserOf(match.key) });
      continue;
    }
    const alone = a.kind !== 'empty' ? a : b;
    const advanced: Feed = alone.kind === 'entrant' ? { ...alone, bye: true } : alone;
    outputs.set(match.key, { winner: advanced, loser: EMPTY });
  }
  return real;
}

function winnersBracket(entrants: readonly Entrant[], lastRound: number): VirtualMatch[] {
  const size = nextPowerOfTwo(entrants.length);
  const order = bracketOrder(size);
  const feedOfSeed = (seed: number): Feed => {
    const entrant = entrants[seed - 1];
    return entrant ? { kind: 'entrant', id: entrant.id, bye: false } : EMPTY;
  };
  const matches: VirtualMatch[] = [];
  for (let round = 1; round <= lastRound; round++) {
    const count = size / 2 ** round;
    for (let position = 1; position <= count; position++) {
      const feeds: [Feed, Feed] =
        round === 1
          ? [feedOfSeed(order[2 * position - 2] as number), feedOfSeed(order[2 * position - 1] as number)]
          : [winnerOf(wKey(round - 1, 2 * position - 1)), winnerOf(wKey(round - 1, 2 * position))];
      matches.push({ key: wKey(round, position), bracket: 'WINNERS', round, position, feeds });
    }
  }
  return matches;
}

const KNOCKOUT_LABEL: Record<number, string> = {
  1: 'Final',
  2: 'Semifinal',
  4: 'Quartas de final',
  8: 'Oitavas de final',
};

function toNodes(
  real: RealMatch[],
  bestOf: number,
  idOf: (match: RealMatch) => string,
  labelOf: (match: RealMatch) => string,
): MatchNode[] {
  const ids = new Map<string, string>();
  for (const match of real) ids.set(match.key, idOf(match));

  const nodes = real.map((match): MatchNode => {
    const slots = match.slots.map((feed): MatchSlot => {
      if (feed.kind === 'entrant') return feed.bye ? { entrantId: feed.id, isBye: true } : { entrantId: feed.id };
      const source = feed as Extract<Feed, { kind: 'match' }>;
      return { entrantId: null, source: { matchId: ids.get(source.key) as string, outcome: source.outcome } };
    });
    const node: MatchNode = {
      id: ids.get(match.key) as string,
      round: match.round,
      position: match.position,
      bracket: match.bracket,
      groupId: null,
      kind: 'DUEL',
      slots,
      bestOf,
      nextMatchId: null,
      loserNextMatchId: null,
      roundLabel: labelOf(match),
    };
    if (match.ifNecessary) node.ifNecessary = true;
    return node;
  });

  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    for (const slot of node.slots) {
      if (!slot.source) continue;
      const origin = byId.get(slot.source.matchId) as MatchNode;
      if (slot.source.outcome === 'winner') origin.nextMatchId = node.id;
      else origin.loserNextMatchId = node.id;
    }
  }
  return nodes;
}

export interface SingleElimOptions {
  bestOf: number;
  thirdPlace: boolean;
  stopAtRemaining: number;
}

export function buildSingleElim(entrants: readonly Entrant[], options: SingleElimOptions): { matches: MatchNode[]; rounds: number } {
  const size = nextPowerOfTwo(entrants.length);
  const totalRounds = Math.log2(size);
  const stop = options.stopAtRemaining;
  if (!Number.isInteger(stop) || stop < 1 || nextPowerOfTwo(stop) !== stop || stop > size / 2) {
    throw new EngineError(
      'INVALID_CONFIG',
      'O número de classificados do mata-mata precisa ser uma potência de 2 menor que o número de participantes.',
    );
  }
  const lastRound = totalRounds - Math.log2(stop);
  const virtual = winnersBracket(entrants, lastRound);
  if (options.thirdPlace && stop === 1 && entrants.length >= 4) {
    virtual.push({
      key: '3RD',
      bracket: 'THIRD_PLACE',
      round: totalRounds,
      position: 2,
      feeds: [loserOf(wKey(totalRounds - 1, 1)), loserOf(wKey(totalRounds - 1, 2))],
    });
  }
  const matches = toNodes(
    prune(virtual),
    options.bestOf,
    (match) => (match.bracket === 'THIRD_PLACE' ? '3rd' : `w-r${match.round}-m${match.position}`),
    (match) =>
      match.bracket === 'THIRD_PLACE'
        ? 'Disputa de 3º lugar'
        : (KNOCKOUT_LABEL[size / 2 ** match.round] ?? `Rodada ${match.round}`),
  );
  return { matches, rounds: lastRound };
}

export interface DoubleElimOptions {
  bestOf: number;
  grandFinalReset: boolean;
}

export function buildDoubleElim(entrants: readonly Entrant[], options: DoubleElimOptions): { matches: MatchNode[]; rounds: number } {
  const size = nextPowerOfTwo(entrants.length);
  const k = Math.log2(size);
  const virtual = winnersBracket(entrants, k);

  let losersChampion: Feed = loserOf(wKey(1, 1));
  if (k >= 2) {
    for (let p = 1; p <= size / 4; p++) {
      virtual.push({
        key: lKey(1, p),
        bracket: 'LOSERS',
        round: 1,
        position: p,
        feeds: [loserOf(wKey(1, 2 * p - 1)), loserOf(wKey(1, 2 * p))],
      });
    }
    for (let j = 1; j <= k - 1; j++) {
      const count = size / 2 ** (j + 1);
      // Cruza quem cai da chave de vencedores para adiar revanches.
      const crossed = (p: number): number => (j % 2 === 1 ? count + 1 - p : ((p - 1 + count / 2) % count) + 1);
      for (let p = 1; p <= count; p++) {
        const from = count === 1 ? 1 : crossed(p);
        virtual.push({
          key: lKey(2 * j, p),
          bracket: 'LOSERS',
          round: 2 * j,
          position: p,
          feeds: [loserOf(wKey(j + 1, from)), winnerOf(lKey(2 * j - 1, p))],
        });
      }
      if (j < k - 1) {
        for (let p = 1; p <= count / 2; p++) {
          virtual.push({
            key: lKey(2 * j + 1, p),
            bracket: 'LOSERS',
            round: 2 * j + 1,
            position: p,
            feeds: [winnerOf(lKey(2 * j, 2 * p - 1)), winnerOf(lKey(2 * j, 2 * p))],
          });
        }
      }
    }
    losersChampion = winnerOf(lKey(2 * (k - 1), 1));
  }

  virtual.push({ key: 'GF1', bracket: 'FINAL', round: 1, position: 1, feeds: [winnerOf(wKey(k, 1)), losersChampion] });
  if (options.grandFinalReset) {
    virtual.push({
      key: 'GF2',
      bracket: 'FINAL',
      round: 2,
      position: 1,
      feeds: [winnerOf('GF1'), loserOf('GF1')],
      ifNecessary: true,
    });
  }

  const real = prune(virtual);

  // Rodadas da chave de perdedores que ficaram vazias somem; as demais são renumeradas.
  const loserRounds = [...new Set(real.filter((m) => m.bracket === 'LOSERS').map((m) => m.round))].sort((a, b) => a - b);
  const counters = new Map<number, number>();
  for (const match of real) {
    if (match.bracket !== 'LOSERS') continue;
    const round = loserRounds.indexOf(match.round) + 1;
    const position = (counters.get(round) ?? 0) + 1;
    counters.set(round, position);
    match.round = round;
    match.position = position;
  }
  const lastLoserRound = loserRounds.length;

  const matches = toNodes(
    real,
    options.bestOf,
    (match) => {
      if (match.bracket === 'WINNERS') return `w-r${match.round}-m${match.position}`;
      if (match.bracket === 'LOSERS') return `l-r${match.round}-m${match.position}`;
      return `gf-${match.round}`;
    },
    (match) => {
      if (match.bracket === 'FINAL') return match.round === 1 ? 'Grande Final' : 'Grande Final (reset)';
      if (match.bracket === 'LOSERS') {
        return match.round === lastLoserRound ? 'Final da chave inferior' : `Chave inferior · Rodada ${match.round}`;
      }
      const remaining = size / 2 ** match.round;
      if (remaining === 1) return 'Final da chave superior';
      if (remaining === 2) return 'Semifinal da chave superior';
      return `Chave superior · Rodada ${match.round}`;
    },
  );
  return { matches, rounds: k };
}
