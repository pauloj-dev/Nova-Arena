/**
 * Dados de teste montados pelo próprio motor (`@nova/engine`) e convertidos para o contrato
 * (`Bracket`, `Match`, `StandingRow`), do mesmo jeito que a API simulada faz.
 */
import { applyResult, createStageState, generateStage, getMatchStatus, type MatchNode, type StageConfig, type StageState, type StageStructure } from '@nova/engine';
import type { Bracket, Match, MatchParticipant, MatchStatus, StageFormat, StandingRow } from '@nova/schemas';

export const STAGE_ID = 'st_1';
export const TOURNAMENT_ID = 'tn_1';
export const matchId = (nodeId: string) => `${STAGE_ID}~${nodeId}`;

export function entrants(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `r${i + 1}`, name: `Squad ${i + 1}`, seed: i + 1 }));
}

function sourceLabel(structure: StageStructure, source: { matchId: string; outcome: 'winner' | 'loser' } | undefined): string | null {
  if (!source) return null;
  const from = structure.matches.find((m) => m.id === source.matchId);
  if (!from) return 'A definir';
  const sameRound = structure.matches.filter((m) => m.round === from.round && m.bracket === from.bracket && m.groupId === from.groupId).length;
  return `${source.outcome === 'winner' ? 'Vencedor' : 'Perdedor'}: ${from.roundLabel}${sameRound > 1 ? ` ${from.position}` : ''}`;
}

export function toMatch(structure: StageStructure, state: StageState, node: MatchNode, patch: Partial<Match> = {}): Match {
  const result = state.results[node.id];
  const engineStatus = getMatchStatus(structure, state, node.id);
  const status: MatchStatus = engineStatus === 'SKIPPED' || engineStatus === 'VOIDED' ? 'CANCELLED' : result ? (result.walkover ? 'WALKOVER' : 'VALIDATED') : 'SCHEDULED';
  const names = new Map(structure.entrants.map((e) => [e.id, e]));
  const participants: MatchParticipant[] = node.slots.map((slot) => {
    const entry = result?.entries.find((e) => e.entrantId === slot.entrantId);
    const entrant = slot.entrantId ? names.get(slot.entrantId) : undefined;
    return {
      registrationId: slot.entrantId,
      name: entrant?.name ?? (slot.entrantId ? 'Inscrito' : 'A definir'),
      tag: null,
      logoUrl: null,
      seed: entrant?.seed ?? null,
      sourceLabel: slot.entrantId ? null : sourceLabel(structure, slot.source),
      isBye: slot.isBye ?? false,
      score: entry?.score ?? null,
      placement: entry?.placement ?? null,
      kills: entry?.kills ?? null,
      absent: entry?.absent ?? false,
      points: entry ? (node.kind === 'LOBBY' ? (entry.kills ?? 0) + (entry.placement === 1 ? 3 : 0) : null) : null,
      isWinner: result ? (node.kind === 'LOBBY' ? entry?.placement === 1 : result.winnerId === slot.entrantId) : null,
      checkedIn: false,
      stats: {},
      playerKills: {},
      status: slot.entrantId ? (state.entrantStatus[slot.entrantId] ?? 'ACTIVE') : 'ACTIVE',
    };
  });
  const group = node.groupId ? structure.groups.find((g) => g.id === node.groupId) : undefined;
  return {
    id: matchId(node.id),
    nodeId: node.id,
    tournamentId: TOURNAMENT_ID,
    stageId: STAGE_ID,
    stageName: 'Mata-mata',
    groupId: node.groupId,
    groupName: group?.name ?? null,
    round: node.round,
    position: node.position,
    bracket: node.bracket,
    kind: node.kind,
    bestOf: node.bestOf,
    roundLabel: node.roundLabel,
    dropIndex: node.dropIndex ?? null,
    multiplier: node.multiplier ?? 1,
    ifNecessary: node.ifNecessary ?? false,
    status,
    waitingPrevious: node.slots.some((s) => s.entrantId === null),
    scheduledAt: null,
    checkInOpensAt: null,
    checkInClosesAt: null,
    hasLobby: false,
    participants,
    evidenceUrls: [],
    nextMatchId: node.nextMatchId ? matchId(node.nextMatchId) : null,
    loserNextMatchId: node.loserNextMatchId ? matchId(node.loserNextMatchId) : null,
    walkover: result?.walkover ?? false,
    updatedAt: null,
    ...patch,
  };
}

export interface TestStage {
  structure: StageStructure;
  state: StageState;
  /** Lança o resultado de um duelo: vence a vaga `winnerSlot` (0 ou 1). */
  play: (nodeId: string, winnerSlot?: 0 | 1) => void;
  /** Lança uma queda BR: a ordem das vagas vira a colocação. */
  playLobby: (nodeId: string) => void;
  matches: (patch?: (node: MatchNode) => Partial<Match>) => Match[];
  bracket: (patch?: (node: MatchNode) => Partial<Match>) => Bracket;
}

export function buildStage(format: StageFormat, count: number, config: StageConfig = {}): TestStage {
  const stage: TestStage = {
    structure: generateStage({ format, entrants: entrants(count), config, seeding: 'RANKED', seed: 'teste' }),
    state: createStageState(),
    play(nodeId, winnerSlot = 0) {
      const node = stage.structure.matches.find((m) => m.id === nodeId);
      const [a, b] = node?.slots ?? [];
      if (!node || !a?.entrantId || !b?.entrantId) throw new Error(`Partida ${nodeId} não está pronta`);
      const wins = Math.ceil(node.bestOf / 2);
      const snapshot = applyResult(stage.structure, stage.state, {
        matchId: nodeId,
        entries: [
          { entrantId: a.entrantId, score: winnerSlot === 0 ? wins : 0 },
          { entrantId: b.entrantId, score: winnerSlot === 1 ? wins : 0 },
        ],
      });
      stage.structure = snapshot.structure;
      stage.state = snapshot.state;
    },
    playLobby(nodeId) {
      const node = stage.structure.matches.find((m) => m.id === nodeId);
      if (!node) throw new Error(`Queda ${nodeId} não existe`);
      const snapshot = applyResult(stage.structure, stage.state, {
        matchId: nodeId,
        entries: node.slots.map((s, i) => ({ entrantId: s.entrantId as string, placement: i + 1, kills: node.slots.length - i })),
      });
      stage.structure = snapshot.structure;
      stage.state = snapshot.state;
    },
    matches(patch) {
      // Como a API: o bye do suíço (duelo de uma vaga só) não é partida para a tela.
      return stage.structure.matches.filter((m) => !(m.kind === 'DUEL' && m.slots.length === 1)).map((node) => toMatch(stage.structure, stage.state, node, patch?.(node)));
    },
    bracket(patch) {
      return {
        stageId: STAGE_ID,
        tournamentId: TOURNAMENT_ID,
        format,
        state: 'CONFIRMED',
        seeding: stage.structure.seeding,
        seedUsed: stage.structure.seedUsed,
        locked: false,
        rounds: stage.structure.rounds,
        groups: stage.structure.groups.map((g) => ({ id: g.id, name: g.name, registrationIds: g.entrantIds })),
        entrants: stage.structure.entrants.map((e, i) => ({ registrationId: e.id, name: e.name ?? 'Inscrito', tag: null, seed: e.seed ?? i + 1 })),
        matches: stage.matches(patch),
        complete: false,
      };
    },
  };
  return stage;
}

export function standingRow(position: number, patch: Partial<StandingRow> = {}): StandingRow {
  return {
    registrationId: `r${position}`,
    name: `Squad ${position}`,
    tag: null,
    logoUrl: null,
    groupId: null,
    position,
    played: 3,
    wins: Math.max(0, 4 - position),
    draws: 0,
    losses: Math.max(0, position - 1),
    points: Math.max(0, 12 - position * 3),
    booyahs: position === 1 ? 2 : 0,
    kills: 30 - position * 3,
    scoreFor: 10 - position,
    scoreAgainst: position,
    scoreDiff: 10 - 2 * position,
    avgPlacement: position,
    lastDropKills: 5,
    status: 'ACTIVE',
    eliminated: false,
    tiebreakNote: null,
    qualifying: false,
    perDrop: [],
    ...patch,
  };
}
