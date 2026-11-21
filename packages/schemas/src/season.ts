/**
 * Ranking de temporada (rating ELO) e ligas semanais — issue #120, ADR-0003.
 * Contratos únicos para a API real (`packages/api/src/modules/seasons`), a simulada (`mocks/handlers/seasons.ts`)
 * e as telas (`features/seasons`).
 */
import { z } from 'zod';
import { Id, IsoDateTime, Slug } from './common';

// ── Temporadas ───────────────────────────────────────────────────────
/** Derivado das datas: antes do início, entre o início e o fim, depois do fim. */
export const SeasonStatus = z.enum(['UPCOMING', 'ACTIVE', 'ENDED']);
export type SeasonStatus = z.infer<typeof SeasonStatus>;

export const SEASON_STATUS_LABELS: Record<SeasonStatus, string> = { UPCOMING: 'Em breve', ACTIVE: 'Em andamento', ENDED: 'Encerrada' };

export const Season = z.object({
  id: Id,
  gameId: Id,
  gameSlug: Slug,
  gameName: z.string(),
  name: z.string(),
  startsAt: IsoDateTime,
  /** Exclusivo: a temporada vale até este instante. */
  endsAt: IsoDateTime,
  status: SeasonStatus,
});
export type Season = z.infer<typeof Season>;

const seasonName = z.string().trim().min(3, 'Use pelo menos 3 caracteres').max(60, 'Use no máximo 60 caracteres');
const endsAfterStart = (v: { startsAt?: string; endsAt?: string }) => !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt);
const endsAfterStartIssue = { message: 'O fim precisa ser depois do início', path: ['endsAt'] };

export const SeasonInput = z
  .object({ gameId: Id, name: seasonName, startsAt: IsoDateTime, endsAt: IsoDateTime })
  .refine(endsAfterStart, endsAfterStartIssue);
export type SeasonInput = z.infer<typeof SeasonInput>;

export const SeasonPatch = z
  .object({ name: seasonName, startsAt: IsoDateTime, endsAt: IsoDateTime })
  .partial()
  .refine(endsAfterStart, endsAfterStartIssue);
export type SeasonPatch = z.infer<typeof SeasonPatch>;

/** Status pelas datas (as duas pontas em UTC). */
export function seasonStatusAt(season: { startsAt: string; endsAt: string }, now: Date): SeasonStatus {
  if (now < new Date(season.startsAt)) return 'UPCOMING';
  return now < new Date(season.endsAt) ? 'ACTIVE' : 'ENDED';
}

// ── Rating ───────────────────────────────────────────────────────────
/** `PLAYER`: um rating por pessoa. `TEAM`: um rating por squad cadastrado. */
export const RatingKind = z.enum(['PLAYER', 'TEAM']);
export type RatingKind = z.infer<typeof RatingKind>;

export const RatingSettings = z.object({ initial: z.number().int(), k: z.number().int(), provisionalMatches: z.number().int() });
export type RatingSettings = z.infer<typeof RatingSettings>;

export const SeasonRankingEntry = z.object({
  position: z.number().int().min(1),
  /** Id do usuário (`PLAYER`) ou do squad (`TEAM`). */
  subjectId: Id,
  name: z.string(),
  tag: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  /** Perfil público: `/u/<apelido>` ou `/squads/<id>`. */
  href: z.string().nullable(),
  /** Arredondado para inteiro. */
  rating: z.number().int(),
  peak: z.number().int(),
  played: z.number().int().min(0),
  wins: z.number().int().min(0),
  draws: z.number().int().min(0),
  losses: z.number().int().min(0),
  /** Menos partidas do que `settings.provisionalMatches`: o rating ainda está se ajustando. */
  provisional: z.boolean(),
  /** Variação na última partida (arredondada). */
  lastDelta: z.number().int(),
});
export type SeasonRankingEntry = z.infer<typeof SeasonRankingEntry>;

export const SeasonRanking = z.object({
  game: z.object({ id: Id, slug: Slug, name: z.string() }),
  /** A temporada mostrada: a pedida ou a atual. Nula quando o jogo não tem temporada em andamento. */
  season: Season.nullable(),
  /** Todas as temporadas do jogo, da mais recente para a mais antiga (para o seletor). */
  seasons: z.array(Season),
  kind: RatingKind,
  settings: RatingSettings,
  entries: z.array(SeasonRankingEntry),
});
export type SeasonRanking = z.infer<typeof SeasonRanking>;

export const RatingHistoryPoint = z.object({
  at: IsoDateTime,
  rating: z.number().int(),
  delta: z.number().int(),
});
export type RatingHistoryPoint = z.infer<typeof RatingHistoryPoint>;

/** Rating de uma pessoa ou squad em um jogo, na temporada atual (ou na última encerrada). */
export const SubjectRating = z.object({
  game: z.object({ id: Id, slug: Slug, name: z.string(), icon: z.string() }),
  season: Season,
  rating: z.number().int(),
  peak: z.number().int(),
  played: z.number().int(),
  wins: z.number().int(),
  draws: z.number().int(),
  losses: z.number().int(),
  provisional: z.boolean(),
  /** Posição na tabela da temporada. */
  position: z.number().int().min(1),
  /** Evolução partida a partida, em ordem cronológica (no máximo as 50 últimas). */
  history: z.array(RatingHistoryPoint),
});
export type SubjectRating = z.infer<typeof SubjectRating>;

export const SubjectRatings = z.object({
  kind: RatingKind,
  subjectId: Id,
  settings: RatingSettings,
  entries: z.array(SubjectRating),
});
export type SubjectRatings = z.infer<typeof SubjectRatings>;

// ── Ligas semanais ───────────────────────────────────────────────────
export const LeagueRule = z.object({
  /** Índice 0 = 1º lugar. Colocação fora da lista vale só a participação. */
  placementPoints: z
    .array(z.number().int('Use números inteiros').min(0, 'Use números a partir de 0').max(1000, 'Use no máximo 1000 pontos'))
    .min(1, 'Informe os pontos de pelo menos o 1º lugar')
    .max(64, 'Informe no máximo 64 colocações')
    .refine((list) => list.every((p, i) => i === 0 || p <= (list[i - 1] as number)), 'Uma colocação não pode valer mais do que a anterior'),
  participationPoints: z.number().int('Use um número inteiro').min(0, 'Use um número a partir de 0').max(100, 'Use no máximo 100 pontos'),
});
export type LeagueRule = z.infer<typeof LeagueRule>;

/** Regra sugerida ao criar uma liga (estilo F1: 25, 18, 15…, mais 1 por participar). */
export const DEFAULT_LEAGUE_RULE: LeagueRule = { placementPoints: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], participationPoints: 1 };

export const LeagueTournament = z.object({
  id: Id,
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  startsAt: IsoDateTime.nullable(),
  /** Só campeonatos encerrados somam pontos na tabela. */
  counted: z.boolean(),
});
export type LeagueTournament = z.infer<typeof LeagueTournament>;

export const League = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  description: z.string(),
  game: z.object({ id: Id, slug: Slug, name: z.string(), icon: z.string() }),
  owner: z.object({ id: Id, nickname: z.string() }),
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
  status: SeasonStatus,
  rule: LeagueRule,
  tournaments: z.array(LeagueTournament),
  createdAt: IsoDateTime,
});
export type League = z.infer<typeof League>;

export const LeagueStandingRow = z.object({
  position: z.number().int().min(1),
  /** `u:<id>` (jogador), `t:<id>` (squad) ou `n:<nome>` (inscrição sem conta). */
  key: z.string(),
  name: z.string(),
  href: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  points: z.number().int(),
  played: z.number().int(),
  wins: z.number().int(),
  bestPlacement: z.number().int().min(1),
  results: z.array(z.object({ tournamentId: Id, placement: z.number().int().min(1), points: z.number().int() })),
});
export type LeagueStandingRow = z.infer<typeof LeagueStandingRow>;

export const LeagueDetail = z.object({ league: League, table: z.array(LeagueStandingRow) });
export type LeagueDetail = z.infer<typeof LeagueDetail>;

const leagueName = z.string().trim().min(3, 'Use pelo menos 3 caracteres').max(80, 'Use no máximo 80 caracteres');
const leagueDescription = z.string().trim().max(1000, 'Use no máximo 1000 caracteres');

export const LeagueInput = z
  .object({ name: leagueName, description: leagueDescription.default(''), gameId: Id, startsAt: IsoDateTime, endsAt: IsoDateTime, rule: LeagueRule })
  .refine(endsAfterStart, endsAfterStartIssue);
export type LeagueInput = z.input<typeof LeagueInput>;

export const LeaguePatch = z
  .object({ name: leagueName, description: leagueDescription, startsAt: IsoDateTime, endsAt: IsoDateTime, rule: LeagueRule })
  .partial()
  .refine(endsAfterStart, endsAfterStartIssue);
export type LeaguePatch = z.infer<typeof LeaguePatch>;

export const LeagueTournamentInput = z.object({ tournamentId: Id });
export type LeagueTournamentInput = z.infer<typeof LeagueTournamentInput>;
