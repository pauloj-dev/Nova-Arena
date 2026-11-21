/**
 * Ranking de temporada (issue #120, ADR-0003). Porta de `apps/web/mocks/handlers/seasons.ts`.
 *
 * - `GET /seasons?game=`: temporadas (públicas), da mais recente para a mais antiga.
 * - `GET /games/:slug/season-ranking?season=&kind=PLAYER|TEAM`: tabela da temporada (a atual, sem `season`).
 * - `GET /users/:nickname/rating` e `GET /teams/:id/rating`: rating por jogo na temporada atual e a evolução.
 * - `POST|PATCH|DELETE /admin/seasons[/:id]`: Admin (com 2FA, pelo `adminArea`), auditado, sem sobreposição.
 * As leituras de rating respeitam a flag `ranking` (desligada → 403 `FEATURE_DISABLED`).
 */
import { audited, withAudit, type PrismaClient } from '@nova/db';
import { Ok, RatingKind, Season, SeasonInput, SeasonPatch, SeasonRanking, SubjectRatings, type SubjectRating } from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, forbidden, notFound } from '../../errors';
import { ADMIN_ROLES, assertRole } from '../../auth/rbac';
import { auditCtx, isUuid } from '../competition/access';
import { isFlagEnabled } from '../site/store';
import { currentSeason, poolOf, RATING_SETTINGS, rankedRows, seasonReplay, seasonSelect, toRankingEntry, toSeason, type SeasonRow, type SubjectInfo } from './ratings';

const HISTORY_POINTS = 50;
const RANKING_LIMIT = 100;

async function requireRankingFlag(c: AppContext): Promise<void> {
  if (!(await isFlagEnabled(c, 'ranking'))) throw forbidden('O ranking está desligado no momento.', 'FEATURE_DISABLED');
}

async function findGame(db: PrismaClient, slug: string) {
  const game = await db.game.findFirst({ where: isUuid(slug) ? { OR: [{ slug }, { id: slug }] } : { slug }, select: { id: true, slug: true, name: true, icon: true, active: true } });
  if (!game) throw notFound('Jogo');
  return game;
}

/** Outra temporada do mesmo jogo cruza o intervalo? */
async function assertNoOverlap(db: PrismaClient, gameId: string, startsAt: Date, endsAt: Date, exceptId?: string): Promise<void> {
  const clash = await db.season.findFirst({ where: { gameId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true } });
  if (clash) throw conflict(`As datas cruzam com a temporada "${clash.name}". Temporadas do mesmo jogo não podem se sobrepor.`, 'SEASON_OVERLAP');
}

/** Rating de alguém em cada jogo com temporada (atual ou a última que já começou). */
async function subjectRatings(c: AppContext, kind: RatingKind, subjectId: string): Promise<SubjectRating[]> {
  const db = c.get('deps').db();
  const now = c.get('deps').now();
  const games = await db.game.findMany({ where: { active: true }, select: { id: true, slug: true, name: true, icon: true }, orderBy: { name: 'asc' } });
  const out: SubjectRating[] = [];
  for (const game of games) {
    const season = await currentSeason(db, game.id, now);
    if (!season) continue;
    const pool = poolOf(await seasonReplay(c, season), kind);
    const record = pool.records[subjectId];
    if (!record) continue;
    const { rows } = await rankedRows(db, pool, kind);
    const row = rows.find((r) => r.subjectId === subjectId);
    if (!row) continue;
    const history = pool.history.filter((h) => h.subjectId === subjectId).slice(-HISTORY_POINTS);
    out.push({
      game: { id: game.id, slug: game.slug, name: game.name, icon: game.icon },
      season: toSeason(season, now),
      rating: Math.round(row.rating),
      peak: Math.round(row.peak),
      played: row.played,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      provisional: row.provisional,
      position: row.position,
      history: history.map((h) => ({ at: h.at, rating: Math.round(h.after), delta: Math.round(h.delta) })),
    });
  }
  return out;
}

export const seasons = new Hono<AppEnv>();

seasons.get('/seasons', async (c) => {
  const db = c.get('deps').db();
  const slug = c.req.query('game');
  const game = slug ? await findGame(db, slug) : null;
  const rows = await db.season.findMany({ where: game ? { gameId: game.id } : {}, select: seasonSelect, orderBy: [{ startsAt: 'desc' }, { id: 'asc' }] });
  const now = c.get('deps').now();
  return respond(c, z.array(Season), rows.map((s) => toSeason(s, now)));
});

seasons.get('/games/:slug/season-ranking', async (c) => {
  await requireRankingFlag(c);
  const db = c.get('deps').db();
  const now = c.get('deps').now();
  const game = await findGame(db, c.req.param('slug'));
  if (!game.active) throw notFound('Jogo');
  const kind = RatingKind.safeParse(c.req.query('kind') ?? 'PLAYER');
  if (!kind.success) throw badRequest('Escolha jogadores ou squads.', 'VALIDATION');
  const all = await db.season.findMany({ where: { gameId: game.id }, select: seasonSelect, orderBy: [{ startsAt: 'desc' }, { id: 'asc' }] });
  const requested = c.req.query('season');
  let season: SeasonRow | null;
  if (requested) {
    season = all.find((s) => s.id === requested) ?? null;
    if (!season) throw notFound('Temporada');
  } else {
    season = await currentSeason(db, game.id, now);
  }
  let entries: SeasonRanking['entries'] = [];
  if (season && season.startsAt <= now) {
    const { rows, info } = await rankedRows(db, poolOf(await seasonReplay(c, season), kind.data), kind.data);
    entries = rows.slice(0, RANKING_LIMIT).map((r) => toRankingEntry(r, info.get(r.subjectId) as SubjectInfo));
  }
  return respond(c, SeasonRanking, {
    game: { id: game.id, slug: game.slug, name: game.name },
    season: season ? toSeason(season, now) : null,
    seasons: all.map((s) => toSeason(s, now)),
    kind: kind.data,
    settings: RATING_SETTINGS,
    entries,
  });
});

seasons.get('/users/:nickname/rating', async (c) => {
  await requireRankingFlag(c);
  const key = decodeURIComponent(c.req.param('nickname')).toLowerCase();
  const user = await c.get('deps').db().user.findUnique({ where: { nicknameKey: key }, select: { id: true, status: true } });
  if (!user || user.status === 'DELETED' || user.status === 'MERGED') throw notFound('Perfil');
  return respond(c, SubjectRatings, { kind: 'PLAYER', subjectId: user.id, settings: RATING_SETTINGS, entries: user.status === 'ACTIVE' ? await subjectRatings(c, 'PLAYER', user.id) : [] });
});

seasons.get('/teams/:id/rating', async (c) => {
  await requireRankingFlag(c);
  const id = c.req.param('id');
  const team = isUuid(id) ? await c.get('deps').db().team.findUnique({ where: { id }, select: { id: true } }) : null;
  if (!team) throw notFound('Squad');
  return respond(c, SubjectRatings, { kind: 'TEAM', subjectId: team.id, settings: RATING_SETTINGS, entries: await subjectRatings(c, 'TEAM', team.id) });
});

// ── Admin ────────────────────────────────────────────────────────────
seasons.post('/admin/seasons', async (c) => {
  await assertRole(c, ADMIN_ROLES);
  const input = await body(c, SeasonInput);
  const db = c.get('deps').db();
  const game = isUuid(input.gameId) ? await db.game.findUnique({ where: { id: input.gameId }, select: { id: true } }) : null;
  if (!game) throw badRequest('Escolha um jogo do catálogo.', 'VALIDATION', { gameId: 'Escolha um jogo do catálogo' });
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  await assertNoOverlap(db, game.id, startsAt, endsAt);
  const audit = await auditCtx(c);
  const row = await withAudit(db, audit, async (tx) => {
    const created = await tx.season.create({ data: { gameId: game.id, name: input.name, startsAt, endsAt, createdById: audit.actorId }, select: seasonSelect });
    await audited(tx, { action: 'SEASON_CHANGED', entityType: 'Season', entityId: created.id, entityLabel: `${created.game.name} · ${created.name}`, after: { name: created.name, startsAt: input.startsAt, endsAt: input.endsAt } });
    return created;
  });
  return respond(c, Season, toSeason(row, c.get('deps').now()), 201);
});

seasons.patch('/admin/seasons/:id', async (c) => {
  await assertRole(c, ADMIN_ROLES);
  const input = await body(c, SeasonPatch);
  const db = c.get('deps').db();
  const id = c.req.param('id');
  const current = isUuid(id) ? await db.season.findUnique({ where: { id }, select: seasonSelect }) : null;
  if (!current) throw notFound('Temporada');
  const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
  const endsAt = input.endsAt ? new Date(input.endsAt) : current.endsAt;
  if (endsAt <= startsAt) throw badRequest('O fim precisa ser depois do início.', 'VALIDATION', { endsAt: 'O fim precisa ser depois do início' });
  await assertNoOverlap(db, current.gameId, startsAt, endsAt, current.id);
  const row = await withAudit(db, await auditCtx(c), async (tx) => {
    const updated = await tx.season.update({ where: { id: current.id }, data: { ...(input.name ? { name: input.name } : {}), startsAt, endsAt }, select: seasonSelect });
    await audited(tx, {
      action: 'SEASON_CHANGED',
      entityType: 'Season',
      entityId: current.id,
      entityLabel: `${current.game.name} · ${updated.name}`,
      before: { name: current.name, startsAt: current.startsAt.toISOString(), endsAt: current.endsAt.toISOString() },
      after: { name: updated.name, startsAt: updated.startsAt.toISOString(), endsAt: updated.endsAt.toISOString() },
    });
    return updated;
  });
  return respond(c, Season, toSeason(row, c.get('deps').now()));
});

seasons.delete('/admin/seasons/:id', async (c) => {
  await assertRole(c, ADMIN_ROLES);
  const db = c.get('deps').db();
  const id = c.req.param('id');
  const current = isUuid(id) ? await db.season.findUnique({ where: { id }, select: seasonSelect }) : null;
  if (!current) throw notFound('Temporada');
  // O rating é recalculado dos resultados: apagar a temporada não apaga nenhuma partida.
  await withAudit(db, await auditCtx(c), async (tx) => {
    await tx.season.delete({ where: { id: current.id } });
    await audited(tx, { action: 'SEASON_CHANGED', entityType: 'Season', entityId: current.id, entityLabel: `${current.game.name} · ${current.name}`, before: { name: current.name }, after: { removida: true } });
  });
  return respond(c, Ok, { ok: true });
});
