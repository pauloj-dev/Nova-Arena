/**
 * Contratos de competição (F2): chave, partidas, resultados, classificação, check-in,
 * envio de resultado pelo participante e disputas.
 */
import { z } from 'zod';
import { Id, IsoDateTime } from './common';
import { Seeding, StageFormat } from './tournament';

export const MatchStatus = z.enum(['SCHEDULED', 'CHECK_IN', 'LIVE', 'AWAITING_VALIDATION', 'VALIDATED', 'DISPUTED', 'WALKOVER', 'CANCELLED']);
export type MatchStatus = z.infer<typeof MatchStatus>;

export const BracketSide = z.enum(['WINNERS', 'LOSERS', 'FINAL', 'THIRD_PLACE']);

/** Um lado do duelo ou uma equipe da sala BR. */
export const MatchParticipant = z.object({
  /** Nulo enquanto o ocupante não é conhecido (ex.: "Vencedor das Quartas 1"). */
  registrationId: Id.nullable(),
  name: z.string(),
  tag: z.string().nullable(),
  logoUrl: z.string().nullable(),
  seed: z.number().int().nullable(),
  /** Texto para a vaga ainda vazia. */
  sourceLabel: z.string().nullable(),
  isBye: z.boolean(),
  /** Duelo: gols, coroas, frames ou jogos vencidos na série. */
  score: z.number().nullable(),
  /** BR: colocação e kills na queda. */
  placement: z.number().int().nullable(),
  kills: z.number().int().nullable(),
  absent: z.boolean(),
  /** Sempre calculado no servidor pelo motor (RN-01). */
  points: z.number().nullable(),
  isWinner: z.boolean().nullable(),
  checkedIn: z.boolean(),
  /** Estatísticas extras (ex.: pênaltis). */
  stats: z.record(z.string(), z.number()).default({}),
  /** Kills por jogador (RN-03), quando a fase usa. */
  playerKills: z.record(z.string(), z.number().int()).default({}),
  status: z.enum(['ACTIVE', 'WITHDRAWN', 'DISQUALIFIED']),
});
export type MatchParticipant = z.infer<typeof MatchParticipant>;

export const Match = z.object({
  /** ID global: `<stageId>~<id da partida no motor>`. */
  id: Id,
  nodeId: z.string(),
  tournamentId: Id,
  stageId: Id,
  stageName: z.string(),
  groupId: z.string().nullable(),
  groupName: z.string().nullable(),
  round: z.number().int(),
  position: z.number().int(),
  bracket: BracketSide.nullable(),
  kind: z.enum(['DUEL', 'LOBBY']),
  bestOf: z.number().int(),
  roundLabel: z.string(),
  dropIndex: z.number().int().nullable(),
  multiplier: z.number(),
  ifNecessary: z.boolean(),
  status: MatchStatus,
  /** A partida ainda espera participantes de partidas anteriores. */
  waitingPrevious: z.boolean(),
  scheduledAt: IsoDateTime.nullable(),
  checkInOpensAt: IsoDateTime.nullable(),
  checkInClosesAt: IsoDateTime.nullable(),
  /** Existe código de sala cadastrado. O código em si só vem de `GET /matches/:id/lobby`. */
  hasLobby: z.boolean(),
  participants: z.array(MatchParticipant),
  evidenceUrls: z.array(z.string()),
  nextMatchId: Id.nullable(),
  loserNextMatchId: Id.nullable(),
  walkover: z.boolean(),
  updatedAt: IsoDateTime.nullable(),
});
export type Match = z.infer<typeof Match>;

export const BracketGroup = z.object({ id: z.string(), name: z.string(), registrationIds: z.array(Id) });

export const Bracket = z.object({
  stageId: Id,
  tournamentId: Id,
  format: StageFormat,
  /** NONE: ainda não gerada · PREVIEW: gerada, aguardando confirmação · CONFIRMED: valendo. */
  state: z.enum(['NONE', 'PREVIEW', 'CONFIRMED']),
  seeding: Seeding.nullable(),
  /** Seed do sorteio, exibida para auditoria (ADR-007). */
  seedUsed: z.string().nullable(),
  /** Travada depois da 1ª partida concluída (só Admin destrava). */
  locked: z.boolean(),
  rounds: z.number().int(),
  groups: z.array(BracketGroup),
  /** Participantes na ordem das seeds. */
  entrants: z.array(z.object({ registrationId: Id, name: z.string(), tag: z.string().nullable(), seed: z.number().int() })),
  matches: z.array(Match),
  complete: z.boolean(),
});
export type Bracket = z.infer<typeof Bracket>;

export const GenerateBracketInput = z.object({
  seeding: Seeding,
  /** Para reproduzir um sorteio. Em branco, o servidor gera e registra. */
  seed: z.string().max(64).optional(),
  /** Ordem manual (seeding MANUAL): IDs de inscrição do 1º ao último seed. */
  order: z.array(Id).optional(),
});
export type GenerateBracketInput = z.infer<typeof GenerateBracketInput>;

/** Ajuste manual antes de a fase começar: troca dois participantes de posição. */
export const SwapSeedingInput = z.object({ a: Id, b: Id });
export type SwapSeedingInput = z.infer<typeof SwapSeedingInput>;

// ── Classificação ────────────────────────────────────────────────────
export const StandingRow = z.object({
  registrationId: Id,
  name: z.string(),
  tag: z.string().nullable(),
  logoUrl: z.string().nullable(),
  groupId: z.string().nullable(),
  position: z.number().int(),
  played: z.number().int(),
  wins: z.number().int(),
  draws: z.number().int(),
  losses: z.number().int(),
  points: z.number(),
  booyahs: z.number().int(),
  kills: z.number().int(),
  scoreFor: z.number(),
  scoreAgainst: z.number(),
  scoreDiff: z.number(),
  avgPlacement: z.number().nullable(),
  lastDropKills: z.number().int(),
  status: z.enum(['ACTIVE', 'WITHDRAWN', 'DISQUALIFIED']),
  eliminated: z.boolean(),
  /** Explicação em pt-BR quando a posição foi decidida por desempate. */
  tiebreakNote: z.string().nullable(),
  /** Está na zona de classificação para a próxima fase. */
  qualifying: z.boolean(),
  /** Pontos por queda (BR), na ordem das quedas. */
  perDrop: z.array(z.object({ dropIndex: z.number().int(), placement: z.number().int().nullable(), kills: z.number().int(), points: z.number() })).default([]),
});
export type StandingRow = z.infer<typeof StandingRow>;

export const Standings = z.object({
  stageId: Id,
  format: StageFormat,
  matchType: z.enum(['DUEL', 'TEAM_VS_TEAM', 'BATTLE_ROYALE']),
  groups: z.array(z.object({ groupId: z.string().nullable(), name: z.string(), rows: z.array(StandingRow) })),
  overall: z.array(StandingRow),
  drawUsed: z.boolean(),
  drawSeed: z.string().nullable(),
  /** Ranking de MVP (kills por jogador), quando a fase usa. */
  mvp: z.array(z.object({ userId: Id, nickname: z.string(), teamName: z.string(), kills: z.number().int() })).default([]),
  updatedAt: IsoDateTime,
});
export type Standings = z.infer<typeof Standings>;

// ── Agenda, sala e check-in ──────────────────────────────────────────
export const ScheduleMatchInput = z.object({
  scheduledAt: IsoDateTime.nullable().optional(),
  lobbyCode: z.string().max(40).nullable().optional(),
  lobbyPassword: z.string().max(40).nullable().optional(),
});
export type ScheduleMatchInput = z.infer<typeof ScheduleMatchInput>;

/** Agenda de uma rodada inteira: primeira partida em `startsAt`, as seguintes a cada `intervalMinutes`. */
export const ScheduleRoundInput = z.object({
  round: z.number().int().min(1),
  groupId: z.string().nullable().optional(),
  bracket: BracketSide.nullable().optional(),
  startsAt: IsoDateTime,
  intervalMinutes: z.number().int().min(0).max(24 * 60).default(0),
});
export type ScheduleRoundInput = z.infer<typeof ScheduleRoundInput>;

export const MatchLobby = z.object({ code: z.string(), password: z.string().nullable(), revealedAt: IsoDateTime });
export type MatchLobby = z.infer<typeof MatchLobby>;

// ── Resultados ───────────────────────────────────────────────────────
export const ResultEntryInput = z.object({
  registrationId: Id,
  score: z.number().int().min(0, 'O placar não pode ser negativo').max(999).optional(),
  placement: z.number().int().min(1, 'A colocação começa em 1').max(100).optional(),
  kills: z.number().int().min(0, 'Kills não podem ser negativas').max(999).optional(),
  absent: z.boolean().optional(),
  stats: z.record(z.string(), z.number().min(0)).optional(),
  playerKills: z.record(z.string(), z.number().int().min(0)).optional(),
});
export type ResultEntryInput = z.infer<typeof ResultEntryInput>;

/** O cliente manda só estatísticas brutas. Pontos nunca vêm do cliente (RN-01). */
export const SubmitResultInput = z.object({
  entries: z.array(ResultEntryInput).min(1),
  /** Obrigatório quando o placar empata em partida eliminatória (RN-14). */
  winnerRegistrationId: Id.nullable().optional(),
  evidenceUrls: z.array(z.string()).max(6).default([]),
  /** Motivo, obrigatório ao corrigir um resultado já validado. */
  correctionReason: z.string().max(500).optional(),
});
export type SubmitResultInput = z.infer<typeof SubmitResultInput>;

export const WalkoverInput = z.object({ winnerRegistrationId: Id, reason: z.string().min(3, 'Informe o motivo') });
export type WalkoverInput = z.infer<typeof WalkoverInput>;

export const ResultBreakdown = z.object({ registrationId: Id, name: z.string(), points: z.number(), breakdown: z.array(z.object({ label: z.string(), points: z.number() })) });
export const SubmitResultResponse = z.object({ match: Match, results: z.array(ResultBreakdown) });
export type SubmitResultResponse = z.infer<typeof SubmitResultResponse>;

/** Importação de resultados de quedas por CSV, enviada em lotes. */
export const ImportResultsInput = z.object({ results: z.array(z.object({ matchId: Id, entries: z.array(ResultEntryInput).min(1) })).min(1).max(50) });
export const ImportResultsResult = z.object({ applied: z.number().int(), errors: z.array(z.object({ matchId: Id, message: z.string() })) });

/** Histórico de um resultado: cada lançamento ou correção (melhoria 2 do plano). */
export const ResultEvent = z.object({
  id: Id,
  matchId: Id,
  type: z.enum(['ENTERED', 'CORRECTED', 'WALKOVER', 'REVERTED']),
  actorNickname: z.string(),
  summary: z.string(),
  reason: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type ResultEvent = z.infer<typeof ResultEvent>;

// ── Avanço de fase e encerramento ────────────────────────────────────
export const AdvancePreview = z.object({
  fromStageId: Id,
  toStageId: Id,
  qualified: z.array(z.object({ registrationId: Id, name: z.string(), groupName: z.string().nullable(), groupPosition: z.number().int(), via: z.enum(['DIRECT', 'REPECHAGE']), seed: z.number().int() })),
  eliminated: z.array(z.object({ registrationId: Id, name: z.string() })),
  next: Bracket,
});
export type AdvancePreview = z.infer<typeof AdvancePreview>;

export const FinishTournamentInput = z.object({ first: Id, second: Id.nullable(), third: Id.nullable() });
export type FinishTournamentInput = z.infer<typeof FinishTournamentInput>;
export const Podium = z.object({
  tournamentId: Id,
  places: z.array(z.object({ place: z.number().int().min(1).max(3), registrationId: Id, name: z.string(), tag: z.string().nullable(), logoUrl: z.string().nullable() })),
  finishedAt: IsoDateTime,
});
export type Podium = z.infer<typeof Podium>;

export const WithdrawInput = z.object({ kind: z.enum(['WITHDRAWN', 'DISQUALIFIED']), reason: z.string().min(3, 'Informe o motivo') });
export type WithdrawInput = z.infer<typeof WithdrawInput>;
export const ReasonInput = z.object({ reason: z.string().min(3, 'Informe o motivo') });

// ── Envio pelo participante e disputas ───────────────────────────────
export const SubmissionStatus = z.enum(['PENDING', 'CONFIRMED', 'CONTESTED', 'APPROVED', 'REJECTED']);
export const ResultSubmission = z.object({
  id: Id,
  matchId: Id,
  tournamentId: Id,
  tournamentName: z.string(),
  matchLabel: z.string(),
  submittedByNickname: z.string(),
  submittedByRegistrationId: Id,
  entries: z.array(ResultEntryInput),
  winnerRegistrationId: Id.nullable(),
  evidenceUrls: z.array(z.string()),
  status: SubmissionStatus,
  createdAt: IsoDateTime,
  /** Prazo para o adversário responder; depois disso vai para a validação do staff. */
  respondBy: IsoDateTime,
});
export type ResultSubmission = z.infer<typeof ResultSubmission>;

export const CreateSubmissionInput = SubmitResultInput.pick({ entries: true, winnerRegistrationId: true }).extend({
  evidenceUrls: z.array(z.string()).min(1, 'Anexe pelo menos um print do resultado').max(6),
});
export type CreateSubmissionInput = z.infer<typeof CreateSubmissionInput>;

export const DisputeStatus = z.enum(['OPEN', 'ESCALATED', 'RESOLVED']);
export const DisputeMessage = z.object({ id: Id, authorNickname: z.string(), authorRole: z.enum(['PARTICIPANT', 'STAFF', 'ADMIN']), body: z.string(), evidenceUrls: z.array(z.string()), createdAt: IsoDateTime });
export const Dispute = z.object({
  id: Id,
  matchId: Id,
  submissionId: Id.nullable(),
  tournamentId: Id,
  tournamentName: z.string(),
  matchLabel: z.string(),
  openedByNickname: z.string(),
  reason: z.string(),
  status: DisputeStatus,
  resolution: z.string().nullable(),
  messages: z.array(DisputeMessage),
  createdAt: IsoDateTime,
  resolvedAt: IsoDateTime.nullable(),
});
export type Dispute = z.infer<typeof Dispute>;

export const OpenDisputeInput = z.object({
  reason: z.string().min(10, 'Explique o que está errado (pelo menos 10 caracteres)').max(1000),
  /** Prova obrigatória ao contestar (PRD §16.5). */
  evidenceUrls: z.array(z.string()).min(1, 'Anexe pelo menos uma prova').max(6),
});
export const DisputeMessageInput = z.object({ body: z.string().min(1, 'Escreva a mensagem').max(1000), evidenceUrls: z.array(z.string()).max(6).default([]) });
export const ResolveDisputeInput = z.object({ resolution: z.string().min(5, 'Descreva a decisão').max(1000), result: SubmitResultInput.optional() });
export const ReviewSubmissionInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().min(3, 'Informe o motivo') }),
]);

// ── Uploads (provas, logos, banners) ─────────────────────────────────
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const UploadTokenInput = z.object({
  purpose: z.enum(['evidence', 'avatar', 'team-logo', 'banner', 'game-cover', 'report']),
  contentType: z.enum(UPLOAD_MIME_TYPES, 'Envie uma imagem PNG, JPG ou WebP'),
  size: z.number().int().positive().max(UPLOAD_MAX_BYTES, 'A imagem pode ter no máximo 5 MB'),
});
export const UploadToken = z.object({ uploadUrl: z.string(), token: z.string(), expiresAt: IsoDateTime });
export const UploadResult = z.object({ url: z.string() });

// ── Perfil competitivo ───────────────────────────────────────────────
export const CompetitiveStats = z.object({
  userId: Id,
  perGame: z.array(
    z.object({
      gameId: Id,
      gameName: z.string(),
      gameIcon: z.string(),
      tournaments: z.number().int(),
      titles: z.number().int(),
      wins: z.number().int(),
      matches: z.number().int(),
      kills: z.number().int(),
      score: z.number().int(),
    }),
  ),
  achievements: z.array(z.object({ id: Id, type: z.enum(['CHAMPION', 'RUNNER_UP', 'THIRD_PLACE', 'FIRST_TOURNAMENT', 'TEN_TOURNAMENTS', 'MVP']), label: z.string(), tournamentName: z.string().nullable(), awardedAt: IsoDateTime })),
  history: z.array(z.object({ tournamentId: Id, tournamentName: z.string(), tournamentSlug: z.string(), gameIcon: z.string(), placement: z.number().int().nullable(), finishedAt: IsoDateTime.nullable(), teamName: z.string().nullable() })),
});
export type OpenDisputeInput = z.infer<typeof OpenDisputeInput>;
export type DisputeMessageInput = z.infer<typeof DisputeMessageInput>;
export type ResolveDisputeInput = z.infer<typeof ResolveDisputeInput>;
export type ReviewSubmissionInput = z.infer<typeof ReviewSubmissionInput>;
export type UploadTokenInput = z.infer<typeof UploadTokenInput>;
export type CompetitiveStats = z.infer<typeof CompetitiveStats>;
