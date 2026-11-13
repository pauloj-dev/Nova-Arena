/** Partidas de mentira para os testes dos formulários de resultado. */
import type { Match, MatchParticipant } from '@nova/schemas';

export function participant(registrationId: string, name: string, patch: Partial<MatchParticipant> = {}): MatchParticipant {
  return {
    registrationId,
    name,
    tag: null,
    logoUrl: null,
    seed: null,
    sourceLabel: null,
    isBye: false,
    score: null,
    placement: null,
    kills: null,
    absent: false,
    points: null,
    isWinner: null,
    checkedIn: false,
    stats: {},
    playerKills: {},
    status: 'ACTIVE',
    ...patch,
  };
}

export function lobbyMatch(names: string[], patch: Partial<Match> = {}): Match {
  return {
    id: 'fase~g1-q1',
    nodeId: 'g1-q1',
    tournamentId: 't1',
    stageId: 'fase',
    stageName: 'Final BR',
    groupId: 'g1',
    groupName: 'Sala 1',
    round: 1,
    position: 1,
    bracket: null,
    kind: 'LOBBY',
    bestOf: 1,
    roundLabel: 'Queda 1',
    dropIndex: 1,
    multiplier: 1,
    ifNecessary: false,
    status: 'SCHEDULED',
    waitingPrevious: false,
    scheduledAt: null,
    checkInOpensAt: null,
    checkInClosesAt: null,
    hasLobby: false,
    participants: names.map((name, i) => participant(`r${i + 1}`, name)),
    evidenceUrls: [],
    nextMatchId: null,
    loserNextMatchId: null,
    walkover: false,
    updatedAt: null,
    ...patch,
  };
}

export function duelMatch(a: string, b: string, patch: Partial<Match> = {}): Match {
  return lobbyMatch([a, b], { id: 'fase~qf1', nodeId: 'qf1', kind: 'DUEL', groupId: null, groupName: null, stageName: 'Mata-mata', roundLabel: 'Quartas de final', dropIndex: null, bracket: 'WINNERS', bestOf: 3, nextMatchId: 'fase~sf1', ...patch });
}

/** O jsdom não tem `ResizeObserver`, que os controles do Radix (checkbox, switch) usam. */
export function polyfillResizeObserver(): void {
  if (typeof globalThis.ResizeObserver !== 'undefined') return;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
