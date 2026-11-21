/**
 * Classificação da fase (issue #87, PRD ORG-09, RF-13, RN-02). Sempre derivada do retrato do motor: os pontos saem
 * das estatísticas brutas pelo modelo de pontuação da fase (RN-01), então trocar o modelo recalcula tudo.
 *
 * - `buildStandings`: a tabela no formato do contrato `Standings` (mesmos campos da API simulada).
 * - `persistStandings`: grava a tabela `standings` a cada resultado (consulta por SQL, perfil competitivo).
 * - `cachedStandings`: cache `standings:{stageId}` (Upstash em produção) com a versão da fase (`updatedAt`): toda
 *   escrita no retrato muda a versão, então o cache nunca serve tabela velha — nem depois de um W.O. do Cron.
 * - `standingsAt`: reconstitui a tabela num instante passado a partir do histórico de resultados (issue #86).
 */
import type { Prisma, PrismaClient } from '@nova/db';
import { computeStandings, type MatchResult, type Rule, type StageState, type Tiebreaker } from '@nova/engine';
import type { Standings, StandingRow } from '@nova/schemas';
import type { Cache } from '../cache';
import { namesFor } from './bracket';
import { dropCountOf, entryPoints } from './points';
import { readRun, type StageRun } from './run';

type Db = PrismaClient | Prisma.TransactionClient;

/** O que a classificação precisa da fase. */
export interface StandingsStage {
  id: string;
  tournamentId: string;
  format: Standings['format'];
  tiebreakers: unknown;
  qualification: unknown;
  updatedAt: Date;
  engineSnapshot: unknown;
  confirmedAt: Date | null;
  unlocked: boolean;
  scoringModel: { rules: unknown; matchType: 'DUEL' | 'TEAM_VS_TEAM' | 'BATTLE_ROYALE' };
}

export const standingsKey = (stageId: string) => `standings:${stageId}`;
const CACHE_TTL_SECONDS = 3600;

/** Regras e tipo de partida da fase (o modelo de pontuação ligado a ela). */
export function scoringOf(stage: Pick<StandingsStage, 'scoringModel'>): { rules: Rule[]; matchType: Standings['matchType'] } {
  return { rules: (stage.scoringModel.rules ?? []) as Rule[], matchType: stage.scoringModel.matchType };
}

type Qualification = { type: 'TOP_N_PER_GROUP' | 'TOP_N_OVERALL' | 'WINNERS'; n: number } | null;

/** Tabela da fase em formato de contrato. `state` permite calcular com outro estado (instante passado). */
export async function buildStandings(db: Db, stage: StandingsStage, opts: { state?: StageState; run?: StageRun | null } = {}): Promise<Standings> {
  const run = opts.run === undefined ? readRun(stage) : opts.run;
  const { rules, matchType } = scoringOf(stage);
  const empty: Standings = { stageId: stage.id, format: stage.format, matchType, groups: [], overall: [], drawUsed: false, drawSeed: null, mvp: [], updatedAt: stage.updatedAt.toISOString() };
  if (!run?.confirmed) return empty;
  const state = opts.state ?? run.state;

  const [names, groupRows, killRows] = await Promise.all([
    namesFor(db, stage.tournamentId),
    db.group.findMany({ where: { stageId: stage.id }, orderBy: { order: 'asc' }, select: { id: true } }),
    db.playerStat.findMany({
      where: { matchParticipant: { match: { stageId: stage.id } } },
      select: { userId: true, stats: true, user: { select: { nickname: true } }, matchParticipant: { select: { registrationId: true, match: { select: { nodeId: true } } } } },
    }),
  ]);
  // Grupos do motor casam com os do banco pela ordem (mesmos ids da chave).
  const groupIds = new Map(run.structure.groups.map((g, i) => [g.id, groupRows[i]?.id ?? g.id]));
  const dbGroup = (id: string | null) => (id ? (groupIds.get(id) ?? id) : null);

  const s = computeStandings(run.structure, state, { rules, tiebreakers: stage.tiebreakers as Tiebreaker[], scoreStat: 'score' });

  // Quem está na zona de classificação para a próxima fase.
  const q = stage.qualification as Qualification;
  const qualifying = new Set<string>();
  if (q?.type === 'TOP_N_PER_GROUP') for (const g of s.groups) for (const row of g.rows) if (row.position <= q.n && row.status === 'ACTIVE') qualifying.add(row.entrantId);
  if (q?.type === 'TOP_N_OVERALL') for (const row of s.overall) if (row.position <= q.n && row.status === 'ACTIVE') qualifying.add(row.entrantId);

  const lobbies = run.structure.matches.filter((m) => m.kind === 'LOBBY');
  const perDrop = (entrantId: string, groupId: string | null): StandingRow['perDrop'] =>
    lobbies
      .filter((m) => m.groupId === groupId && state.results[m.id] && !state.results[m.id]?.voided)
      .map((m) => {
        const result = state.results[m.id] as MatchResult;
        const entry = result.entries.find((e) => e.entrantId === entrantId);
        const points = entry ? entryPoints(entry, m, result, rules, dropCountOf(run.structure, m)).total : 0;
        return { dropIndex: m.dropIndex ?? 1, placement: entry?.absent ? null : (entry?.placement ?? null), kills: entry?.kills ?? 0, points };
      });

  const toRow = (row: (typeof s.overall)[number]): StandingRow => {
    const named = names.get(row.entrantId);
    return {
      registrationId: row.entrantId,
      name: named?.name ?? row.name,
      tag: named?.tag ?? null,
      logoUrl: named?.logoUrl ?? null,
      groupId: dbGroup(row.groupId),
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

  // Ranking de MVP: soma das kills por jogador (RN-03), só de resultados que valem.
  const kills = new Map<string, { kills: number; registrationId: string; nickname: string }>();
  for (const ps of killRows) {
    const result = state.results[ps.matchParticipant.match.nodeId];
    if (!result || result.voided) continue;
    const k = (ps.stats as { kills?: unknown } | null)?.kills;
    if (typeof k !== 'number') continue;
    const cur = kills.get(ps.userId) ?? { kills: 0, registrationId: ps.matchParticipant.registrationId, nickname: ps.user.nickname };
    cur.kills += k;
    kills.set(ps.userId, cur);
  }
  const mvp = [...kills.entries()]
    .map(([userId, v]) => ({ userId, nickname: v.nickname, teamName: names.get(v.registrationId)?.name ?? '', kills: v.kills }))
    .sort((a, b) => b.kills - a.kills || a.nickname.localeCompare(b.nickname))
    .slice(0, 20);

  return {
    stageId: stage.id,
    format: stage.format,
    matchType,
    groups: s.groups.map((g) => ({ groupId: dbGroup(g.groupId), name: g.name, rows: g.rows.map(toRow) })),
    overall: s.overall.map(toRow),
    drawUsed: s.drawUsed,
    drawSeed: s.drawUsed ? s.drawSeed : null,
    mvp,
    updatedAt: stage.updatedAt.toISOString(),
  };
}

/** Regrava a tabela `standings` da fase (na mesma transação do resultado). */
export async function persistStandings(tx: Prisma.TransactionClient, stage: StandingsStage, run: StageRun): Promise<Standings> {
  const table = await buildStandings(tx, stage, { run });
  await tx.standing.deleteMany({ where: { stageId: stage.id } });
  // Em grupos, a posição é a do grupo; nos demais formatos, a geral.
  const rows = table.groups.length > 0 && table.groups.some((g) => g.groupId) ? table.groups.flatMap((g) => g.rows) : table.overall;
  const groupIds = new Set((await tx.group.findMany({ where: { stageId: stage.id }, select: { id: true } })).map((g) => g.id));
  if (rows.length) {
    await tx.standing.createMany({
      data: rows.map((r) => ({
        stageId: stage.id,
        groupId: r.groupId && groupIds.has(r.groupId) ? r.groupId : null,
        registrationId: r.registrationId,
        position: r.position,
        points: r.points,
        played: r.played,
        wins: r.wins,
        draws: r.draws,
        losses: r.losses,
        booyahs: r.booyahs,
        kills: r.kills,
        scoreFor: r.scoreFor,
        scoreAgainst: r.scoreAgainst,
        avgPlacement: r.avgPlacement,
        tiebreakNote: r.tiebreakNote,
        qualified: r.qualifying,
      })),
      skipDuplicates: true,
    });
  }
  return table;
}

/** Classificação com cache (`standings:{stageId}`), invalidado pela versão da fase. */
export async function cachedStandings(db: Db, cache: Cache, stageId: string, version: Date, load: () => Promise<StandingsStage>): Promise<Standings> {
  const key = standingsKey(stageId);
  const hit = await cache.get<{ version: string; data: Standings }>(key).catch(() => null);
  if (hit && hit.version === version.toISOString()) return hit.data;
  const data = await buildStandings(db, await load());
  await cache.set(key, { version: version.toISOString(), data }, CACHE_TTL_SECONDS).catch(() => undefined);
  return data;
}

/**
 * Estado da fase num instante passado, pelo histórico de resultados (issue #86): em cada partida vale o último
 * evento até `at`; partida com histórico mas sem evento até lá fica sem resultado. Partidas sem nenhum evento
 * (resultado anterior ao histórico) ficam como estão. Desistências e desclassificações valem como hoje.
 */
export async function stateAt(db: Db, stageId: string, run: StageRun, at: Date): Promise<StageState> {
  const events = await db.resultEvent.findMany({ where: { match: { stageId } }, orderBy: { id: 'asc' }, select: { after: true, createdAt: true, match: { select: { nodeId: true } } } });
  const withHistory = new Set(events.map((e) => e.match.nodeId));
  const results: Record<string, MatchResult> = {};
  for (const [nodeId, result] of Object.entries(run.state.results)) if (!withHistory.has(nodeId)) results[nodeId] = result;
  for (const e of events) {
    if (e.createdAt.getTime() > at.getTime()) continue;
    const result = (e.after as { result?: MatchResult | null } | null)?.result;
    if (result) results[e.match.nodeId] = result;
    else delete results[e.match.nodeId];
  }
  return { ...run.state, results, skipped: run.state.skipped };
}
