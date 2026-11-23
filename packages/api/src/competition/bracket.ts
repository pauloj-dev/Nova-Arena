/**
 * Leitura da chave em formato de contrato (`Bracket`, `Match`), a partir do retrato do motor e da projeção.
 * Mesmos campos da API simulada (`apps/web/mocks/competition.ts`); o `id` da partida é o da tabela `matches`.
 */
import type { Prisma, PrismaClient } from '@nova/db';
import { getMatchStatus, isStageComplete, type MatchNode, type Rule } from '@nova/engine';
import type { Bracket, Match, MatchParticipant, MatchStatus } from '@nova/schemas';
import { checkInOf, toStage } from '../modules/tournaments/views';
import { isComplete, loadRoster } from './check-in';
import { dropCountOf, entryPoints } from './points';
import { isLocked, readRun, type StageRun } from './run';

type Db = PrismaClient | Prisma.TransactionClient;
type StageRow = Prisma.StageGetPayload<{ include: { tournament: true; scoringModel: { select: { rules: true; matchType: true } } } }>;
type MatchRow = {
  id: string;
  nodeId: string;
  scheduledAt: Date | null;
  lobbyCodeEnc: string | null;
  evidenceUrls: string[];
  status: MatchStatus;
  updatedAt: Date;
  checkIns: { registrationId: string; userId: string }[];
  participants?: { registrationId: string; playerStats: { userId: string; stats: unknown }[] }[];
};
/** Colunas da partida que a tela usa (com os check-ins feitos). */
const matchRowSelect = {
  id: true,
  nodeId: true,
  scheduledAt: true,
  lobbyCodeEnc: true,
  evidenceUrls: true,
  status: true,
  updatedAt: true,
  checkIns: { select: { registrationId: true, userId: true } },
  participants: { select: { registrationId: true, playerStats: { select: { userId: true, stats: true } } } },
} as const;

/** Kills por jogador (RN-03) de uma inscrição na partida: `userId → kills`. */
function playerKillsOf(row: MatchRow | undefined, registrationId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ps of row?.participants?.find((p) => p.registrationId === registrationId)?.playerStats ?? []) {
    const kills = (ps.stats as { kills?: unknown } | null)?.kills;
    if (typeof kills === 'number') out[ps.userId] = kills;
  }
  return out;
}
interface Named {
  name: string;
  tag: string | null;
  logoUrl: string | null;
}

export async function namesFor(db: Db, tournamentId: string): Promise<Map<string, Named>> {
  const rows = await db.registration.findMany({ where: { tournamentId }, select: { id: true, displayName: true, tag: true, team: { select: { name: true, tag: true, logoUrl: true } }, user: { select: { nickname: true, avatarUrl: true } } } });
  return new Map(rows.map((r) => [r.id, { name: r.displayName ?? r.team?.name ?? r.user?.nickname ?? 'Inscrito', tag: r.tag ?? r.team?.tag ?? null, logoUrl: r.team?.logoUrl ?? r.user?.avatarUrl ?? null }]));
}

export function checkInWindow(tournament: { checkInConfig: unknown }, scheduledAt: Date | null): { opensAt: string; closesAt: string } | null {
  const cfg = checkInOf(tournament.checkInConfig);
  if (!cfg.enabled || !scheduledAt) return null;
  return { opensAt: new Date(scheduledAt.getTime() - cfg.opensMinutesBefore * 60_000).toISOString(), closesAt: new Date(scheduledAt.getTime() - cfg.closesMinutesBefore * 60_000).toISOString() };
}

function statusOf(run: StageRun, node: MatchNode, row: MatchRow | undefined, tournament: { checkInConfig: unknown }, now: number): MatchStatus {
  const engineStatus = getMatchStatus(run.structure, run.state, node.id);
  const result = run.state.results[node.id];
  if (engineStatus === 'SKIPPED' || engineStatus === 'VOIDED') return 'CANCELLED';
  if (result) return result.walkover ? 'WALKOVER' : 'VALIDATED';
  if (engineStatus === 'BYE') return 'VALIDATED';
  // Estados da operação gravados na partida (aguardando validação, disputa) valem sobre o calculado.
  if (row && ['AWAITING_VALIDATION', 'DISPUTED', 'LIVE'].includes(row.status)) return row.status;
  if (!row?.scheduledAt) return 'SCHEDULED';
  const start = row.scheduledAt.getTime();
  if (now >= start) return engineStatus === 'READY' ? 'LIVE' : 'SCHEDULED';
  const window = checkInWindow(tournament, row.scheduledAt);
  if (window && now >= Date.parse(window.opensAt) && now < Date.parse(window.closesAt)) return 'CHECK_IN';
  return 'SCHEDULED';
}

function sourceLabel(run: StageRun, source: { matchId: string; outcome: 'winner' | 'loser' } | undefined): string | null {
  if (!source) return null;
  const from = run.structure.matches.find((m) => m.id === source.matchId);
  if (!from) return 'A definir';
  const sameRound = run.structure.matches.filter((m) => m.round === from.round && m.bracket === from.bracket && m.groupId === from.groupId).length;
  const which = sameRound > 1 ? ` ${from.position}` : '';
  return `${source.outcome === 'winner' ? 'Vencedor' : 'Perdedor'}: ${from.roundLabel}${which}`;
}

/** Vagas de bye (duelo de uma vaga só no suíço) não são partidas para a tela. */
const visibleNodes = (run: StageRun) => run.structure.matches.filter((m) => !(m.kind === 'DUEL' && m.slots.length === 1));

export function buildMatches(stage: StageRow, run: StageRun, rows: Map<string, MatchRow>, names: Map<string, Named>, groupIds: Map<string, string>, roster: Map<string, string[]> = new Map()): Match[] {
  const rules = (stage.scoringModel.rules ?? []) as Rule[];
  const seeds = new Map(run.structure.entrants.map((e) => [e.id, e.seed ?? null]));
  const now = Date.now();
  const idOf = (nodeId: string | null) => (nodeId ? (rows.get(nodeId)?.id ?? null) : null);
  return visibleNodes(run).map((node) => {
    const row = rows.get(node.id);
    const result = run.state.results[node.id];
    const dropCount = dropCountOf(run.structure, node);
    const window = checkInWindow(stage.tournament, row?.scheduledAt ?? null);
    const participants: MatchParticipant[] = node.slots.map((slot) => {
      const entry = result?.entries.find((e) => e.entrantId === slot.entrantId);
      const named = slot.entrantId ? names.get(slot.entrantId) : undefined;
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
        points: entry && result && !result.voided ? entryPoints(entry, node, result, rules, dropCount).total : null,
        isWinner: result ? (node.kind === 'LOBBY' ? entry?.placement === 1 : result.winnerId === slot.entrantId) : null,
        checkedIn: slot.entrantId ? isComplete(roster.get(slot.entrantId), row?.checkIns ?? [], slot.entrantId) : false,
        checkedInUserIds: slot.entrantId ? (row?.checkIns ?? []).filter((c) => c.registrationId === slot.entrantId).map((c) => c.userId) : [],
        stats,
        playerKills: slot.entrantId ? playerKillsOf(row, slot.entrantId) : {},
        status: slot.entrantId ? (run.state.entrantStatus[slot.entrantId] ?? 'ACTIVE') : 'ACTIVE',
      };
    });
    const group = node.groupId ? run.structure.groups.find((g) => g.id === node.groupId) : undefined;
    return {
      id: row?.id ?? `${stage.id}~${node.id}`,
      nodeId: node.id,
      tournamentId: stage.tournamentId,
      stageId: stage.id,
      stageName: stage.name,
      groupId: node.groupId ? (groupIds.get(node.groupId) ?? node.groupId) : null,
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
      status: statusOf(run, node, row, stage.tournament, now),
      waitingPrevious: node.slots.some((s) => s.entrantId === null),
      scheduledAt: row?.scheduledAt?.toISOString() ?? null,
      checkInOpensAt: window?.opensAt ?? null,
      checkInClosesAt: window?.closesAt ?? null,
      hasLobby: Boolean(row?.lobbyCodeEnc),
      participants,
      evidenceUrls: row?.evidenceUrls ?? [],
      nextMatchId: idOf(node.nextMatchId),
      loserNextMatchId: idOf(node.loserNextMatchId),
      walkover: result?.walkover ?? false,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  });
}

/** Chave da fase. A prévia (antes de confirmar) só aparece para a organização (`includePreview`). */
export async function buildBracket(db: Db, stage: StageRow, opts: { includePreview: boolean; run?: StageRun }): Promise<Bracket> {
  // `run` em memória: prévia que ainda não foi gravada (ex.: a próxima fase no avanço).
  const run = opts.run ?? readRun(stage);
  const format = toStage(stage).format;
  if (!run || (!run.confirmed && !opts.includePreview)) {
    return { stageId: stage.id, tournamentId: stage.tournamentId, format, state: 'NONE', seeding: null, seedUsed: null, locked: false, rounds: 0, groups: [], entrants: [], matches: [], complete: false };
  }
  const [names, roster, matchRows, groupRows] = await Promise.all([
    namesFor(db, stage.tournamentId),
    loadRoster(db, stage.tournament),
    db.match.findMany({ where: { stageId: stage.id }, select: matchRowSelect }),
    db.group.findMany({ where: { stageId: stage.id }, orderBy: { order: 'asc' }, select: { id: true } }),
  ]);
  const rows = new Map(matchRows.map((m) => [m.nodeId, m]));
  // Grupos do motor casam com os do banco pela ordem.
  const groupIds = new Map(run.structure.groups.map((g, i) => [g.id, groupRows[i]?.id ?? g.id]));
  return {
    stageId: stage.id,
    tournamentId: stage.tournamentId,
    format,
    state: run.confirmed ? 'CONFIRMED' : 'PREVIEW',
    seeding: run.structure.seeding,
    seedUsed: run.structure.seedUsed,
    locked: isLocked(run),
    rounds: run.structure.rounds,
    groups: run.structure.groups.map((g) => ({ id: groupIds.get(g.id) ?? g.id, name: g.name, registrationIds: g.entrantIds })),
    entrants: run.structure.entrants.map((e, i) => ({ registrationId: e.id, name: names.get(e.id)?.name ?? e.name ?? 'Inscrito', tag: names.get(e.id)?.tag ?? null, seed: e.seed ?? i + 1 })),
    matches: buildMatches(stage, run, rows, names, groupIds, roster),
    complete: run.confirmed && isStageComplete(run.structure, run.state),
  };
}

const stageInclude = { tournament: true, scoringModel: { select: { rules: true, matchType: true } } } as const;

/** Partidas das fases com chave confirmada (todas, ou só de uma fase). */
export async function listMatches(db: Db, tournamentId: string, stageId?: string | null): Promise<Match[]> {
  const stages = await db.stage.findMany({ where: { tournamentId, confirmedAt: { not: null }, ...(stageId ? { id: stageId } : {}) }, include: stageInclude, orderBy: { order: 'asc' } });
  if (stages.length === 0) return [];
  const [names, roster] = await Promise.all([namesFor(db, tournamentId), loadRoster(db, stages[0]?.tournament ?? { id: tournamentId, checkInConfig: null })]);
  const out: Match[] = [];
  for (const stage of stages) {
    const run = readRun(stage);
    if (!run) continue;
    const [matchRows, groupRows] = await Promise.all([
      db.match.findMany({ where: { stageId: stage.id }, select: matchRowSelect }),
      db.group.findMany({ where: { stageId: stage.id }, orderBy: { order: 'asc' }, select: { id: true } }),
    ]);
    const groupIds = new Map(run.structure.groups.map((g, i) => [g.id, groupRows[i]?.id ?? g.id]));
    out.push(...buildMatches(stage, run, new Map(matchRows.map((m) => [m.nodeId, m])), names, groupIds, roster));
  }
  return out;
}

/** Uma partida (pelo `id` da tabela) com a fase, o retrato e o nó do motor. Partida de chave não confirmada = 404. */
export async function findMatch(db: Db, matchId: string) {
  const row = /^[0-9a-f-]{36}$/i.test(matchId) ? await db.match.findUnique({ where: { id: matchId }, include: { stage: { include: stageInclude } } }) : null;
  const run = row ? readRun(row.stage) : null;
  const node = run?.structure.matches.find((m) => m.id === row?.nodeId);
  if (!row || !run || !run.confirmed || !node) return null;
  return { row, stage: row.stage, run, node };
}

export async function matchView(db: Db, matchId: string): Promise<Match | null> {
  const found = await findMatch(db, matchId);
  if (!found) return null;
  const all = await listMatches(db, found.stage.tournamentId, found.stage.id);
  return all.find((m) => m.id === matchId) ?? null;
}
