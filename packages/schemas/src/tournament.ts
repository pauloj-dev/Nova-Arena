import { z } from 'zod';
import { Id, IsoDateTime, Slug } from './common';
import { PublicUser } from './user';
import { Tiebreaker } from './game';

export const TournamentStatus = z.enum([
  'DRAFT',
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'CHECK_IN',
  'IN_PROGRESS',
  'PAUSED',
  'FINISHED',
  'ARCHIVED',
  'CANCELLED',
]);
export type TournamentStatus = z.infer<typeof TournamentStatus>;

/** Transições válidas do ciclo de vida (PRD §8.3). */
export const TOURNAMENT_TRANSITIONS: Record<TournamentStatus, TournamentStatus[]> = {
  DRAFT: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['REGISTRATION_OPEN', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'CANCELLED'],
  REGISTRATION_CLOSED: ['CHECK_IN', 'IN_PROGRESS', 'CANCELLED'],
  CHECK_IN: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['PAUSED', 'FINISHED'],
  PAUSED: ['IN_PROGRESS', 'CANCELLED'],
  FINISHED: ['ARCHIVED'],
  ARCHIVED: [],
  CANCELLED: [],
};
export function canTransition(from: TournamentStatus, to: TournamentStatus): boolean {
  return TOURNAMENT_TRANSITIONS[from].includes(to);
}
/** Estados que contam para o limite de campeonatos simultâneos (RN-10). */
export const ACTIVE_TOURNAMENT_STATUSES: TournamentStatus[] = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN', 'IN_PROGRESS', 'PAUSED'];

export const StageFormat = z.enum(['SINGLE_ELIM', 'DOUBLE_ELIM', 'GROUPS', 'ROUND_ROBIN', 'SWISS', 'BATTLE_ROYALE', 'TEAM_VS_TEAM']);
export type StageFormat = z.infer<typeof StageFormat>;

export const Seeding = z.enum(['RANDOM', 'RANKED', 'MANUAL']);
export type Seeding = z.infer<typeof Seeding>;

export const BestOf = z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(7)]);
export type BestOf = z.infer<typeof BestOf>;

/** Configuração da fase. Cada formato usa um subconjunto dos campos. */
export const StageConfig = z.object({
  bestOf: BestOf.default(1),
  /** SINGLE_ELIM / TEAM_VS_TEAM: disputa de 3º lugar. */
  thirdPlace: z.boolean().default(false),
  /** DOUBLE_ELIM: se o vindo da chave de perdedores vencer a final, joga-se outra. */
  grandFinalReset: z.boolean().default(true),
  /** GROUPS: quantos grupos. */
  groupCount: z.number().int().min(1).max(64).default(4),
  /** GROUPS: dentro do grupo, duelos em pontos corridos ou quedas BR. */
  groupMode: z.enum(['DUEL', 'BATTLE_ROYALE']).default('DUEL'),
  /** ROUND_ROBIN / GROUPS (duelos): turno e returno. */
  doubleRound: z.boolean().default(false),
  /** SWISS: número de rodadas. */
  rounds: z.number().int().min(1).max(15).default(5),
  /** BATTLE_ROYALE / GROUPS (BR): quedas por sala. */
  drops: z.number().int().min(1).max(20).default(3),
  /** BATTLE_ROYALE: máximo de equipes por sala (ADR-0001: padrão 12). */
  lobbySize: z.number().int().min(2).max(100).default(12),
  /** Lançar kills por jogador para o ranking de MVP (RN-03). */
  killsPerPlayer: z.boolean().default(false),
  /** Multiplicador da última queda (1 = sem multiplicador). */
  lastDropMultiplier: z.number().min(1).max(5).default(1),
});
export type StageConfig = z.infer<typeof StageConfig>;

/** Quem avança para a próxima fase. */
export const Qualification = z.object({
  type: z.enum(['TOP_N_PER_GROUP', 'TOP_N_OVERALL', 'WINNERS']),
  n: z.number().int().min(1).max(512),
  /** Completar a sala da próxima fase com os N melhores eliminados (ADR-0001: desligado por padrão). */
  repechage: z.number().int().min(0).max(64).default(0),
});
export type Qualification = z.infer<typeof Qualification>;

export const StageStatus = z.enum(['PENDING', 'ACTIVE', 'COMPLETED']);

export const Stage = z.object({
  id: Id,
  tournamentId: Id,
  order: z.number().int().min(1),
  name: z.string().min(1, 'Dê um nome à fase'),
  format: StageFormat,
  scoringModelId: Id,
  config: StageConfig,
  /** Nulo na última fase. */
  qualification: Qualification.nullable(),
  tiebreakers: z.array(Tiebreaker).min(1),
  seeding: Seeding,
  randomSeed: z.string().nullable(),
  status: StageStatus,
  lockedAt: IsoDateTime.nullable(),
});
export type Stage = z.infer<typeof Stage>;

export const StageInput = Stage.omit({ id: true, tournamentId: true, order: true, randomSeed: true, status: true, lockedAt: true }).extend({
  id: Id.optional(),
});
export type StageInput = z.infer<typeof StageInput>;

export const CheckInConfig = z.object({
  enabled: z.boolean().default(true),
  /** Janela: abre X min antes e fecha Y min antes da partida (PAR-07: ex. 30 a 10). */
  opensMinutesBefore: z.number().int().min(5).max(180).default(30),
  closesMinutesBefore: z.number().int().min(0).max(60).default(10),
  /** Em squads: todos precisam fazer check-in (padrão: só o capitão). */
  requireAllMembers: z.boolean().default(false),
});
export type CheckInConfig = z.infer<typeof CheckInConfig>;

export const ParticipantType = z.enum(['SOLO', 'TEAM']);

const tournamentBase = {
  id: Id,
  slug: Slug,
  name: z.string().min(3, 'O nome precisa de pelo menos 3 caracteres').max(80),
  gameId: Id,
  gameModeId: Id,
  ownerId: Id,
  status: TournamentStatus,
  participantType: ParticipantType,
  maxParticipants: z.number().int().min(2, 'Mínimo de 2 vagas').max(1024, 'Máximo de 1.024 vagas'),
  registrationOpensAt: IsoDateTime.nullable(),
  registrationClosesAt: IsoDateTime.nullable(),
  startsAt: IsoDateTime.nullable(),
  bannerUrl: z.string().nullable(),
  featured: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
};

/** Versão resumida, para cards e listas. */
export const TournamentSummary = z.object({
  ...tournamentBase,
  gameName: z.string(),
  gameIcon: z.string(),
  modeName: z.string(),
  organizerNickname: z.string(),
  organizerVerified: z.boolean(),
  /** Vagas ocupadas (inscrições confirmadas + aguardando). */
  takenSlots: z.number().int(),
  free: z.boolean(),
});
export type TournamentSummary = z.infer<typeof TournamentSummary>;

export const Tournament = TournamentSummary.extend({
  /** HTML já sanitizado (lista de tags permitidas). */
  description: z.string(),
  rules: z.string(),
  prize: z.string(),
  /** Só links de Twitch e YouTube. */
  streamUrls: z.array(z.url()),
  manualApproval: z.boolean(),
  waitlistEnabled: z.boolean(),
  checkIn: CheckInConfig,
  rosterLockAt: IsoDateTime.nullable(),
  stages: z.array(Stage),
  organizer: PublicUser,
  /** Passo do assistente em que o rascunho parou (0 a 6). */
  draftStep: z.number().int().min(0).max(6),
  waitlistCount: z.number().int(),
});
export type Tournament = z.infer<typeof Tournament>;

const STREAM_HOSTS = ['twitch.tv', 'www.twitch.tv', 'youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'];
export function isAllowedStreamUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && STREAM_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}
export const StreamUrl = z.url('Informe um link válido').refine(isAllowedStreamUrl, 'Só aceitamos links da Twitch e do YouTube');

/** Tudo é opcional: o rascunho é salvo a cada passo do assistente. */
export const TournamentDraftInput = z.object({
  name: tournamentBase.name.optional(),
  description: z.string().max(20000).optional(),
  rules: z.string().max(50000).optional(),
  prize: z.string().max(2000).optional(),
  bannerUrl: z.string().nullable().optional(),
  streamUrls: z.array(StreamUrl).max(4).optional(),
  gameId: Id.optional(),
  gameModeId: Id.optional(),
  maxParticipants: tournamentBase.maxParticipants.optional(),
  registrationOpensAt: IsoDateTime.nullable().optional(),
  registrationClosesAt: IsoDateTime.nullable().optional(),
  startsAt: IsoDateTime.nullable().optional(),
  manualApproval: z.boolean().optional(),
  waitlistEnabled: z.boolean().optional(),
  checkIn: CheckInConfig.optional(),
  rosterLockAt: IsoDateTime.nullable().optional(),
  stages: z.array(StageInput).optional(),
  draftStep: z.number().int().min(0).max(6).optional(),
});
export type TournamentDraftInput = z.infer<typeof TournamentDraftInput>;

export const TournamentListQuery = z.object({
  q: z.string().optional(),
  game: z.string().optional(),
  mode: z.enum(['SOLO', 'TEAM']).optional(),
  status: z.enum(['open', 'upcoming', 'live', 'finished']).optional(),
  from: z.iso.date().optional(),
  slots: z.enum(['available']).optional(),
  verified: z.enum(['1']).optional(),
  featured: z.enum(['1']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type TournamentListQuery = z.infer<typeof TournamentListQuery>;

export const TournamentTemplate = z.object({
  id: Id,
  /** Nulo = modelo da plataforma. */
  ownerId: Id.nullable(),
  name: z.string().min(1),
  description: z.string(),
  gameId: Id,
  gameModeId: Id,
  payload: TournamentDraftInput,
});
export type TournamentTemplate = z.infer<typeof TournamentTemplate>;

export const Announcement = z.object({
  id: Id,
  tournamentId: Id.nullable(),
  stageId: Id.nullable(),
  groupId: Id.nullable(),
  authorNickname: z.string(),
  title: z.string().min(1, 'Dê um título'),
  body: z.string().min(1, 'Escreva a mensagem'),
  createdAt: IsoDateTime,
});
export type Announcement = z.infer<typeof Announcement>;
export const AnnouncementInput = Announcement.pick({ title: true, body: true }).extend({ stageId: Id.nullable().default(null), groupId: Id.nullable().default(null) });

export const StaffRole = z.enum(['CO_ORGANIZER', 'MODERATOR']);
export const TournamentStaff = z.object({ userId: Id, nickname: z.string(), avatarUrl: z.string().nullable(), role: StaffRole, addedAt: IsoDateTime });
export type TournamentStaff = z.infer<typeof TournamentStaff>;
