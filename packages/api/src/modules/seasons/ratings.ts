/**
 * Rating da temporada na API real (issue #120, ADR-0003). O rating não é gravado: é o replay (`@nova/engine`) das
 * partidas validadas do jogo dentro da temporada, lidas do retrato do motor de cada fase (fonte da verdade, ADR-0002).
 *
 * Cache por versão: a chave leva o último evento do histórico de resultados do jogo (`result_events`, que recebe
 * todo lançamento, correção, W.O. e anulação) e a quantidade de campeonatos cancelados. Resultado novo = versão
 * nova = replay novo na próxima leitura; nada precisa invalidar o cache.
 */
import type { Prisma, PrismaClient } from '@nova/db';
import { DEFAULT_RATING_CONFIG, rankRatings, ratingMatchesFromStage, replayRatings, type RatingEntrantInfo, type RatingMatch, type RatingPool, type RatingRankingRow, type RatingReplay } from '@nova/engine';
import { seasonStatusAt, type RatingKind, type RatingSettings, type Season, type SeasonRankingEntry } from '@nova/schemas';
import type { AppContext } from '../../context';
import { readRun } from '../../competition/run';

type Db = PrismaClient | Prisma.TransactionClient;

export const RATING_SETTINGS: RatingSettings = { initial: DEFAULT_RATING_CONFIG.initial, k: DEFAULT_RATING_CONFIG.k, provisionalMatches: DEFAULT_RATING_CONFIG.provisionalMatches };
const CACHE_TTL_SECONDS = 600;
/** Campeonatos cujos resultados contam: já começaram e não foram cancelados. */
const RATED_STATUSES = ['IN_PROGRESS', 'PAUSED', 'FINISHED', 'ARCHIVED'] as const;

export interface SeasonRow {
  id: string;
  gameId: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  game: { slug: string; name: string };
}

export const seasonSelect = { id: true, gameId: true, name: true, startsAt: true, endsAt: true, game: { select: { slug: true, name: true } } } as const;

export const toSeason = (s: SeasonRow, now: Date): Season => ({
  id: s.id,
  gameId: s.gameId,
  gameSlug: s.game.slug,
  gameName: s.game.name,
  name: s.name,
  startsAt: s.startsAt.toISOString(),
  endsAt: s.endsAt.toISOString(),
  status: seasonStatusAt({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() }, now),
});

/** A temporada em andamento do jogo ou, sem ela, a última que já começou. */
export async function currentSeason(db: Db, gameId: string, now: Date): Promise<SeasonRow | null> {
  const active = await db.season.findFirst({ where: { gameId, startsAt: { lte: now }, endsAt: { gt: now } }, select: seasonSelect, orderBy: { startsAt: 'desc' } });
  if (active) return active;
  return db.season.findFirst({ where: { gameId, startsAt: { lte: now } }, select: seasonSelect, orderBy: { startsAt: 'desc' } });
}

async function versionOf(db: Db, gameId: string): Promise<string> {
  const rows = await db.$queryRaw<{ v: string }[]>`
    SELECT COALESCE((SELECT MAX(re.id) FROM result_events re JOIN matches m ON m.id = re."matchId" JOIN stages s ON s.id = m."stageId" JOIN tournaments t ON t.id = s."tournamentId" WHERE t."gameId" = ${gameId}::uuid), 0)::text
      || ':' || (SELECT COUNT(*) FROM tournaments WHERE "gameId" = ${gameId}::uuid AND status = 'CANCELLED')::text AS v`;
  return rows[0]?.v ?? '0:0';
}

/** Partidas que contam no rating de um jogo dentro da janela da temporada. */
export async function ratingMatches(db: Db, gameId: string, window: { startsAt: Date; endsAt: Date }): Promise<RatingMatch[]> {
  const stages = await db.stage.findMany({
    where: { confirmedAt: { not: null }, tournament: { gameId, status: { in: [...RATED_STATUSES] } } },
    select: {
      id: true,
      engineSnapshot: true,
      confirmedAt: true,
      unlocked: true,
      tournamentId: true,
      matches: { select: { nodeId: true, scheduledAt: true, resultEvents: { select: { createdAt: true }, orderBy: { createdAt: 'asc' }, take: 1 } } },
    },
  });
  if (stages.length === 0) return [];
  const tournamentIds = [...new Set(stages.map((s) => s.tournamentId))];
  const regs = await db.registration.findMany({
    where: { tournamentId: { in: tournamentIds } },
    select: { id: true, userId: true, teamId: true, members: { where: { confirmedAt: { not: null } }, select: { userId: true } } },
  });
  const info = new Map<string, RatingEntrantInfo>(regs.map((r) => [r.id, { members: r.userId ? [r.userId] : r.members.map((m) => m.userId), teamId: r.teamId }]));

  const from = window.startsAt.toISOString();
  const to = window.endsAt.toISOString();
  const out: RatingMatch[] = [];
  for (const stage of stages) {
    const run = readRun(stage);
    if (!run?.confirmed) continue;
    const times = new Map(stage.matches.map((m) => [m.nodeId, (m.resultEvents[0]?.createdAt ?? m.scheduledAt ?? stage.confirmedAt)?.toISOString() ?? null]));
    const matches = ratingMatchesFromStage(run.structure, run.state, {
      resolve: (id) => info.get(id) ?? null,
      timeOf: (nodeId) => times.get(nodeId) ?? null,
      idPrefix: `${stage.id}:`,
    });
    for (const m of matches) if (m.at >= from && m.at < to) out.push(m);
  }
  return out;
}

/** Replay da temporada, em cache pela versão do histórico de resultados do jogo. */
export async function seasonReplay(c: AppContext, season: Pick<SeasonRow, 'id' | 'gameId' | 'startsAt' | 'endsAt'>): Promise<RatingReplay> {
  const db = c.get('deps').db();
  const cache = c.get('deps').cache(c.get('env'));
  const key = `ratings:v1:${season.id}:${season.startsAt.getTime()}:${season.endsAt.getTime()}:${await versionOf(db, season.gameId)}`;
  const cached = await cache.get<RatingReplay>(key).catch(() => null);
  if (cached) return cached;
  const replay = replayRatings(await ratingMatches(db, season.gameId, season));
  await cache.set(key, replay, CACHE_TTL_SECONDS).catch((error: unknown) => c.get('log').warn('cache do rating indisponível', { error: String(error) }));
  return replay;
}

export const poolOf = (replay: RatingReplay, kind: RatingKind): RatingPool => (kind === 'PLAYER' ? replay.players : replay.teams);

/** Só quem pode aparecer (conta ativa; squad não arquivado). As posições são refeitas sem os demais. */
export function visiblePool(pool: RatingPool, visible: Set<string>): RatingPool {
  return { records: Object.fromEntries(Object.entries(pool.records).filter(([id]) => visible.has(id))), history: pool.history.filter((h) => visible.has(h.subjectId)) };
}

export interface SubjectInfo {
  name: string;
  tag: string | null;
  avatarUrl: string | null;
  href: string | null;
}

/** Nome, foto e link de cada um. Usuário fora de `ACTIVE` e squad arquivado não aparecem. */
export async function subjectsInfo(db: Db, kind: RatingKind, ids: string[]): Promise<Map<string, SubjectInfo>> {
  if (ids.length === 0) return new Map();
  if (kind === 'PLAYER') {
    const users = await db.user.findMany({ where: { id: { in: ids }, status: 'ACTIVE' }, select: { id: true, nickname: true, avatarUrl: true } });
    return new Map(users.map((u) => [u.id, { name: u.nickname, tag: null, avatarUrl: u.avatarUrl, href: `/u/${encodeURIComponent(u.nickname)}` }]));
  }
  const teams = await db.team.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true, name: true, tag: true, logoUrl: true } });
  return new Map(teams.map((t) => [t.id, { name: t.name, tag: t.tag, avatarUrl: t.logoUrl, href: null }]));
}

export const toRankingEntry = (row: RatingRankingRow, info: SubjectInfo): SeasonRankingEntry => ({
  position: row.position,
  subjectId: row.subjectId,
  name: info.name,
  tag: info.tag,
  avatarUrl: info.avatarUrl,
  href: info.href,
  rating: Math.round(row.rating),
  peak: Math.round(row.peak),
  played: row.played,
  wins: row.wins,
  draws: row.draws,
  losses: row.losses,
  provisional: row.provisional,
  lastDelta: Math.round(row.lastDelta),
});

/** Tabela visível de um conjunto (todas as linhas, já com posições). */
export async function rankedRows(db: Db, pool: RatingPool, kind: RatingKind): Promise<{ rows: RatingRankingRow[]; info: Map<string, SubjectInfo> }> {
  const info = await subjectsInfo(db, kind, Object.keys(pool.records));
  return { rows: rankRatings(visiblePool(pool, new Set(info.keys()))), info };
}

/**
 * Rating para o seeding `RANKED` (issue #120): jogador solo → o rating dele; squad → o do squad ou, sem ele, a média
 * dos jogadores. Quem ainda não jogou na temporada entra com o rating inicial. Se ninguém da chave tem rating, nada
 * muda (a ordem segue a de inscrição, como antes).
 */
export async function entrantRatings(c: AppContext, gameId: string, registrationIds: string[]): Promise<Map<string, number>> {
  const db = c.get('deps').db();
  const season = await currentSeason(db, gameId, c.get('deps').now());
  if (!season || registrationIds.length === 0) return new Map();
  const replay = await seasonReplay(c, season);
  const regs = await db.registration.findMany({
    where: { id: { in: registrationIds } },
    select: { id: true, userId: true, teamId: true, members: { where: { confirmedAt: { not: null } }, select: { userId: true } } },
  });
  const out = new Map<string, number>();
  let anyRated = false;
  for (const r of regs) {
    const members = r.userId ? [r.userId] : r.members.map((m) => m.userId);
    const team = r.teamId ? replay.teams.records[r.teamId] : undefined;
    const players = members.map((id) => replay.players.records[id]).filter((x) => x !== undefined);
    if (team || players.length) anyRated = true;
    const rating = team?.rating ?? (players.length ? players.reduce((s, p) => s + p.rating, 0) / players.length : RATING_SETTINGS.initial);
    out.set(r.id, rating);
  }
  return anyRated ? out : new Map();
}
