/**
 * Ligas semanais (issue #120, plano §11 melhoria 9). Porta de `apps/web/mocks/handlers/seasons.ts` (parte das ligas).
 *
 * Uma liga é de um organizador e de um jogo. Agrupa campeonatos (de quem organiza a liga, do mesmo jogo, um campeonato
 * em no máximo uma liga) e soma pontos pela colocação final de cada campeonato **encerrado**, pela regra da liga.
 * A colocação final: o pódio, depois a ordem da tabela da última fase e de quem parou nas fases anteriores
 * (`finalPlacements` do motor). Quem pontua é o jogador (solo), o squad (equipe) ou o nome (inscrição importada).
 *
 * - Público: `GET /leagues?game=`, `GET /leagues/:slug` (liga + tabela).
 * - Organizador (dona da liga ou Admin): `GET|POST /organizer/leagues`, `PATCH|DELETE /organizer/leagues/:id`,
 *   `POST /organizer/leagues/:id/tournaments`, `DELETE /organizer/leagues/:id/tournaments/:tournamentId`. Auditado.
 */
import { audited, withAudit, type Prisma, type PrismaClient } from '@nova/db';
import { computeLeagueTable, finalPlacements, type LeaguePlacement, type LeagueTournamentResult } from '@nova/engine';
import { League, LeagueDetail, LeagueInput, LeaguePatch, LeagueTournamentInput, Ok, seasonStatusAt, type LeagueRule, type LeagueStandingRow } from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, forbidden, notFound } from '../../errors';
import { ORGANIZER_AREA_ROLES, assertRole, assertTournamentAccess, currentRoles, isAdmin } from '../../auth/rbac';
import { requireSession } from '../../auth/session';
import { readRun, stageWithTournament } from '../../competition/run';
import { buildStandings, type StandingsStage } from '../../competition/standings';
import { auditCtx, isUuid } from '../competition/access';
import { slugify } from '../tournaments';

type Db = PrismaClient | Prisma.TransactionClient;

const leagueInclude = {
  game: { select: { id: true, slug: true, name: true, icon: true } },
  tournaments: { include: { tournament: { select: { id: true, slug: true, name: true, status: true, startsAt: true } } }, orderBy: { addedAt: 'asc' } },
} satisfies Prisma.LeagueInclude;
type LeagueRow = Prisma.LeagueGetPayload<{ include: typeof leagueInclude }>;

const PLACEMENTS_TTL_SECONDS = 86_400;

function toLeague(row: LeagueRow, owner: { id: string; nickname: string }, now: Date): League {
  const tournaments = row.tournaments
    .map((lt) => lt.tournament)
    .sort((a, b) => (a.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, 'pt-BR'));
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    game: row.game,
    owner,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: seasonStatusAt({ startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() }, now),
    rule: { placementPoints: row.placementPoints as number[], participationPoints: row.participationPoints },
    tournaments: tournaments.map((t) => ({ id: t.id, slug: t.slug, name: t.name, status: t.status, startsAt: t.startsAt?.toISOString() ?? null, counted: t.status === 'FINISHED' })),
    createdAt: row.createdAt.toISOString(),
  };
}

async function ownersOf(db: Db, ids: string[]): Promise<Map<string, { id: string; nickname: string }>> {
  const users = await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, nickname: true } });
  return new Map(users.map((u) => [u.id, u]));
}

async function viewOf(db: Db, row: LeagueRow, now: Date): Promise<League> {
  const owner = (await ownersOf(db, [row.ownerId])).get(row.ownerId) ?? { id: row.ownerId, nickname: 'Organizador' };
  return toLeague(row, owner, now);
}

async function uniqueLeagueSlug(db: Db, name: string): Promise<string> {
  const root = slugify(name) || 'liga';
  for (let i = 1; i < 1000; i += 1) {
    const slug = i === 1 ? root : `${root}-${i}`;
    if (!(await db.league.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/** Liga que a pessoa pode gerenciar: a dona ou um Admin. */
async function manageableLeague(c: AppContext, id: string): Promise<LeagueRow> {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const row = isUuid(id) ? await db.league.findUnique({ where: { id }, include: leagueInclude }) : null;
  if (!row) throw notFound('Liga');
  if (row.ownerId !== session.userId && !isAdmin(await currentRoles(c))) throw forbidden('Só quem organiza a liga pode alterá-la.');
  return row;
}

// ── Colocação final e tabela ─────────────────────────────────────────
interface CachedPlacements {
  placements: (LeaguePlacement & { href: string | null; avatarUrl: string | null })[];
}

/** Colocação final de cada inscrição de um campeonato encerrado (em cache: depois de encerrado, não muda). */
async function tournamentPlacements(c: AppContext, tournamentId: string): Promise<CachedPlacements['placements']> {
  const db = c.get('deps').db();
  const podium = await db.tournamentPodium.findUnique({ where: { tournamentId } });
  const cache = c.get('deps').cache(c.get('env'));
  const key = `league:placements:v1:${tournamentId}:${podium?.finishedAt.getTime() ?? 0}`;
  const cached = await cache.get<CachedPlacements>(key).catch(() => null);
  if (cached) return cached.placements;

  const stages = await db.stage.findMany({ where: { tournamentId }, orderBy: { order: 'asc' }, select: { id: true } });
  const orders: string[][] = [];
  for (const { id } of stages) {
    const stage = await stageWithTournament(db, id);
    if (!stage || !readRun(stage)?.confirmed) continue;
    orders.push((await buildStandings(db, stage as unknown as StandingsStage)).overall.map((r) => r.registrationId));
  }
  const places = ((podium?.places ?? []) as { place: number; registrationId: string }[]).sort((a, b) => a.place - b.place).map((p) => p.registrationId);
  const final = finalPlacements(orders, places);
  const regs = await db.registration.findMany({
    where: { id: { in: Object.keys(final) } },
    select: { id: true, userId: true, teamId: true, displayName: true, team: { select: { name: true, logoUrl: true } }, user: { select: { nickname: true, avatarUrl: true, status: true } } },
  });
  const placements: CachedPlacements['placements'] = regs.map((r) => {
    const placement = final[r.id] as number;
    if (r.teamId) return { key: `t:${r.teamId}`, name: r.team?.name ?? r.displayName ?? 'Squad', placement, href: null, avatarUrl: r.team?.logoUrl ?? null };
    if (r.userId && r.user) {
      const active = r.user.status === 'ACTIVE';
      return { key: `u:${r.userId}`, name: r.user.nickname, placement, href: active ? `/u/${encodeURIComponent(r.user.nickname)}` : null, avatarUrl: active ? r.user.avatarUrl : null };
    }
    const name = r.displayName ?? 'Inscrito';
    return { key: `n:${name.trim().toLowerCase()}`, name, placement, href: null, avatarUrl: null };
  });
  await cache.set(key, { placements }, PLACEMENTS_TTL_SECONDS).catch(() => undefined);
  return placements;
}

async function leagueTable(c: AppContext, row: LeagueRow): Promise<LeagueStandingRow[]> {
  const rule: LeagueRule = { placementPoints: row.placementPoints as number[], participationPoints: row.participationPoints };
  const results: LeagueTournamentResult[] = [];
  const extra = new Map<string, { href: string | null; avatarUrl: string | null }>();
  for (const { tournament } of row.tournaments) {
    if (tournament.status !== 'FINISHED') continue;
    const placements = await tournamentPlacements(c, tournament.id);
    for (const p of placements) extra.set(p.key, { href: p.href, avatarUrl: p.avatarUrl });
    results.push({ tournamentId: tournament.id, placements });
  }
  return computeLeagueTable(results, rule).map((r) => ({ ...r, href: extra.get(r.key)?.href ?? null, avatarUrl: extra.get(r.key)?.avatarUrl ?? null }));
}

// ── Rotas ────────────────────────────────────────────────────────────
export const leagues = new Hono<AppEnv>();

leagues.get('/leagues', async (c) => {
  const db = c.get('deps').db();
  const slug = c.req.query('game');
  const rows = await db.league.findMany({ where: slug ? { game: { slug } } : {}, include: leagueInclude, orderBy: [{ startsAt: 'desc' }, { name: 'asc' }], take: 100 });
  const owners = await ownersOf(db, rows.map((r) => r.ownerId));
  const now = c.get('deps').now();
  return respond(c, z.array(League), rows.map((r) => toLeague(r, owners.get(r.ownerId) ?? { id: r.ownerId, nickname: 'Organizador' }, now)));
});

leagues.get('/leagues/:slug', async (c) => {
  const db = c.get('deps').db();
  const slug = c.req.param('slug');
  const row = await db.league.findFirst({ where: isUuid(slug) ? { OR: [{ slug }, { id: slug }] } : { slug }, include: leagueInclude });
  if (!row) throw notFound('Liga');
  return respond(c, LeagueDetail, { league: await viewOf(db, row, c.get('deps').now()), table: await leagueTable(c, row) });
});

leagues.get('/organizer/leagues', async (c) => {
  await assertRole(c, ORGANIZER_AREA_ROLES);
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const rows = await db.league.findMany({ where: { ownerId: session.userId }, include: leagueInclude, orderBy: [{ startsAt: 'desc' }, { name: 'asc' }] });
  const owners = await ownersOf(db, [session.userId]);
  const now = c.get('deps').now();
  return respond(c, z.array(League), rows.map((r) => toLeague(r, owners.get(r.ownerId) ?? { id: r.ownerId, nickname: 'Organizador' }, now)));
});

leagues.post('/organizer/leagues', async (c) => {
  await assertRole(c, ORGANIZER_AREA_ROLES);
  const input = await body(c, LeagueInput);
  const db = c.get('deps').db();
  const game = isUuid(input.gameId) ? await db.game.findUnique({ where: { id: input.gameId }, select: { id: true, active: true } }) : null;
  if (!game?.active) throw badRequest('Escolha um jogo do catálogo.', 'VALIDATION', { gameId: 'Escolha um jogo do catálogo' });
  const audit = await auditCtx(c);
  const row = await withAudit(db, audit, async (tx) => {
    const created = await tx.league.create({
      data: {
        slug: await uniqueLeagueSlug(tx, input.name),
        name: input.name,
        description: input.description,
        gameId: game.id,
        ownerId: audit.actorId,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        placementPoints: input.rule.placementPoints,
        participationPoints: input.rule.participationPoints,
      },
      include: leagueInclude,
    });
    await audited(tx, { action: 'LEAGUE_CHANGED', entityType: 'League', entityId: created.id, entityLabel: created.name, after: { name: created.name, rule: input.rule } });
    return created;
  });
  return respond(c, League, await viewOf(db, row, c.get('deps').now()), 201);
});

leagues.patch('/organizer/leagues/:id', async (c) => {
  const current = await manageableLeague(c, c.req.param('id'));
  const input = await body(c, LeaguePatch);
  const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
  const endsAt = input.endsAt ? new Date(input.endsAt) : current.endsAt;
  if (endsAt <= startsAt) throw badRequest('O fim precisa ser depois do início.', 'VALIDATION', { endsAt: 'O fim precisa ser depois do início' });
  const db = c.get('deps').db();
  const row = await withAudit(db, await auditCtx(c), async (tx) => {
    const updated = await tx.league.update({
      where: { id: current.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.rule ? { placementPoints: input.rule.placementPoints, participationPoints: input.rule.participationPoints } : {}),
        startsAt,
        endsAt,
      },
      include: leagueInclude,
    });
    await audited(tx, {
      action: 'LEAGUE_CHANGED',
      entityType: 'League',
      entityId: current.id,
      entityLabel: updated.name,
      before: { name: current.name, rule: { placementPoints: current.placementPoints, participationPoints: current.participationPoints } },
      after: { name: updated.name, rule: { placementPoints: updated.placementPoints, participationPoints: updated.participationPoints } },
    });
    return updated;
  });
  return respond(c, League, await viewOf(db, row, c.get('deps').now()));
});

leagues.delete('/organizer/leagues/:id', async (c) => {
  const current = await manageableLeague(c, c.req.param('id'));
  await withAudit(c.get('deps').db(), await auditCtx(c), async (tx) => {
    // Os campeonatos continuam existindo: só deixam de fazer parte da liga.
    await tx.league.delete({ where: { id: current.id } });
    await audited(tx, { action: 'LEAGUE_CHANGED', entityType: 'League', entityId: current.id, entityLabel: current.name, before: { name: current.name }, after: { removida: true } });
  });
  return respond(c, Ok, { ok: true });
});

leagues.post('/organizer/leagues/:id/tournaments', async (c) => {
  const current = await manageableLeague(c, c.req.param('id'));
  const input = await body(c, LeagueTournamentInput);
  // Só entra campeonato que a pessoa organiza (dona, co-organizadora ou Admin).
  const access = await assertTournamentAccess(c, input.tournamentId, 'manage');
  const db = c.get('deps').db();
  const t = await db.tournament.findUniqueOrThrow({ where: { id: access.tournamentId }, select: { id: true, name: true, gameId: true, status: true, leagueEntry: { select: { leagueId: true } } } });
  if (t.gameId !== current.gameId) throw badRequest('O campeonato precisa ser do mesmo jogo da liga.', 'GAME_MISMATCH');
  if (t.status === 'CANCELLED') throw conflict('Campeonato cancelado não entra na liga.', 'INVALID_TRANSITION');
  if (t.leagueEntry) throw conflict(t.leagueEntry.leagueId === current.id ? 'Este campeonato já faz parte da liga.' : 'Este campeonato já faz parte de outra liga.', 'TOURNAMENT_IN_LEAGUE');
  const row = await withAudit(db, await auditCtx(c), async (tx) => {
    await tx.leagueTournament.create({ data: { leagueId: current.id, tournamentId: t.id } });
    await audited(tx, { action: 'LEAGUE_CHANGED', entityType: 'League', entityId: current.id, entityLabel: current.name, tournamentId: t.id, after: { campeonatoIncluido: t.name } });
    return tx.league.findUniqueOrThrow({ where: { id: current.id }, include: leagueInclude });
  });
  return respond(c, League, await viewOf(db, row, c.get('deps').now()));
});

leagues.delete('/organizer/leagues/:id/tournaments/:tournamentId', async (c) => {
  const current = await manageableLeague(c, c.req.param('id'));
  const tournamentId = c.req.param('tournamentId');
  const entry = current.tournaments.find((lt) => lt.tournamentId === tournamentId);
  if (!entry) throw notFound('Campeonato da liga');
  const db = c.get('deps').db();
  const row = await withAudit(db, await auditCtx(c), async (tx) => {
    await tx.leagueTournament.delete({ where: { leagueId_tournamentId: { leagueId: current.id, tournamentId } } });
    await audited(tx, { action: 'LEAGUE_CHANGED', entityType: 'League', entityId: current.id, entityLabel: current.name, tournamentId, after: { campeonatoRetirado: entry.tournament.name } });
    return tx.league.findUniqueOrThrow({ where: { id: current.id }, include: leagueInclude });
  });
  return respond(c, League, await viewOf(db, row, c.get('deps').now()));
});
