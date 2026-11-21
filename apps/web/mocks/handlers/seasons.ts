/**
 * Módulo `seasons` da API simulada: ranking de temporada (rating ELO) e ligas semanais (issue #120, ADR-0003).
 * Mesmas rotas, permissões e códigos de erro da API real (`packages/api/src/modules/seasons`).
 */
import { http } from 'msw';
import { LeagueInput, LeaguePatch, LeagueTournamentInput, RatingKind, SeasonInput, SeasonPatch, type SeasonRanking, type SubjectRating, type SubjectRatings } from '@nova/schemas';
import { audit } from '../audit';
import { db, nowIso, save, slugify, uid } from '../db';
import { badRequest, body, conflict, forbidden, handle, HttpProblem, isAdmin, json, notFound, param, query, requireAdmin, requireRole, requireUser, requireTournamentAccess, url } from '../http';
import {
  RATING_SETTINGS,
  currentSeason,
  leagueTable,
  leaguesStore,
  poolOf,
  rankedRows,
  seasonReplay,
  seasonsOfGame,
  seasonsStore,
  toLeague,
  toRankingEntry,
  toSeason,
  type DbLeague,
  type DbSeason,
  type SubjectInfo,
} from '../seasons';
import { isFlagEnabled } from './admin-settings';

export const moduleName = 'seasons';

const HISTORY_POINTS = 50;
const RANKING_LIMIT = 100;

function requireRankingFlag(): void {
  if (!isFlagEnabled('ranking')) throw new HttpProblem(403, 'O ranking está desligado no momento.', 'FEATURE_DISABLED');
}

function findGame(slug: string) {
  const game = db().games.find((g) => g.slug === slug || g.id === slug);
  if (!game) throw notFound('Jogo');
  return game;
}

function assertNoOverlap(gameId: string, startsAt: string, endsAt: string, exceptId?: string): void {
  const clash = seasonsStore().find((s) => s.gameId === gameId && s.id !== exceptId && new Date(s.startsAt) < new Date(endsAt) && new Date(s.endsAt) > new Date(startsAt));
  if (clash) throw conflict(`As datas cruzam com a temporada "${clash.name}". Temporadas do mesmo jogo não podem se sobrepor.`, 'SEASON_OVERLAP');
}

function subjectRatings(kind: 'PLAYER' | 'TEAM', subjectId: string): SubjectRating[] {
  const out: SubjectRating[] = [];
  const games = db().games.filter((g) => g.active).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  for (const game of games) {
    const season = currentSeason(game.id);
    if (!season) continue;
    const pool = poolOf(seasonReplay(season), kind);
    if (!pool.records[subjectId]) continue;
    const row = rankedRows(pool, kind).rows.find((r) => r.subjectId === subjectId);
    if (!row) continue;
    const history = pool.history.filter((h) => h.subjectId === subjectId).slice(-HISTORY_POINTS);
    out.push({
      game: { id: game.id, slug: game.slug, name: game.name, icon: game.icon },
      season: toSeason(season),
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

function findLeague(idOrSlug: string): DbLeague {
  const league = leaguesStore().find((l) => l.id === idOrSlug || l.slug === idOrSlug);
  if (!league) throw notFound('Liga');
  return league;
}

function manageableLeague(id: string): { league: DbLeague; user: ReturnType<typeof requireUser> } {
  const user = requireUser();
  const league = leaguesStore().find((l) => l.id === id);
  if (!league) throw notFound('Liga');
  if (league.ownerId !== user.id && !isAdmin(user)) throw forbidden('Só quem organiza a liga pode alterá-la.');
  return { league, user };
}

function uniqueLeagueSlug(name: string): string {
  const root = slugify(name) || 'liga';
  const taken = (slug: string) => leaguesStore().some((l) => l.slug === slug);
  if (!taken(root)) return root;
  for (let i = 2; i < 1000; i += 1) if (!taken(`${root}-${i}`)) return `${root}-${i}`;
  return `${root}-${Date.now().toString(36)}`;
}

const byNewest = (a: DbLeague, b: DbLeague) => (a.startsAt < b.startsAt ? 1 : a.startsAt > b.startsAt ? -1 : a.name.localeCompare(b.name, 'pt-BR'));

export const handlers = [
  // ── Temporadas ──
  http.get(
    url('/seasons'),
    handle(({ request }) => {
      const slug = query(request).get('game');
      const list = slug ? seasonsOfGame(findGame(slug).id) : [...seasonsStore()].sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1));
      return json(list.map((s) => toSeason(s)));
    }),
  ),
  http.get(
    url('/games/:slug/season-ranking'),
    handle(({ params, request }) => {
      requireRankingFlag();
      const game = findGame(param(params, 'slug'));
      if (!game.active) throw notFound('Jogo');
      const q = query(request);
      const kind = RatingKind.safeParse(q.get('kind') ?? 'PLAYER');
      if (!kind.success) throw badRequest('Escolha jogadores ou squads.', 'VALIDATION');
      const all = seasonsOfGame(game.id);
      const requested = q.get('season');
      let season: DbSeason | null;
      if (requested) {
        season = all.find((s) => s.id === requested) ?? null;
        if (!season) throw notFound('Temporada');
      } else {
        season = currentSeason(game.id);
      }
      let entries: SeasonRanking['entries'] = [];
      if (season && new Date(season.startsAt) <= new Date()) {
        const { rows, info } = rankedRows(poolOf(seasonReplay(season), kind.data), kind.data);
        entries = rows.slice(0, RANKING_LIMIT).map((r) => toRankingEntry(r, info.get(r.subjectId) as SubjectInfo));
      }
      const ranking: SeasonRanking = { game: { id: game.id, slug: game.slug, name: game.name }, season: season ? toSeason(season) : null, seasons: all.map((s) => toSeason(s)), kind: kind.data, settings: RATING_SETTINGS, entries };
      return json(ranking);
    }),
  ),
  http.get(
    url('/users/:nickname/rating'),
    handle(({ params }) => {
      requireRankingFlag();
      const key = decodeURIComponent(param(params, 'nickname')).toLowerCase();
      const user = db().users.find((u) => u.nickname.toLowerCase() === key);
      if (!user || user.status === 'DELETED' || user.status === 'MERGED') throw notFound('Perfil');
      const res: SubjectRatings = { kind: 'PLAYER', subjectId: user.id, settings: RATING_SETTINGS, entries: user.status === 'ACTIVE' ? subjectRatings('PLAYER', user.id) : [] };
      return json(res);
    }),
  ),
  http.get(
    url('/teams/:id/rating'),
    handle(({ params }) => {
      requireRankingFlag();
      const team = db().teams.find((t) => t.id === param(params, 'id'));
      if (!team) throw notFound('Squad');
      const res: SubjectRatings = { kind: 'TEAM', subjectId: team.id, settings: RATING_SETTINGS, entries: subjectRatings('TEAM', team.id) };
      return json(res);
    }),
  ),
  http.post(
    url('/admin/seasons'),
    handle(async ({ request }) => {
      const user = requireAdmin();
      const input = await body(request, SeasonInput);
      const game = db().games.find((g) => g.id === input.gameId);
      if (!game) throw badRequest('Escolha um jogo do catálogo.', 'VALIDATION', { gameId: 'Escolha um jogo do catálogo' });
      assertNoOverlap(game.id, input.startsAt, input.endsAt);
      const season: DbSeason = { id: uid('season'), gameId: game.id, name: input.name, startsAt: new Date(input.startsAt).toISOString(), endsAt: new Date(input.endsAt).toISOString(), createdById: user.id, createdAt: nowIso() };
      seasonsStore().push(season);
      save();
      audit(user, { action: 'SEASON_CHANGED', entityType: 'Season', entityId: season.id, entityLabel: `${game.name} · ${season.name}`, after: { name: season.name, startsAt: season.startsAt, endsAt: season.endsAt } });
      return json(toSeason(season), 201);
    }),
  ),
  http.patch(
    url('/admin/seasons/:id'),
    handle(async ({ params, request }) => {
      const user = requireAdmin();
      const input = await body(request, SeasonPatch);
      const season = seasonsStore().find((s) => s.id === param(params, 'id'));
      if (!season) throw notFound('Temporada');
      const startsAt = input.startsAt ? new Date(input.startsAt).toISOString() : season.startsAt;
      const endsAt = input.endsAt ? new Date(input.endsAt).toISOString() : season.endsAt;
      if (new Date(endsAt) <= new Date(startsAt)) throw badRequest('O fim precisa ser depois do início.', 'VALIDATION', { endsAt: 'O fim precisa ser depois do início' });
      assertNoOverlap(season.gameId, startsAt, endsAt, season.id);
      const before = { name: season.name, startsAt: season.startsAt, endsAt: season.endsAt };
      Object.assign(season, { ...(input.name ? { name: input.name } : {}), startsAt, endsAt });
      save();
      audit(user, { action: 'SEASON_CHANGED', entityType: 'Season', entityId: season.id, entityLabel: `${toSeason(season).gameName} · ${season.name}`, before, after: { name: season.name, startsAt, endsAt } });
      return json(toSeason(season));
    }),
  ),
  http.delete(
    url('/admin/seasons/:id'),
    handle(({ params }) => {
      const user = requireAdmin();
      const list = seasonsStore();
      const index = list.findIndex((s) => s.id === param(params, 'id'));
      const season = list[index];
      if (!season) throw notFound('Temporada');
      list.splice(index, 1);
      save();
      audit(user, { action: 'SEASON_CHANGED', entityType: 'Season', entityId: season.id, entityLabel: `${toSeason(season).gameName} · ${season.name}`, before: { name: season.name }, after: { removida: true } });
      return json({ ok: true });
    }),
  ),

  // ── Ligas ──
  http.get(
    url('/leagues'),
    handle(({ request }) => {
      const slug = query(request).get('game');
      const gameId = slug ? db().games.find((g) => g.slug === slug)?.id : undefined;
      return json([...leaguesStore()].filter((l) => !slug || l.gameId === gameId).sort(byNewest).slice(0, 100).map((l) => toLeague(l)));
    }),
  ),
  http.get(
    url('/leagues/:slug'),
    handle(({ params }) => {
      const league = findLeague(param(params, 'slug'));
      return json({ league: toLeague(league), table: leagueTable(league) });
    }),
  ),
  http.get(
    url('/organizer/leagues'),
    handle(() => {
      const user = requireRole('ORGANIZER', 'ADMIN', 'SUPER_ADMIN');
      return json([...leaguesStore()].filter((l) => l.ownerId === user.id).sort(byNewest).map((l) => toLeague(l)));
    }),
  ),
  http.post(
    url('/organizer/leagues'),
    handle(async ({ request }) => {
      const user = requireRole('ORGANIZER', 'ADMIN', 'SUPER_ADMIN');
      const input = await body(request, LeagueInput);
      const game = db().games.find((g) => g.id === input.gameId);
      if (!game?.active) throw badRequest('Escolha um jogo do catálogo.', 'VALIDATION', { gameId: 'Escolha um jogo do catálogo' });
      const league: DbLeague = {
        id: uid('lg'),
        slug: uniqueLeagueSlug(input.name),
        name: input.name,
        description: input.description,
        gameId: game.id,
        ownerId: user.id,
        startsAt: new Date(input.startsAt).toISOString(),
        endsAt: new Date(input.endsAt).toISOString(),
        rule: input.rule,
        tournamentIds: [],
        createdAt: nowIso(),
      };
      leaguesStore().push(league);
      save();
      audit(user, { action: 'LEAGUE_CHANGED', entityType: 'League', entityId: league.id, entityLabel: league.name, after: { name: league.name, rule: league.rule } });
      return json(toLeague(league), 201);
    }),
  ),
  http.patch(
    url('/organizer/leagues/:id'),
    handle(async ({ params, request }) => {
      const { league, user } = manageableLeague(param(params, 'id'));
      const input = await body(request, LeaguePatch);
      const startsAt = input.startsAt ? new Date(input.startsAt).toISOString() : league.startsAt;
      const endsAt = input.endsAt ? new Date(input.endsAt).toISOString() : league.endsAt;
      if (new Date(endsAt) <= new Date(startsAt)) throw badRequest('O fim precisa ser depois do início.', 'VALIDATION', { endsAt: 'O fim precisa ser depois do início' });
      const before = { name: league.name, rule: league.rule };
      Object.assign(league, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.rule ? { rule: input.rule } : {}),
        startsAt,
        endsAt,
      });
      save();
      audit(user, { action: 'LEAGUE_CHANGED', entityType: 'League', entityId: league.id, entityLabel: league.name, before, after: { name: league.name, rule: league.rule } });
      return json(toLeague(league));
    }),
  ),
  http.delete(
    url('/organizer/leagues/:id'),
    handle(({ params }) => {
      const { league, user } = manageableLeague(param(params, 'id'));
      const list = leaguesStore();
      list.splice(list.indexOf(league), 1);
      save();
      audit(user, { action: 'LEAGUE_CHANGED', entityType: 'League', entityId: league.id, entityLabel: league.name, before: { name: league.name }, after: { removida: true } });
      return json({ ok: true });
    }),
  ),
  http.post(
    url('/organizer/leagues/:id/tournaments'),
    handle(async ({ params, request }) => {
      const { league, user } = manageableLeague(param(params, 'id'));
      const input = await body(request, LeagueTournamentInput);
      const t = db().tournaments.find((x) => x.id === input.tournamentId || x.slug === input.tournamentId);
      if (!t) throw notFound('Campeonato');
      // Só entra campeonato que a pessoa organiza (dona, co-organizadora ou Admin).
      requireTournamentAccess(t);
      if (t.gameId !== league.gameId) throw badRequest('O campeonato precisa ser do mesmo jogo da liga.', 'GAME_MISMATCH');
      if (t.status === 'CANCELLED') throw conflict('Campeonato cancelado não entra na liga.', 'INVALID_TRANSITION');
      const owner = leaguesStore().find((l) => l.tournamentIds.includes(t.id));
      if (owner) throw conflict(owner.id === league.id ? 'Este campeonato já faz parte da liga.' : 'Este campeonato já faz parte de outra liga.', 'TOURNAMENT_IN_LEAGUE');
      league.tournamentIds.push(t.id);
      save();
      audit(user, { action: 'LEAGUE_CHANGED', entityType: 'League', entityId: league.id, entityLabel: league.name, tournamentId: t.id, after: { campeonatoIncluido: t.name } });
      return json(toLeague(league));
    }),
  ),
  http.delete(
    url('/organizer/leagues/:id/tournaments/:tournamentId'),
    handle(({ params }) => {
      const { league, user } = manageableLeague(param(params, 'id'));
      const tournamentId = param(params, 'tournamentId');
      if (!league.tournamentIds.includes(tournamentId)) throw notFound('Campeonato da liga');
      league.tournamentIds = league.tournamentIds.filter((id) => id !== tournamentId);
      save();
      const name = db().tournaments.find((t) => t.id === tournamentId)?.name ?? 'Campeonato';
      audit(user, { action: 'LEAGUE_CHANGED', entityType: 'League', entityId: league.id, entityLabel: league.name, tournamentId, after: { campeonatoRetirado: name } });
      return json(toLeague(league));
    }),
  ),
];
