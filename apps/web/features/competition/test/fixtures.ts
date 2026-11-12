/**
 * Chaves e tabelas de teste geradas pelo próprio motor, no formato que a API devolve.
 * Servem aos testes de componente (8, 16, 32 e 48 participantes, simples e dupla, duelo e BR).
 */
import { applyResult, computePoints, computeStandings, createStageState, DEFAULT_SCORING_MODELS, generateStage, type MatchNode, type StageState, type StageStructure } from '@nova/engine';
import type { Bracket, Match, StandingRow, Standings } from '@nova/schemas';

const SQUADS = ['Alfa', 'Bravo', 'Charlie', 'Delta', 'Eco', 'Foxtrot', 'Golf', 'Hotel', 'Índia', 'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa'];
export const entrantName = (i: number) => `Squad ${SQUADS[i % SQUADS.length]}${i >= SQUADS.length ? ` ${Math.floor(i / SQUADS.length) + 1}` : ''}`;
export const regId = (i: number) => `reg_${i + 1}`;
const seedOf = (id: string) => Number(id.slice(4));

function toMatch(structure: StageStructure, state: StageState, node: MatchNode, stageId: string): Match {
  const result = state.results[node.id];
  const names = new Map(structure.entrants.map((e) => [e.id, e.name ?? e.id]));
  const seeds = new Map(structure.entrants.map((e) => [e.id, e.seed ?? null]));
  return {
    id: `${stageId}~${node.id}`,
    nodeId: node.id,
    tournamentId: 'tn_test',
    stageId,
    stageName: 'Mata-mata',
    groupId: node.groupId,
    groupName: null,
    round: node.round,
    position: node.position,
    bracket: node.bracket,
    kind: node.kind,
    bestOf: node.bestOf,
    roundLabel: node.roundLabel,
    dropIndex: node.dropIndex ?? null,
    multiplier: node.multiplier ?? 1,
    ifNecessary: node.ifNecessary ?? false,
    status: result ? 'VALIDATED' : 'SCHEDULED',
    waitingPrevious: node.slots.some((s) => s.entrantId === null),
    scheduledAt: '2026-11-14T23:00:00.000Z',
    checkInOpensAt: null,
    checkInClosesAt: null,
    hasLobby: false,
    participants: node.slots.map((slot) => {
      const entry = result?.entries.find((e) => e.entrantId === slot.entrantId);
      return {
        registrationId: slot.entrantId,
        name: slot.entrantId ? (names.get(slot.entrantId) ?? 'Inscrito') : 'A definir',
        tag: null,
        logoUrl: null,
        seed: slot.entrantId ? (seeds.get(slot.entrantId) ?? null) : null,
        sourceLabel: slot.entrantId ? null : slot.source ? `${slot.source.outcome === 'winner' ? 'Vencedor' : 'Perdedor'}: ${slot.source.matchId}` : null,
        isBye: slot.isBye ?? false,
        score: entry?.score ?? null,
        placement: entry?.placement ?? null,
        kills: entry?.kills ?? null,
        absent: false,
        points: null,
        isWinner: result ? result.winnerId === slot.entrantId : null,
        checkedIn: false,
        stats: {},
        playerKills: {},
        status: 'ACTIVE' as const,
      };
    }),
    evidenceUrls: [],
    nextMatchId: node.nextMatchId ? `${stageId}~${node.nextMatchId}` : null,
    loserNextMatchId: node.loserNextMatchId ? `${stageId}~${node.loserNextMatchId}` : null,
    walkover: false,
    updatedAt: null,
  };
}

/** Chave com `n` participantes; `playedRounds` rodadas da chave de vencedores já jogadas (a seed melhor vence). */
export function bracketFixture(n: number, format: 'SINGLE_ELIM' | 'DOUBLE_ELIM' = 'SINGLE_ELIM', opts: { playedRounds?: number; thirdPlace?: boolean } = {}): Bracket {
  const entrants = Array.from({ length: n }, (_, i) => ({ id: regId(i), name: entrantName(i), seed: i + 1 }));
  let structure = generateStage({ format, entrants, config: { bestOf: 3, thirdPlace: opts.thirdPlace ?? false }, seeding: 'MANUAL', seed: 'fixture' });
  let state = createStageState();
  for (let round = 1; round <= (opts.playedRounds ?? 0); round++) {
    for (const id of structure.matches.filter((m) => m.bracket === 'WINNERS' && m.round === round).map((m) => m.id)) {
      const node = structure.matches.find((m) => m.id === id) as MatchNode;
      const [x, y] = node.slots.map((s) => s.entrantId);
      if (!x || !y) continue;
      const winner = seedOf(x) < seedOf(y) ? x : y;
      ({ structure, state } = applyResult(structure, state, {
        matchId: id,
        entries: [
          { entrantId: x, score: x === winner ? 2 : 1 },
          { entrantId: y, score: y === winner ? 2 : 1 },
        ],
      }));
    }
  }
  return {
    stageId: 'stg_test',
    tournamentId: 'tn_test',
    format,
    state: 'CONFIRMED',
    seeding: 'MANUAL',
    seedUsed: 'fixture',
    locked: false,
    rounds: structure.rounds,
    groups: [],
    entrants: entrants.map((e) => ({ registrationId: e.id, name: e.name, tag: null, seed: e.seed })),
    matches: structure.matches.filter((m) => m.slots.length === 2).map((node) => toMatch(structure, state, node, 'stg_test')),
    complete: false,
  };
}

/**
 * Battle Royale com `n` squads em salas de 12, `drops` quedas jogadas por sala.
 * Colocação e kills variam de forma determinística; os `qualify` primeiros de cada sala ficam na zona.
 */
export function brStandingsFixture(n = 48, opts: { drops?: number; qualify?: number; groups?: boolean } = {}): Standings {
  const drops = opts.drops ?? 3;
  const model = DEFAULT_SCORING_MODELS.find((m) => m.id === 'ff-br-padrao');
  if (!model) throw new Error('Modelo padrão de BR não encontrado');
  const entrants = Array.from({ length: n }, (_, i) => ({ id: regId(i), name: entrantName(i), seed: i + 1 }));
  let structure = generateStage({ format: 'BATTLE_ROYALE', entrants, config: { lobbySize: 12, drops }, seeding: 'MANUAL', seed: 'fixture-br' });
  let state = createStageState();
  for (const id of structure.matches.map((m) => m.id)) {
    const node = structure.matches.find((m) => m.id === id) as MatchNode;
    const ids = node.slots.map((s) => s.entrantId).filter((x): x is string => Boolean(x));
    const drop = node.dropIndex ?? 1;
    // Embaralha a ordem de chegada por queda, sempre igual.
    const order = [...ids].sort((a, b) => ((seedOf(a) * 7 + drop * 13) % 17) - ((seedOf(b) * 7 + drop * 13) % 17) || seedOf(a) - seedOf(b));
    ({ structure, state } = applyResult(structure, state, {
      matchId: id,
      entries: order.map((entrantId, i) => ({ entrantId, placement: i + 1, kills: (seedOf(entrantId) * 3 + drop) % 9 })),
    }));
  }
  const s = computeStandings(structure, state, { rules: model.rules, tiebreakers: model.tiebreakers });
  const qualify = opts.qualify ?? 4;
  const lobbies = structure.matches.filter((m) => m.kind === 'LOBBY');
  const toRow = (row: (typeof s.overall)[number]): StandingRow => ({
    registrationId: row.entrantId,
    name: row.name,
    tag: `S${seedOf(row.entrantId)}`,
    logoUrl: null,
    groupId: row.groupId,
    position: row.position,
    played: row.played,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    points: row.points,
    booyahs: row.booyahs,
    kills: row.kills,
    scoreFor: row.scoreFor,
    scoreAgainst: row.scoreAgainst,
    scoreDiff: row.scoreDiff,
    avgPlacement: row.avgPlacement,
    lastDropKills: row.lastDropKills,
    status: row.status,
    eliminated: row.eliminated,
    tiebreakNote: row.tiebreakNote,
    qualifying: row.position <= qualify,
    perDrop: lobbies
      .filter((m) => m.groupId === row.groupId)
      .map((m) => {
        const entry = state.results[m.id]?.entries.find((e) => e.entrantId === row.entrantId);
        const points = entry ? computePoints({ kills: entry.kills ?? 0, placement: entry.placement }, model.rules, { matchIndex: m.dropIndex ?? 1, matchCount: drops }).total : 0;
        return { dropIndex: m.dropIndex ?? 1, placement: entry?.placement ?? null, kills: entry?.kills ?? 0, points };
      }),
  });
  return {
    stageId: 'stg_br',
    format: 'BATTLE_ROYALE',
    matchType: 'BATTLE_ROYALE',
    groups: s.groups.map((g) => ({ groupId: g.groupId, name: g.name, rows: g.rows.map(toRow) })),
    overall: s.overall.map((row) => ({ ...toRow(row), qualifying: row.position <= qualify })),
    drawUsed: s.drawUsed,
    drawSeed: s.drawUsed ? s.drawSeed : null,
    mvp: [],
    updatedAt: '2026-11-14T23:00:00.000Z',
  };
}

/** Pontos corridos (duelo) em grupos de 4, todos os jogos feitos; 2 primeiros de cada grupo na zona. */
export function duelStandingsFixture(n = 8, opts: { groupCount?: number } = {}): Standings {
  const model = DEFAULT_SCORING_MODELS.find((m) => m.id === 'cr-1v1');
  if (!model) throw new Error('Modelo padrão de duelo não encontrado');
  const entrants = Array.from({ length: n }, (_, i) => ({ id: regId(i), name: entrantName(i), seed: i + 1 }));
  let structure = generateStage({ format: 'GROUPS', entrants, config: { groupCount: opts.groupCount ?? 2 }, seeding: 'MANUAL', seed: 'fixture-groups' });
  let state = createStageState();
  for (const id of structure.matches.map((m) => m.id)) {
    const node = structure.matches.find((m) => m.id === id) as MatchNode;
    const [x, y] = node.slots.map((s) => s.entrantId);
    if (!x || !y) continue;
    const draw = (seedOf(x) + seedOf(y)) % 5 === 0;
    const winner = seedOf(x) < seedOf(y) ? x : y;
    ({ structure, state } = applyResult(structure, state, {
      matchId: id,
      entries: [
        { entrantId: x, score: draw ? 1 : x === winner ? 3 : 1 },
        { entrantId: y, score: draw ? 1 : y === winner ? 3 : 1 },
      ],
      winnerId: draw ? null : winner,
    }));
  }
  const s = computeStandings(structure, state, { rules: model.rules, tiebreakers: model.tiebreakers, scoreStat: 'score' });
  const toRow = (row: (typeof s.overall)[number]): StandingRow => ({
    registrationId: row.entrantId,
    name: row.name,
    tag: null,
    logoUrl: null,
    groupId: row.groupId,
    position: row.position,
    played: row.played,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    points: row.points,
    booyahs: row.booyahs,
    kills: row.kills,
    scoreFor: row.scoreFor,
    scoreAgainst: row.scoreAgainst,
    scoreDiff: row.scoreDiff,
    avgPlacement: row.avgPlacement,
    lastDropKills: row.lastDropKills,
    status: row.status,
    eliminated: row.eliminated,
    tiebreakNote: row.tiebreakNote,
    qualifying: row.position <= 2,
    perDrop: [],
  });
  return {
    stageId: 'stg_groups',
    format: 'GROUPS',
    matchType: 'DUEL',
    groups: s.groups.map((g) => ({ groupId: g.groupId, name: g.name, rows: g.rows.map(toRow) })),
    overall: s.overall.map(toRow),
    drawUsed: s.drawUsed,
    drawSeed: s.drawUsed ? s.drawSeed : null,
    mvp: [],
    updatedAt: '2026-11-14T23:00:00.000Z',
  };
}
