/**
 * Ranking de temporada e ligas na API simulada (issue #120, ADR-0003) — mesma regra da API real
 * (`packages/api/src/modules/seasons`): o rating é o replay (`@nova/engine`) das partidas validadas do jogo dentro da
 * temporada; a tabela da liga soma os pontos da colocação final dos campeonatos encerrados.
 */
import {
  DEFAULT_RATING_CONFIG,
  computeLeagueTable,
  finalPlacements,
  rankRatings,
  ratingMatchesFromStage,
  replayRatings,
  type LeaguePlacement,
  type RatingEntrantInfo,
  type RatingMatch,
  type RatingPool,
  type RatingRankingRow,
  type RatingReplay,
} from '@nova/engine';
import { DEFAULT_LEAGUE_RULE, seasonStatusAt, type League, type LeagueRule, type LeagueStandingRow, type RatingKind, type RatingSettings, type Season, type SeasonRankingEntry } from '@nova/schemas';
import { buildStandings, matchMetas, podiums, stageRuns } from './competition';
import { collection, db } from './db';

export interface DbSeason {
  id: string;
  gameId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  createdById: string;
  createdAt: string;
}

export interface DbLeague {
  id: string;
  slug: string;
  name: string;
  description: string;
  gameId: string;
  ownerId: string;
  startsAt: string;
  endsAt: string;
  rule: LeagueRule;
  tournamentIds: string[];
  createdAt: string;
}

export const RATING_SETTINGS: RatingSettings = { initial: DEFAULT_RATING_CONFIG.initial, k: DEFAULT_RATING_CONFIG.k, provisionalMatches: DEFAULT_RATING_CONFIG.provisionalMatches };

/** Temporada do ano corrente para cada jogo (como o seed do banco): de 1º de janeiro, 0h de Brasília (03:00 UTC). */
function seedSeasons(): DbSeason[] {
  const year = new Date().getUTCFullYear();
  return db().games.map((g) => ({
    id: `season_${g.id}_${year}`,
    gameId: g.id,
    name: `Temporada ${year}`,
    startsAt: `${year}-01-01T03:00:00.000Z`,
    endsAt: `${year + 1}-01-01T03:00:00.000Z`,
    createdById: 'u_rafael',
    createdAt: `${year}-01-01T03:00:00.000Z`,
  }));
}

/** Liga de demonstração: o Open 8 Ball Pool (encerrado) já soma pontos. */
function seedLeagues(): DbLeague[] {
  const t = db().tournaments.find((x) => x.slug === 'open-8-ball-pool');
  if (!t) return [];
  const year = new Date().getUTCFullYear();
  return [
    {
      id: 'lg_circuito_8ball',
      slug: 'circuito-8-ball-pool',
      name: 'Circuito 8 Ball Pool',
      description: 'Um Open por semana. Os pontos de cada colocação somam na tabela da temporada.',
      gameId: t.gameId,
      ownerId: t.ownerId,
      startsAt: `${year}-01-01T03:00:00.000Z`,
      endsAt: `${year + 1}-01-01T03:00:00.000Z`,
      rule: DEFAULT_LEAGUE_RULE,
      tournamentIds: [t.id],
      createdAt: `${year}-01-01T03:00:00.000Z`,
    },
  ];
}

export const seasonsStore = () => collection<DbSeason>('seasons', seedSeasons);
export const leaguesStore = () => collection<DbLeague>('leagues', seedLeagues);

interface ResultEventRow {
  matchId: string;
  createdAt: string;
}

export function toSeason(s: DbSeason, now: Date = new Date()): Season {
  const game = db().games.find((g) => g.id === s.gameId);
  return { id: s.id, gameId: s.gameId, gameSlug: game?.slug ?? 'jogo', gameName: game?.name ?? 'Jogo', name: s.name, startsAt: s.startsAt, endsAt: s.endsAt, status: seasonStatusAt(s, now) };
}

export const seasonsOfGame = (gameId: string) => seasonsStore().filter((s) => s.gameId === gameId).sort((a, b) => (a.startsAt < b.startsAt ? 1 : a.startsAt > b.startsAt ? -1 : a.id < b.id ? -1 : 1));

/** A temporada em andamento do jogo ou, sem ela, a última que já começou. */
export function currentSeason(gameId: string, now: Date = new Date()): DbSeason | null {
  const started = seasonsOfGame(gameId).filter((s) => new Date(s.startsAt) <= now);
  return started.find((s) => now < new Date(s.endsAt)) ?? started[0] ?? null;
}

const RATED_STATUSES = new Set(['IN_PROGRESS', 'PAUSED', 'FINISHED', 'ARCHIVED']);

/** Partidas que contam no rating do jogo dentro da janela da temporada. */
export function ratingMatches(gameId: string, window: { startsAt: string; endsAt: string }): RatingMatch[] {
  const d = db();
  const tournaments = new Map(d.tournaments.filter((t) => t.gameId === gameId && RATED_STATUSES.has(t.status)).map((t) => [t.id, t]));
  const info = new Map<string, RatingEntrantInfo>();
  for (const r of d.registrations) {
    if (!tournaments.has(r.tournamentId)) continue;
    info.set(r.id, { members: r.userId ? [r.userId] : r.members.filter((m) => m.confirmedAt).map((m) => m.userId), teamId: r.teamId });
  }
  const firstEvent = new Map<string, string>();
  for (const e of collection<ResultEventRow>('resultEvents')) {
    const current = firstEvent.get(e.matchId);
    if (!current || e.createdAt < current) firstEvent.set(e.matchId, e.createdAt);
  }
  const metas = new Map(matchMetas().map((m) => [m.id, m]));
  const out: RatingMatch[] = [];
  for (const run of stageRuns()) {
    if (!run.confirmed || !tournaments.has(run.tournamentId)) continue;
    const timeOf = (nodeId: string) => {
      const id = `${run.stageId}~${nodeId}`;
      const meta = metas.get(id);
      return firstEvent.get(id) ?? meta?.updatedAt ?? meta?.scheduledAt ?? run.updatedAt;
    };
    for (const m of ratingMatchesFromStage(run.structure, run.state, { resolve: (id) => info.get(id) ?? null, timeOf, idPrefix: `${run.stageId}:` })) {
      if (m.at >= window.startsAt && m.at < window.endsAt) out.push(m);
    }
  }
  return out;
}

export const seasonReplay = (season: DbSeason): RatingReplay => replayRatings(ratingMatches(season.gameId, season));
export const poolOf = (replay: RatingReplay, kind: RatingKind): RatingPool => (kind === 'PLAYER' ? replay.players : replay.teams);

export interface SubjectInfo {
  name: string;
  tag: string | null;
  avatarUrl: string | null;
  href: string | null;
}

/** Nome, foto e link. Conta fora de `ACTIVE` não aparece (mas o que jogou continua valendo para os outros). */
export function subjectInfo(kind: RatingKind, id: string): SubjectInfo | null {
  const d = db();
  if (kind === 'PLAYER') {
    const u = d.users.find((x) => x.id === id);
    return u && u.status === 'ACTIVE' ? { name: u.nickname, tag: null, avatarUrl: u.avatarUrl, href: `/u/${encodeURIComponent(u.nickname)}` } : null;
  }
  const t = d.teams.find((x) => x.id === id);
  return t ? { name: t.name, tag: t.tag, avatarUrl: t.logoUrl, href: null } : null;
}

export function rankedRows(pool: RatingPool, kind: RatingKind): { rows: RatingRankingRow[]; info: Map<string, SubjectInfo> } {
  const info = new Map<string, SubjectInfo>();
  for (const id of Object.keys(pool.records)) {
    const i = subjectInfo(kind, id);
    if (i) info.set(id, i);
  }
  const visible = { records: Object.fromEntries(Object.entries(pool.records).filter(([id]) => info.has(id))), history: [] };
  return { rows: rankRatings(visible), info };
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

/** Rating para o seeding `RANKED`: mesma regra da API real (vazio quando ninguém da chave tem rating). */
export function entrantRatings(gameId: string, registrationIds: string[]): Map<string, number> {
  const season = currentSeason(gameId);
  if (!season || registrationIds.length === 0) return new Map();
  const replay = seasonReplay(season);
  const out = new Map<string, number>();
  let anyRated = false;
  for (const id of registrationIds) {
    const r = db().registrations.find((x) => x.id === id);
    if (!r) continue;
    const members = r.userId ? [r.userId] : r.members.filter((m) => m.confirmedAt).map((m) => m.userId);
    const team = r.teamId ? replay.teams.records[r.teamId] : undefined;
    const players = members.map((m) => replay.players.records[m]).filter((x) => x !== undefined);
    if (team || players.length) anyRated = true;
    out.set(id, team?.rating ?? (players.length ? players.reduce((s, p) => s + p.rating, 0) / players.length : RATING_SETTINGS.initial));
  }
  return anyRated ? out : new Map();
}

// ── Ligas ────────────────────────────────────────────────────────────
export function toLeague(l: DbLeague, now: Date = new Date()): League {
  const d = db();
  const game = d.games.find((g) => g.id === l.gameId);
  const owner = d.users.find((u) => u.id === l.ownerId);
  const tournaments = l.tournamentIds
    .map((id) => d.tournaments.find((t) => t.id === id))
    .filter((t) => t !== undefined)
    .sort((a, b) => (a.startsAt ?? '9999').localeCompare(b.startsAt ?? '9999') || a.name.localeCompare(b.name, 'pt-BR'));
  return {
    id: l.id,
    slug: l.slug,
    name: l.name,
    description: l.description,
    game: { id: l.gameId, slug: game?.slug ?? 'jogo', name: game?.name ?? 'Jogo', icon: game?.icon ?? '🎮' },
    owner: { id: l.ownerId, nickname: owner?.nickname ?? 'Organizador' },
    startsAt: l.startsAt,
    endsAt: l.endsAt,
    status: seasonStatusAt(l, now),
    rule: l.rule,
    tournaments: tournaments.map((t) => ({ id: t.id, slug: t.slug, name: t.name, status: t.status, startsAt: t.startsAt, counted: t.status === 'FINISHED' })),
    createdAt: l.createdAt,
  };
}

type Placement = LeaguePlacement & { href: string | null; avatarUrl: string | null };

/** Colocação final de cada inscrição de um campeonato encerrado: pódio, última fase, fases anteriores. */
export function tournamentPlacements(tournamentId: string): Placement[] {
  const d = db();
  const t = d.tournaments.find((x) => x.id === tournamentId);
  if (!t) return [];
  const orders = [...t.stages]
    .sort((a, b) => a.order - b.order)
    .filter((s) => stageRuns().some((r) => r.stageId === s.id && r.confirmed))
    .map((s) => buildStandings(s.id).overall.map((r) => r.registrationId));
  const podium = podiums().find((p) => p.tournamentId === tournamentId);
  const final = finalPlacements(orders, [...(podium?.places ?? [])].sort((a, b) => a.place - b.place).map((p) => p.registrationId));
  const out: Placement[] = [];
  for (const [registrationId, placement] of Object.entries(final)) {
    const r = d.registrations.find((x) => x.id === registrationId);
    if (!r) continue;
    if (r.teamId) {
      const team = d.teams.find((x) => x.id === r.teamId);
      out.push({ key: `t:${r.teamId}`, name: team?.name ?? r.importedName ?? 'Squad', placement, href: null, avatarUrl: team?.logoUrl ?? null });
    } else if (r.userId) {
      const u = d.users.find((x) => x.id === r.userId);
      const active = u?.status === 'ACTIVE';
      out.push({ key: `u:${r.userId}`, name: u?.nickname ?? 'Jogador', placement, href: active && u ? `/u/${encodeURIComponent(u.nickname)}` : null, avatarUrl: active ? (u?.avatarUrl ?? null) : null });
    } else {
      const name = r.importedName ?? 'Inscrito';
      out.push({ key: `n:${name.trim().toLowerCase()}`, name, placement, href: null, avatarUrl: null });
    }
  }
  return out;
}

export function leagueTable(l: DbLeague): LeagueStandingRow[] {
  const extra = new Map<string, { href: string | null; avatarUrl: string | null }>();
  const results = l.tournamentIds
    .filter((id) => db().tournaments.find((t) => t.id === id)?.status === 'FINISHED')
    .map((id) => {
      const placements = tournamentPlacements(id);
      for (const p of placements) extra.set(p.key, { href: p.href, avatarUrl: p.avatarUrl });
      return { tournamentId: id, placements };
    });
  return computeLeagueTable(results, l.rule).map((r) => ({ ...r, href: extra.get(r.key)?.href ?? null, avatarUrl: extra.get(r.key)?.avatarUrl ?? null }));
}
