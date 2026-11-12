import { isEliminationFormat } from './operations';
import { createPrng } from './prng';
import { computePoints, roundPoints } from './scoring';
import type {
  MatchNode,
  ResultEntry,
  StageState,
  StageStructure,
  StandingRow,
  Standings,
  StandingsOptions,
  Stats,
  Tiebreaker,
} from './types';

/** Ordem padrão dos critérios de desempate (PRD §10.6). */
export const DEFAULT_TIEBREAKERS: readonly Tiebreaker[] = [
  'points',
  'wins',
  'score',
  'avgPlacement',
  'headToHead',
  'scoreDiff',
  'lastDropKills',
  'draw',
];

type Criterion = 'points' | 'wins' | 'score' | 'avgPlacement' | 'headToHead' | 'scoreDiff' | 'lastDropKills' | 'draw';

const CANONICAL: Record<Tiebreaker, Criterion> = {
  points: 'points',
  wins: 'wins',
  booyahs: 'wins',
  kills: 'score',
  score: 'score',
  avgPlacement: 'avgPlacement',
  headToHead: 'headToHead',
  scoreDiff: 'scoreDiff',
  lastDropKills: 'lastDropKills',
  draw: 'draw',
};

/** `points` sempre primeiro; sinônimos e repetições são unificados. */
function normalizeCriteria(tiebreakers: readonly Tiebreaker[] | undefined): Criterion[] {
  const out: Criterion[] = ['points'];
  for (const tiebreaker of tiebreakers ?? DEFAULT_TIEBREAKERS) {
    const criterion = CANONICAL[tiebreaker];
    if (criterion && !out.includes(criterion)) out.push(criterion);
  }
  return out;
}

interface Tally {
  row: StandingRow;
  seedIndex: number;
  placementSum: number;
  placementCount: number;
  lastDrop: number;
  /** Rodada em que foi eliminado (formatos eliminatórios); Infinity = segue vivo. */
  progress: number;
}

interface DuelRecord {
  a: string;
  b: string;
  pointsA: number;
  pointsB: number;
}

function duelStats(entry: ResultEntry, outcome: 'win' | 'draw' | 'loss', scoreStat: string | undefined): Stats {
  const stats: Stats = { score: entry.score, ...entry.stats, outcome };
  if (scoreStat !== undefined && stats[scoreStat] === undefined) stats[scoreStat] = entry.score;
  return stats;
}

function progressOf(match: MatchNode, won: boolean): number {
  if (match.bracket === 'THIRD_PLACE') return match.round - 1 + (won ? 0.5 : 0.25);
  if (match.bracket === 'FINAL') return 100_000 + match.round;
  return match.round;
}

function collect(structure: StageStructure, state: StageState, options: StandingsOptions) {
  const groupOf = new Map<string, string>();
  for (const group of structure.groups) for (const id of group.entrantIds) groupOf.set(id, group.id);

  const tallies = new Map<string, Tally>();
  structure.entrants.forEach((entrant, seedIndex) => {
    tallies.set(entrant.id, {
      seedIndex,
      placementSum: 0,
      placementCount: 0,
      lastDrop: 0,
      progress: Number.POSITIVE_INFINITY,
      row: {
        entrantId: entrant.id,
        name: entrant.name ?? entrant.id,
        groupId: groupOf.get(entrant.id) ?? null,
        position: 0,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        booyahs: 0,
        kills: 0,
        scoreFor: 0,
        scoreAgainst: 0,
        scoreDiff: 0,
        avgPlacement: null,
        lastDropKills: 0,
        status: state.entrantStatus[entrant.id] ?? 'ACTIVE',
        eliminated: false,
        tiebreakNote: null,
      },
    });
  });

  const dropCount = new Map<string | null, number>();
  for (const match of structure.matches) {
    if (match.kind === 'LOBBY') dropCount.set(match.groupId, Math.max(dropCount.get(match.groupId) ?? 0, match.dropIndex ?? 0));
  }

  const duels: DuelRecord[] = [];
  const elimination = isEliminationFormat(structure.format);
  const walkoverScore = structure.config.walkoverScore ?? 0;

  for (const match of structure.matches) {
    if (match.kind === 'DUEL' && match.slots.length === 1) {
      // Bye do suíço: conta como vitória por W.O.
      const tally = tallies.get(match.slots[0]?.entrantId as string);
      if (!tally) continue;
      const stats = duelStats({ entrantId: tally.row.entrantId, score: walkoverScore }, 'win', options.scoreStat);
      tally.row.points += computePoints(stats, options.rules, { matchIndex: match.round, matchCount: structure.rounds }).total;
      tally.row.played += 1;
      tally.row.wins += 1;
      tally.row.scoreFor += walkoverScore;
      continue;
    }
    const result = state.results[match.id];
    if (!result || result.voided) continue;

    if (match.kind === 'LOBBY') {
      const ctx = { matchIndex: match.dropIndex, matchCount: dropCount.get(match.groupId), multiplier: match.multiplier };
      for (const entry of result.entries) {
        const tally = tallies.get(entry.entrantId);
        if (!tally || entry.absent) continue;
        const kills = entry.kills ?? 0;
        const { row } = tally;
        row.points += computePoints({ ...entry.stats, kills, placement: entry.placement }, options.rules, ctx).total;
        row.played += 1;
        row.kills += kills;
        row.scoreFor += kills;
        if (entry.placement === 1) {
          row.booyahs += 1;
          row.wins += 1;
        }
        if (entry.placement !== undefined) {
          tally.placementSum += entry.placement;
          tally.placementCount += 1;
        }
        if ((match.dropIndex ?? 0) >= tally.lastDrop) {
          tally.lastDrop = match.dropIndex ?? 0;
          row.lastDropKills = kills;
        }
      }
      continue;
    }

    const [entryA, entryB] = result.entries as [ResultEntry, ResultEntry];
    const ctx = { matchIndex: match.round, matchCount: structure.rounds, multiplier: match.multiplier };
    const earned: number[] = [];
    for (const [entry, other] of [
      [entryA, entryB],
      [entryB, entryA],
    ] as const) {
      const tally = tallies.get(entry.entrantId);
      const outcome = result.draw ? 'draw' : result.winnerId === entry.entrantId ? 'win' : 'loss';
      const points = computePoints(duelStats(entry, outcome, options.scoreStat), options.rules, ctx).total;
      earned.push(points);
      if (!tally) continue;
      const { row } = tally;
      row.points += points;
      row.played += 1;
      if (outcome === 'win') row.wins += 1;
      else if (outcome === 'draw') row.draws += 1;
      else row.losses += 1;
      row.scoreFor += entry.score ?? 0;
      row.scoreAgainst += other.score ?? 0;
      if (elimination && outcome === 'loss') {
        const nextId = match.loserNextMatchId;
        if (nextId === null || state.skipped.includes(nextId)) {
          row.eliminated = true;
          tally.progress = progressOf(match, false);
        }
      }
      if (elimination && outcome === 'win' && match.bracket === 'THIRD_PLACE') {
        row.eliminated = true;
        tally.progress = progressOf(match, true);
      }
    }
    duels.push({ a: entryA.entrantId, b: entryB.entrantId, pointsA: earned[0] as number, pointsB: earned[1] as number });
  }

  for (const tally of tallies.values()) {
    const { row } = tally;
    row.points = roundPoints(row.points);
    row.scoreDiff = row.scoreFor - row.scoreAgainst;
    row.avgPlacement = tally.placementCount > 0 ? roundPoints(tally.placementSum / tally.placementCount) : null;
    if (row.status === 'DISQUALIFIED') {
      // RN-05: desclassificar zera a pontuação.
      Object.assign(row, {
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        booyahs: 0,
        kills: 0,
        scoreFor: 0,
        scoreAgainst: 0,
        scoreDiff: 0,
        avgPlacement: null,
        lastDropKills: 0,
        eliminated: elimination,
      });
    }
  }
  return { tallies: [...tallies.values()], duels };
}

interface RankContext {
  criteria: Criterion[];
  duels: DuelRecord[];
  isLobby: boolean;
  elimination: boolean;
  drawSeed: string;
  drawUsed: boolean;
}

function criterionValues(cluster: Tally[], criterion: Criterion, ctx: RankContext): Map<Tally, number> {
  const values = new Map<Tally, number>();
  switch (criterion) {
    case 'headToHead': {
      const ids = new Set(cluster.map((t) => t.row.entrantId));
      const mini = new Map<string, number>();
      for (const duel of ctx.duels) {
        if (!ids.has(duel.a) || !ids.has(duel.b)) continue;
        mini.set(duel.a, (mini.get(duel.a) ?? 0) + duel.pointsA);
        mini.set(duel.b, (mini.get(duel.b) ?? 0) + duel.pointsB);
      }
      for (const tally of cluster) values.set(tally, roundPoints(mini.get(tally.row.entrantId) ?? 0));
      return values;
    }
    case 'draw': {
      const sorted = cluster.slice().sort((a, b) => (a.row.entrantId < b.row.entrantId ? -1 : 1));
      const drawn = createPrng(`${ctx.drawSeed}:${sorted.map((t) => t.row.entrantId).join(',')}`).shuffle(sorted);
      drawn.forEach((tally, index) => values.set(tally, drawn.length - index));
      ctx.drawUsed = true;
      return values;
    }
    default:
      for (const tally of cluster) {
        const { row } = tally;
        values.set(
          tally,
          criterion === 'points'
            ? row.points
            : criterion === 'wins'
              ? row.wins
              : criterion === 'score'
                ? row.scoreFor
                : criterion === 'scoreDiff'
                  ? row.scoreDiff
                  : criterion === 'lastDropKills'
                    ? row.lastDropKills
                    : -(row.avgPlacement ?? Number.POSITIVE_INFINITY),
        );
      }
      return values;
  }
}

function explain(criterion: Criterion, tally: Tally, value: number, ctx: RankContext): string {
  const { row } = tally;
  switch (criterion) {
    case 'wins':
      return ctx.isLobby ? `número de Booyahs (${row.booyahs})` : `número de vitórias (${row.wins})`;
    case 'score':
      return ctx.isLobby ? `total de kills (${row.kills})` : `total a favor (${row.scoreFor})`;
    case 'avgPlacement':
      return `colocação média (${row.avgPlacement ?? '—'})`;
    case 'headToHead':
      return `confronto direto (${value} ${value === 1 ? 'pt' : 'pts'})`;
    case 'scoreDiff':
      return `saldo (${row.scoreDiff > 0 ? '+' : ''}${row.scoreDiff})`;
    case 'lastDropKills':
      return `kills na última queda (${row.lastDropKills})`;
    case 'draw':
      return `sorteio (seed "${ctx.drawSeed}")`;
    default:
      return 'pontos';
  }
}

const listNames = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;

/** Divide um grupo empatado pelo critério; devolve os subgrupos do melhor para o pior. */
function split(cluster: Tally[], value: (tally: Tally) => number): Tally[][] {
  const sorted = cluster
    .map((tally) => ({ tally, value: value(tally) }))
    .sort((a, b) => b.value - a.value || a.tally.seedIndex - b.tally.seedIndex);
  const out: Tally[][] = [];
  let last: number | undefined;
  for (const item of sorted) {
    if (out.length > 0 && item.value === last) (out[out.length - 1] as Tally[]).push(item.tally);
    else out.push([item.tally]);
    last = item.value;
  }
  return out;
}

function rank(tallies: Tally[], ctx: RankContext): StandingRow[] {
  const notes = new Map<Tally, string>();
  const active = tallies.filter((t) => t.row.status !== 'DISQUALIFIED');
  const disqualified = tallies.filter((t) => t.row.status === 'DISQUALIFIED').sort((a, b) => a.seedIndex - b.seedIndex);

  let clusters: Tally[][] = active.length > 0 ? [active] : [];
  if (ctx.elimination) clusters = clusters.flatMap((cluster) => split(cluster, (t) => t.progress));

  for (const criterion of ctx.criteria) {
    clusters = clusters.flatMap((cluster) => {
      if (cluster.length < 2) return [cluster];
      // Quem ainda não jogou não vai a sorteio: fica na ordem das seeds.
      if (criterion === 'draw' && cluster.every((t) => t.row.played === 0)) return [cluster];
      const values = criterionValues(cluster, criterion, ctx);
      const parts = split(cluster, (t) => values.get(t) as number);
      if (criterion !== 'points' && parts.length > 1) {
        for (const tally of cluster) {
          const others = cluster.filter((t) => t !== tally).map((t) => t.row.name);
          notes.set(
            tally,
            `Empate em pontos com ${listNames(others)}. Desempate por ${explain(criterion, tally, values.get(tally) as number, ctx)}.`,
          );
        }
      }
      return parts;
    });
  }

  // Empate que nenhum critério resolveu: mantém a ordem das seeds.
  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    cluster.sort((a, b) => a.seedIndex - b.seedIndex);
    if (cluster.every((t) => t.row.played === 0)) continue;
    for (const tally of cluster) {
      const others = cluster.filter((t) => t !== tally).map((t) => t.row.name);
      notes.set(tally, `Empate em todos os critérios com ${listNames(others)}. Mantida a ordem das seeds.`);
    }
  }

  const ordered = [...clusters.flat(), ...disqualified];
  return ordered.map((tally, index) => ({
    ...tally.row,
    position: index + 1,
    tiebreakNote: tally.row.status === 'DISQUALIFIED' ? 'Desclassificado: pontuação zerada.' : (notes.get(tally) ?? null),
  }));
}

/**
 * Calcula a tabela da fase a partir dos resultados: aplica as regras de
 * pontuação e os critérios de desempate, na ordem configurada. Vale para
 * duelos e para Battle Royale. Nos formatos eliminatórios, quem foi mais longe
 * na chave fica à frente, e os critérios desempatam quem caiu na mesma rodada.
 */
export function computeStandings(structure: StageStructure, state: StageState, options: StandingsOptions): Standings {
  const { tallies, duels } = collect(structure, state, options);
  const ctx: RankContext = {
    criteria: normalizeCriteria(options.tiebreakers),
    duels,
    isLobby: structure.matches.some((match) => match.kind === 'LOBBY'),
    elimination: isEliminationFormat(structure.format),
    drawSeed: options.drawSeed ?? structure.seedUsed,
    drawUsed: false,
  };

  const overall = rank(tallies, ctx);
  const groups =
    structure.groups.length === 0
      ? [{ groupId: null, name: 'Classificação', rows: overall }]
      : structure.groups.map((group) => ({
          groupId: group.id,
          name: group.name,
          rows: rank(
            tallies.filter((t) => t.row.groupId === group.id),
            ctx,
          ),
        }));

  return { format: structure.format, groups, overall, drawSeed: ctx.drawSeed, drawUsed: ctx.drawUsed };
}
