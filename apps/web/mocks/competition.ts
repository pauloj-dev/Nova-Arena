/**
 * Núcleo de competição da API simulada: liga o banco simulado ao motor (`@nova/engine`).
 * Guarda, por fase, a estrutura da chave e o estado dos resultados, e monta as respostas
 * no formato dos contratos (`Bracket`, `Match`, `Standings`).
 *
 * Regra de ouro (RN-01): pontos nunca vêm do cliente — tudo é derivado aqui, pelo motor.
 */
import {
  computePoints,
  computeStandings,
  createStageState,
  getMatchStatus,
  isStageComplete,
  type Entrant,
  type MatchNode,
  type QualificationRule,
  type ResultEntry,
  type Rule,
  type StageConfig as EngineConfig,
  type StageState,
  type StageStructure,
} from '@nova/engine';
import type { Bracket, Match, MatchParticipant, MatchStatus, Stage, Standings, StandingRow } from '@nova/schemas';
import { collection, db, nowIso, save, type DbRegistration, type DbTournament } from './db';
import { notFound } from './http';
import { toRegistration } from './views';

export interface DbStageRun {
  stageId: string;
  tournamentId: string;
  structure: StageStructure;
  state: StageState;
  /** Falso enquanto a chave é só uma prévia do organizador. */
  confirmed: boolean;
  /** Admin destravou a chave depois da 1ª partida concluída. */
  unlocked: boolean;
  updatedAt: string;
}

export interface DbCheckIn {
  registrationId: string;
  userId: string;
  at: string;
}

export interface DbMatchMeta {
  /** `<stageId>~<nodeId>` */
  id: string;
  scheduledAt: string | null;
  lobbyCode: string | null;
  lobbyPassword: string | null;
  checkIns: DbCheckIn[];
  evidenceUrls: string[];
  /** Kills por jogador: registrationId → userId → kills. */
  playerKills: Record<string, Record<string, number>>;
  /** Marcação manual do staff ou do fluxo de disputa. */
  statusOverride: 'LIVE' | 'AWAITING_VALIDATION' | 'DISPUTED' | null;
  updatedAt: string | null;
}

export interface DbPodium {
  tournamentId: string;
  places: { place: number; registrationId: string }[];
  finishedAt: string;
}

export const SEP = '~';
export const matchId = (stageId: string, nodeId: string) => `${stageId}${SEP}${nodeId}`;
export function splitMatchId(id: string): { stageId: string; nodeId: string } {
  const i = id.indexOf(SEP);
  if (i < 0) throw notFound('Partida');
  return { stageId: id.slice(0, i), nodeId: id.slice(i + 1) };
}

export const stageRuns = () => collection<DbStageRun>('stageRuns');
export const matchMetas = () => collection<DbMatchMeta>('matchMeta');
export const podiums = () => collection<DbPodium>('podiums');

export function findStage(stageId: string): { tournament: DbTournament; stage: Stage } {
  for (const tournament of db().tournaments) {
    const stage = tournament.stages.find((s) => s.id === stageId);
    if (stage) return { tournament, stage };
  }
  throw notFound('Fase');
}

export function getRun(stageId: string): DbStageRun | undefined {
  return stageRuns().find((r) => r.stageId === stageId);
}
export function putRun(run: DbStageRun): void {
  const list = stageRuns();
  const i = list.findIndex((r) => r.stageId === run.stageId);
  run.updatedAt = nowIso();
  if (i >= 0) list[i] = run;
  else list.push(run);
  save();
}
export function removeRun(stageId: string): void {
  const list = stageRuns();
  const i = list.findIndex((r) => r.stageId === stageId);
  if (i >= 0) list.splice(i, 1);
  const metas = matchMetas();
  for (let k = metas.length - 1; k >= 0; k -= 1) if (metas[k]?.id.startsWith(`${stageId}${SEP}`)) metas.splice(k, 1);
  save();
}

export function getMeta(id: string): DbMatchMeta {
  const metas = matchMetas();
  let meta = metas.find((m) => m.id === id);
  if (!meta) {
    meta = { id, scheduledAt: null, lobbyCode: null, lobbyPassword: null, checkIns: [], evidenceUrls: [], playerKills: {}, statusOverride: null, updatedAt: null };
    metas.push(meta);
  }
  return meta;
}

// ── Adaptação do contrato para o motor ───────────────────────────────
export function scoringOf(tournament: DbTournament, stage: Stage): { rules: Rule[]; matchType: 'DUEL' | 'TEAM_VS_TEAM' | 'BATTLE_ROYALE' } {
  const game = db().games.find((g) => g.id === tournament.gameId);
  const model = game?.scoringModels.find((m) => m.id === stage.scoringModelId);
  const lobby = stage.format === 'BATTLE_ROYALE' || (stage.format === 'GROUPS' && stage.config.groupMode === 'BATTLE_ROYALE');
  return { rules: (model?.rules ?? []) as Rule[], matchType: model?.matchType ?? (lobby ? 'BATTLE_ROYALE' : 'DUEL') };
}

export function toEngineConfig(stage: Stage): EngineConfig {
  const c = stage.config;
  const config: EngineConfig = { bestOf: c.bestOf, killsPerPlayer: c.killsPerPlayer };
  const drops = (): Pick<EngineConfig, 'drops' | 'dropMultipliers'> =>
    c.lastDropMultiplier > 1 ? { drops: c.drops, dropMultipliers: Array.from({ length: c.drops }, (_, i) => (i === c.drops - 1 ? c.lastDropMultiplier : 1)) } : { drops: c.drops };
  switch (stage.format) {
    case 'SINGLE_ELIM':
    case 'TEAM_VS_TEAM':
      config.thirdPlace = c.thirdPlace;
      // "Vencedores" com N > 1: a chave para quando restarem N (ex.: mata-mata até sobrarem 2 finalistas).
      if (stage.qualification?.type === 'WINNERS' && stage.qualification.n > 1) {
        config.stopAtRemaining = stage.qualification.n;
        config.thirdPlace = false;
      }
      break;
    case 'DOUBLE_ELIM':
      config.grandFinalReset = c.grandFinalReset;
      break;
    case 'GROUPS':
      config.groupCount = c.groupCount;
      config.groupMode = c.groupMode === 'BATTLE_ROYALE' ? 'BATTLE_ROYALE' : 'ROUND_ROBIN';
      config.doubleRound = c.doubleRound;
      if (c.groupMode === 'BATTLE_ROYALE') Object.assign(config, drops());
      break;
    case 'ROUND_ROBIN':
      config.doubleRound = c.doubleRound;
      break;
    case 'SWISS':
      config.rounds = c.rounds;
      break;
    case 'BATTLE_ROYALE':
      config.lobbySize = c.lobbySize;
      Object.assign(config, drops());
      break;
  }
  return config;
}

export function toEngineQualification(stage: Stage): QualificationRule | null {
  const q = stage.qualification;
  if (!q) return null;
  const repechage = q.repechage > 0 ? { repechage: q.repechage } : {};
  if (q.type === 'WINNERS') return { type: 'WINNERS', ...repechage };
  return { type: q.type, n: q.n, ...repechage };
}

/** Inscritos confirmados, na ordem de inscrição (base do chaveamento da 1ª fase). */
export function confirmedRegistrations(tournamentId: string): DbRegistration[] {
  return db()
    .registrations.filter((r) => r.tournamentId === tournamentId && r.status === 'CONFIRMED')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

interface Named {
  name: string;
  tag: string | null;
  logoUrl: string | null;
}
function namesFor(tournamentId: string): Map<string, Named> {
  const map = new Map<string, Named>();
  for (const r of db().registrations) {
    if (r.tournamentId !== tournamentId) continue;
    const view = toRegistration(r);
    map.set(r.id, { name: view.displayName, tag: view.tag, logoUrl: view.logoUrl });
  }
  return map;
}
export function entrantsFrom(registrations: DbRegistration[]): Entrant[] {
  return registrations.map((r) => {
    const view = toRegistration(r);
    return { id: r.id, name: view.displayName, ...(r.seed !== null ? { seed: r.seed } : {}) };
  });
}

// ── Janela de check-in e status da partida ───────────────────────────
export function checkInWindow(tournament: DbTournament, scheduledAt: string | null): { opensAt: string; closesAt: string } | null {
  if (!scheduledAt || !tournament.checkIn.enabled) return null;
  const t = new Date(scheduledAt).getTime();
  return {
    opensAt: new Date(t - tournament.checkIn.opensMinutesBefore * 60_000).toISOString(),
    closesAt: new Date(t - tournament.checkIn.closesMinutesBefore * 60_000).toISOString(),
  };
}

/** Quem precisa fazer check-in por aquela inscrição: o jogador (solo), o capitão ou todos os titulares confirmados. */
export function checkInRequired(tournament: DbTournament, registration: DbRegistration): string[] {
  if (registration.userId) return [registration.userId];
  const team = db().teams.find((t) => t.id === registration.teamId);
  if (!team) return [];
  if (tournament.checkIn.requireAllMembers) return registration.members.filter((m) => !m.isSub && m.confirmedAt).map((m) => m.userId);
  return [team.captainId];
}
export function isCheckedIn(tournament: DbTournament, registration: DbRegistration | undefined, meta: DbMatchMeta): boolean {
  if (!registration) return false;
  const required = checkInRequired(tournament, registration);
  if (required.length === 0) return false;
  return required.every((userId) => meta.checkIns.some((c) => c.registrationId === registration.id && c.userId === userId));
}

function statusOf(run: DbStageRun, node: MatchNode, meta: DbMatchMeta, tournament: DbTournament, now: number): MatchStatus {
  const engineStatus = getMatchStatus(run.structure, run.state, node.id);
  const result = run.state.results[node.id];
  if (engineStatus === 'SKIPPED' || engineStatus === 'VOIDED') return 'CANCELLED';
  if (result) return result.walkover ? 'WALKOVER' : 'VALIDATED';
  if (engineStatus === 'BYE') return 'VALIDATED';
  if (meta.statusOverride) return meta.statusOverride;
  if (!meta.scheduledAt) return 'SCHEDULED';
  const start = new Date(meta.scheduledAt).getTime();
  if (now >= start) return engineStatus === 'READY' ? 'LIVE' : 'SCHEDULED';
  const window = checkInWindow(tournament, meta.scheduledAt);
  if (window && now >= new Date(window.opensAt).getTime() && now < new Date(window.closesAt).getTime()) return 'CHECK_IN';
  return 'SCHEDULED';
}

// ── Pontos por participação ──────────────────────────────────────────
function entryPoints(
  entry: ResultEntry,
  node: MatchNode,
  result: { winnerId: string | null; draw: boolean },
  rules: Rule[],
  dropCount: number,
): { total: number; breakdown: { label: string; points: number }[] } {
  if (node.kind === 'LOBBY') {
    if (entry.absent) return { total: 0, breakdown: [] };
    const r = computePoints({ kills: entry.kills ?? 0, placement: entry.placement, ...entry.stats }, rules, {
      matchIndex: node.dropIndex ?? 1,
      matchCount: dropCount,
      multiplier: node.multiplier ?? 1,
    });
    return { total: r.total, breakdown: r.breakdown.map((b) => ({ label: b.label, points: b.points })) };
  }
  const outcome = result.draw ? 'draw' : result.winnerId === entry.entrantId ? 'win' : 'loss';
  const r = computePoints({ score: entry.score ?? 0, outcome, ...entry.stats }, rules);
  return { total: r.total, breakdown: r.breakdown.map((b) => ({ label: b.label, points: b.points })) };
}

function dropCountOf(run: DbStageRun, node: MatchNode): number {
  return run.structure.matches.filter((m) => m.kind === 'LOBBY' && m.groupId === node.groupId).length;
}

function sourceLabel(run: DbStageRun, source: { matchId: string; outcome: 'winner' | 'loser' } | undefined): string | null {
  if (!source) return null;
  const from = run.structure.matches.find((m) => m.id === source.matchId);
  if (!from) return 'A definir';
  const sameRound = run.structure.matches.filter((m) => m.round === from.round && m.bracket === from.bracket && m.groupId === from.groupId).length;
  const which = sameRound > 1 ? ` ${from.position}` : '';
  return `${source.outcome === 'winner' ? 'Vencedor' : 'Perdedor'}: ${from.roundLabel}${which}`;
}

export function buildMatch(run: DbStageRun, node: MatchNode, ctx?: { tournament: DbTournament; stage: Stage; names: Map<string, Named>; rules: Rule[] }): Match {
  const { tournament, stage } = ctx ?? findStage(run.stageId);
  const names = ctx?.names ?? namesFor(tournament.id);
  const rules = ctx?.rules ?? scoringOf(tournament, stage).rules;
  const id = matchId(run.stageId, node.id);
  const meta = getMeta(id);
  const result = run.state.results[node.id];
  const now = Date.now();
  const window = checkInWindow(tournament, meta.scheduledAt);
  const dropCount = node.kind === 'LOBBY' ? dropCountOf(run, node) : 1;
  const seeds = new Map(run.structure.entrants.map((e) => [e.id, e.seed ?? null]));
  const regs = new Map(db().registrations.filter((r) => r.tournamentId === tournament.id).map((r) => [r.id, r]));

  const participants: MatchParticipant[] = node.slots.map((slot) => {
    const entry = result?.entries.find((e) => e.entrantId === slot.entrantId);
    const named = slot.entrantId ? names.get(slot.entrantId) : undefined;
    const points = entry && result && !result.voided ? entryPoints(entry, node, result, rules, dropCount).total : null;
    const stats: Record<string, number> = {};
    for (const [k, v] of Object.entries(entry?.stats ?? {})) if (typeof v === 'number') stats[k] = v;
    return {
      registrationId: slot.entrantId,
      name: named?.name ?? (slot.entrantId ? 'Inscrito' : 'A definir'),
      tag: named?.tag ?? null,
      logoUrl: named?.logoUrl ?? null,
      seed: slot.entrantId ? (seeds.get(slot.entrantId) ?? null) : null,
      sourceLabel: slot.entrantId ? null : sourceLabel(run, slot.source),
      isBye: slot.isBye ?? false,
      score: entry?.score ?? null,
      placement: entry?.placement ?? null,
      kills: entry?.kills ?? null,
      absent: entry?.absent ?? false,
      points,
      isWinner: result ? (node.kind === 'LOBBY' ? entry?.placement === 1 : result.winnerId === slot.entrantId) : null,
      checkedIn: slot.entrantId ? isCheckedIn(tournament, regs.get(slot.entrantId), meta) : false,
      stats,
      playerKills: slot.entrantId ? (meta.playerKills[slot.entrantId] ?? {}) : {},
      status: slot.entrantId ? (run.state.entrantStatus[slot.entrantId] ?? 'ACTIVE') : 'ACTIVE',
    };
  });

  const group = node.groupId ? run.structure.groups.find((g) => g.id === node.groupId) : undefined;
  return {
    id,
    nodeId: node.id,
    tournamentId: tournament.id,
    stageId: stage.id,
    stageName: stage.name,
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
    status: statusOf(run, node, meta, tournament, now),
    waitingPrevious: node.slots.some((s) => s.entrantId === null),
    scheduledAt: meta.scheduledAt,
    checkInOpensAt: window?.opensAt ?? null,
    checkInClosesAt: window?.closesAt ?? null,
    hasLobby: Boolean(meta.lobbyCode),
    participants,
    evidenceUrls: meta.evidenceUrls,
    nextMatchId: node.nextMatchId ? matchId(run.stageId, node.nextMatchId) : null,
    loserNextMatchId: node.loserNextMatchId ? matchId(run.stageId, node.loserNextMatchId) : null,
    walkover: result?.walkover ?? false,
    updatedAt: meta.updatedAt,
  };
}

/** Vagas de bye (duelo de uma vaga só no suíço) não são partidas para a tela. */
function visibleNodes(run: DbStageRun): MatchNode[] {
  return run.structure.matches.filter((m) => !(m.kind === 'DUEL' && m.slots.length === 1));
}

export function isLocked(run: DbStageRun): boolean {
  if (!run.confirmed || run.unlocked) return false;
  return Object.values(run.state.results).some((r) => !r.voided);
}

export function buildBracket(stageId: string, opts: { includePreview: boolean }): Bracket {
  const { tournament, stage } = findStage(stageId);
  const run = getRun(stageId);
  if (!run || (!run.confirmed && !opts.includePreview)) {
    return { stageId, tournamentId: tournament.id, format: stage.format, state: 'NONE', seeding: null, seedUsed: null, locked: false, rounds: 0, groups: [], entrants: [], matches: [], complete: false };
  }
  const names = namesFor(tournament.id);
  const ctx = { tournament, stage, names, rules: scoringOf(tournament, stage).rules };
  return {
    stageId,
    tournamentId: tournament.id,
    format: stage.format,
    state: run.confirmed ? 'CONFIRMED' : 'PREVIEW',
    seeding: run.structure.seeding,
    seedUsed: run.structure.seedUsed,
    locked: isLocked(run),
    rounds: run.structure.rounds,
    groups: run.structure.groups.map((g) => ({ id: g.id, name: g.name, registrationIds: g.entrantIds })),
    entrants: run.structure.entrants.map((e, i) => ({ registrationId: e.id, name: names.get(e.id)?.name ?? e.name ?? 'Inscrito', tag: names.get(e.id)?.tag ?? null, seed: e.seed ?? i + 1 })),
    matches: visibleNodes(run).map((node) => buildMatch(run, node, ctx)),
    complete: run.confirmed && isStageComplete(run.structure, run.state),
  };
}

export function listMatches(tournamentId: string, stageId?: string | null): Match[] {
  const tournament = db().tournaments.find((t) => t.id === tournamentId);
  if (!tournament) throw notFound('Campeonato');
  const names = namesFor(tournamentId);
  const out: Match[] = [];
  for (const stage of [...tournament.stages].sort((a, b) => a.order - b.order)) {
    if (stageId && stage.id !== stageId) continue;
    const run = getRun(stage.id);
    if (!run?.confirmed) continue;
    const ctx = { tournament, stage, names, rules: scoringOf(tournament, stage).rules };
    for (const node of visibleNodes(run)) out.push(buildMatch(run, node, ctx));
  }
  return out;
}

export function buildStandings(stageId: string): Standings {
  const { tournament, stage } = findStage(stageId);
  const run = getRun(stageId);
  const { rules, matchType } = scoringOf(tournament, stage);
  const empty: Standings = { stageId, format: stage.format, matchType, groups: [], overall: [], drawUsed: false, drawSeed: null, mvp: [], updatedAt: nowIso() };
  if (!run?.confirmed) return empty;

  const names = namesFor(tournament.id);
  const s = computeStandings(run.structure, run.state, { rules, tiebreakers: stage.tiebreakers, scoreStat: 'score' });

  // Quem está na zona de classificação para a próxima fase.
  const q = stage.qualification;
  const qualifying = new Set<string>();
  if (q?.type === 'TOP_N_PER_GROUP') for (const g of s.groups) for (const row of g.rows) if (row.position <= q.n && row.status === 'ACTIVE') qualifying.add(row.entrantId);
  if (q?.type === 'TOP_N_OVERALL') for (const row of s.overall) if (row.position <= q.n && row.status === 'ACTIVE') qualifying.add(row.entrantId);

  const lobbies = run.structure.matches.filter((m) => m.kind === 'LOBBY');
  const perDrop = (entrantId: string, groupId: string | null): StandingRow['perDrop'] =>
    lobbies
      .filter((m) => m.groupId === groupId && run.state.results[m.id] && !run.state.results[m.id]?.voided)
      .map((m) => {
        const result = run.state.results[m.id];
        const entry = result?.entries.find((e) => e.entrantId === entrantId);
        const points = entry && result ? entryPoints(entry, m, result, rules, dropCountOf(run, m)).total : 0;
        return { dropIndex: m.dropIndex ?? 1, placement: entry?.absent ? null : (entry?.placement ?? null), kills: entry?.kills ?? 0, points };
      });

  const toRow = (row: (typeof s.overall)[number]): StandingRow => {
    const named = names.get(row.entrantId);
    return {
      registrationId: row.entrantId,
      name: named?.name ?? row.name,
      tag: named?.tag ?? null,
      logoUrl: named?.logoUrl ?? null,
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
      qualifying: qualifying.has(row.entrantId),
      perDrop: perDrop(row.entrantId, row.groupId),
    };
  };

  // Ranking de MVP: soma das kills por jogador (RN-03).
  const kills = new Map<string, { kills: number; registrationId: string }>();
  for (const meta of matchMetas()) {
    if (!meta.id.startsWith(`${stageId}${SEP}`)) continue;
    const nodeId = splitMatchId(meta.id).nodeId;
    if (!run.state.results[nodeId] || run.state.results[nodeId]?.voided) continue;
    for (const [registrationId, byUser] of Object.entries(meta.playerKills)) {
      for (const [userId, k] of Object.entries(byUser)) {
        const cur = kills.get(userId) ?? { kills: 0, registrationId };
        cur.kills += k;
        kills.set(userId, cur);
      }
    }
  }
  const mvp = [...kills.entries()]
    .map(([userId, v]) => ({ userId, nickname: db().users.find((u) => u.id === userId)?.nickname ?? 'Jogador', teamName: names.get(v.registrationId)?.name ?? '', kills: v.kills }))
    .sort((a, b) => b.kills - a.kills)
    .slice(0, 20);

  return {
    stageId,
    format: stage.format,
    matchType,
    groups: s.groups.map((g) => ({ groupId: g.groupId, name: g.name, rows: g.rows.map(toRow) })),
    overall: s.overall.map(toRow),
    drawUsed: s.drawUsed,
    drawSeed: s.drawUsed ? s.drawSeed : null,
    mvp,
    updatedAt: run.updatedAt,
  };
}

export function newRun(stageId: string, tournamentId: string, structure: StageStructure, confirmed: boolean): DbStageRun {
  return { stageId, tournamentId, structure, state: createStageState(), confirmed, unlocked: false, updatedAt: nowIso() };
}

/** Usuários ligados a uma inscrição (o jogador solo ou os membros confirmados do squad). */
export function usersOfRegistration(registrationId: string): string[] {
  const r = db().registrations.find((x) => x.id === registrationId);
  if (!r) return [];
  if (r.userId) return [r.userId];
  return r.members.filter((m) => m.confirmedAt).map((m) => m.userId);
}

/** A inscrição pela qual aquele usuário participa do campeonato (ou nulo). */
export function registrationOfUser(tournamentId: string, userId: string): DbRegistration | null {
  return (
    db().registrations.find(
      (r) => r.tournamentId === tournamentId && ['CONFIRMED', 'WITHDRAWN', 'DISQUALIFIED'].includes(r.status) && (r.userId === userId || r.members.some((m) => m.userId === userId && m.confirmedAt)),
    ) ?? null
  );
}
