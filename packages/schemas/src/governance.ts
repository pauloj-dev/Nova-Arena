/** Contratos de governança (F2): denúncias, sanções, auditoria, administração e configurações. */
import { z } from 'zod';
import { Id, IsoDateTime } from './common';
import { Role, UserStatus } from './user';
import { TournamentStatus } from './tournament';

// ── Denúncias e sanções ──────────────────────────────────────────────
export const ReportTarget = z.enum(['USER', 'TEAM', 'MATCH', 'RESULT']);
export const ReportStatus = z.enum(['OPEN', 'IN_REVIEW', 'ACTIONED', 'DISMISSED']);
export const ReportReason = z.enum(['CHEATING', 'FAKE_RESULT', 'HARASSMENT', 'OFFENSIVE_NAME', 'IMPERSONATION', 'OTHER']);
export const REPORT_REASON_LABELS: Record<z.infer<typeof ReportReason>, string> = {
  CHEATING: 'Trapaça (hack, emulador, conta de outra pessoa)',
  FAKE_RESULT: 'Resultado falso',
  HARASSMENT: 'Ofensa ou assédio',
  OFFENSIVE_NAME: 'Nome, tag ou imagem ofensiva',
  IMPERSONATION: 'Se passa por outra pessoa',
  OTHER: 'Outro motivo',
};
export const Report = z.object({
  id: Id,
  targetType: ReportTarget,
  targetId: Id,
  targetLabel: z.string(),
  targetLink: z.string().nullable(),
  reporterNickname: z.string(),
  reason: ReportReason,
  description: z.string(),
  evidenceUrls: z.array(z.string()),
  status: ReportStatus,
  resolution: z.string().nullable(),
  handledByNickname: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Report = z.infer<typeof Report>;
export const CreateReportInput = z.object({
  targetType: ReportTarget,
  targetId: Id,
  reason: ReportReason,
  description: z.string().min(10, 'Conte o que aconteceu (pelo menos 10 caracteres)').max(1000),
  evidenceUrls: z.array(z.string()).max(6).default([]),
});
export type CreateReportInput = z.infer<typeof CreateReportInput>;
export const HandleReportInput = z.object({ status: ReportStatus, resolution: z.string().max(1000).optional() });

export const SanctionType = z.enum(['WARNING', 'SUSPENSION', 'BAN']);
export const Sanction = z.object({
  id: Id,
  userId: Id,
  type: SanctionType,
  reason: z.string(),
  issuedByNickname: z.string(),
  startsAt: IsoDateTime,
  endsAt: IsoDateTime.nullable(),
  liftedAt: IsoDateTime.nullable(),
  reportId: Id.nullable(),
});
export type Sanction = z.infer<typeof Sanction>;
export const CreateSanctionInput = z
  .object({
    type: SanctionType,
    reason: z.string().min(5, 'Informe o motivo').max(500),
    /** Só para suspensão: duração em dias. */
    days: z.number().int().min(1).max(365).optional(),
    reportId: Id.optional(),
  })
  .refine((v) => v.type !== 'SUSPENSION' || v.days !== undefined, { path: ['days'], message: 'Informe por quantos dias' });
export type CreateSanctionInput = z.infer<typeof CreateSanctionInput>;

// ── Usuários (Admin) ─────────────────────────────────────────────────
export const AdminUser = z.object({
  id: Id,
  nickname: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  roles: z.array(Role),
  status: UserStatus,
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean(),
  verifiedOrganizer: z.boolean(),
  createdAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  suspendedUntil: IsoDateTime.nullable(),
});
export type AdminUser = z.infer<typeof AdminUser>;
export const AdminUserDetail = AdminUser.extend({
  bio: z.string().nullable(),
  state: z.string().nullable(),
  gameAccounts: z.array(z.object({ gameName: z.string(), fields: z.record(z.string(), z.string()) })),
  sanctions: z.array(Sanction),
  tournamentsPlayed: z.number().int(),
  tournamentsOrganized: z.number().int(),
  teams: z.array(z.object({ id: Id, name: z.string(), tag: z.string(), isCaptain: z.boolean() })),
  reportsAgainst: z.number().int(),
  organizerLimits: z.object({ maxActiveTournaments: z.number().int(), allowedGameIds: z.array(Id) }).nullable(),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetail>;
export const MergeUsersInput = z.object({ sourceUserId: Id, reason: z.string().min(5, 'Informe o motivo') });
export const OrganizerLimitsInput = z.object({ maxActiveTournaments: z.number().int().min(0).max(100), allowedGameIds: z.array(Id), verified: z.boolean() });
export type OrganizerLimitsInput = z.infer<typeof OrganizerLimitsInput>;
export const RoleChangeInput = z.object({ role: z.enum(['ADMIN', 'ORGANIZER']), reason: z.string().max(500).optional() });

// ── Convites de papel e pedidos de organizador ───────────────────────
export const RoleInvite = z.object({
  id: Id,
  role: z.enum(['ADMIN', 'ORGANIZER']),
  email: z.string().nullable(),
  /** Link completo. Só vem na resposta da criação: o servidor guarda apenas o hash do token. */
  link: z.string().nullable(),
  maxUses: z.number().int(),
  uses: z.number().int(),
  state: z.enum(['VALID', 'EXPIRED', 'REVOKED', 'EXHAUSTED']),
  createdByNickname: z.string(),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type RoleInvite = z.infer<typeof RoleInvite>;
export const CreateRoleInviteInput = z.object({
  role: z.enum(['ADMIN', 'ORGANIZER']),
  email: z.email('Informe um e-mail válido').optional(),
  /** Validade: 1 hora, 24 horas ou 7 dias (US-ADM-02). */
  validity: z.enum(['1h', '24h', '7d']),
  maxUses: z.number().int().min(1, 'Mínimo de 1 uso').max(10, 'Máximo de 10 usos'),
});
export type CreateRoleInviteInput = z.infer<typeof CreateRoleInviteInput>;

export const AdminOrganizerRequest = z.object({
  id: Id,
  userId: Id,
  nickname: z.string(),
  avatarUrl: z.string().nullable(),
  justification: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  reviewReason: z.string().nullable(),
  tournamentsPlayed: z.number().int(),
  memberSince: IsoDateTime,
  sanctions: z.number().int(),
  createdAt: IsoDateTime,
});
export type AdminOrganizerRequest = z.infer<typeof AdminOrganizerRequest>;
export const ReviewOrganizerRequestInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), reason: z.string().max(500).optional() }),
  z.object({ action: z.literal('reject'), reason: z.string().min(5, 'Informe o motivo da recusa').max(500) }),
]);

// ── Auditoria ────────────────────────────────────────────────────────
/**
 * Catálogo único das ações auditadas (RF-06, issue #71): a API real e a simulada gravam só essas ações,
 * e a tela de auditoria usa a lista nos filtros.
 */
export const AUDIT_ACTIONS = {
  INVITE_CREATED: 'Convite criado',
  INVITE_REVOKED: 'Convite revogado',
  INVITE_ACCEPTED: 'Convite aceito',
  ROLE_GRANTED: 'Papel concedido',
  ROLE_REVOKED: 'Papel revogado',
  ORGANIZER_REQUEST_REVIEWED: 'Pedido de organizador analisado',
  ORGANIZER_LIMITS_CHANGED: 'Limites do organizador alterados',
  USER_SANCTIONED: 'Usuário sancionado',
  SANCTION_LIFTED: 'Sanção removida',
  USER_PASSWORD_RESET: 'Senha redefinida pelo Admin',
  USERS_MERGED: 'Contas mescladas',
  GAME_CREATED: 'Jogo criado',
  GAME_UPDATED: 'Jogo alterado',
  SCORING_MODEL_CHANGED: 'Modelo de pontuação alterado',
  TOURNAMENT_PUBLISHED: 'Campeonato publicado',
  TOURNAMENT_UPDATED: 'Campeonato alterado',
  TOURNAMENT_STATUS_CHANGED: 'Status do campeonato alterado',
  TOURNAMENT_OWNER_CHANGED: 'Responsável do campeonato trocado',
  TOURNAMENT_FEATURED: 'Destaque na home alterado',
  STAFF_CHANGED: 'Equipe do evento alterada',
  BRACKET_GENERATED: 'Chave gerada',
  BRACKET_CONFIRMED: 'Chave confirmada',
  BRACKET_SEEDING_CHANGED: 'Chave ajustada manualmente',
  BRACKET_UNLOCKED: 'Chave destravada',
  STAGE_ADVANCED: 'Fase avançada',
  STAGE_SCORING_CHANGED: 'Pontuação da fase alterada',
  MATCH_SCHEDULED: 'Partida agendada',
  RESULT_ENTERED: 'Resultado lançado',
  RESULT_CORRECTED: 'Resultado corrigido',
  WALKOVER_APPLIED: 'W.O. aplicado',
  REGISTRATION_REVIEWED: 'Inscrição analisada',
  ENTRANT_WITHDRAWN: 'Desistência registrada',
  ENTRANT_DISQUALIFIED: 'Participante desclassificado',
  DISPUTE_RESOLVED: 'Disputa resolvida',
  DISPUTE_ESCALATED: 'Disputa escalada para a administração',
  SUBMISSION_REJECTED: 'Resultado enviado recusado',
  REPORT_HANDLED: 'Denúncia tratada',
  SETTINGS_CHANGED: 'Configurações alteradas',
  FLAG_CHANGED: 'Recurso ligado ou desligado',
  ANNOUNCEMENT_SENT: 'Comunicado enviado',
  ANNOUNCEMENT_DELETED: 'Comunicado apagado',
  ANNOUNCEMENT_TOGGLED: 'Comunicado ativado ou desativado',
  ADMIN_REMOVAL_REQUESTED: 'Remoção de administrador solicitada',
  ADMIN_REMOVAL_REVIEWED: 'Pedido de remoção de administrador analisado',
  TWO_FACTOR_CHANGED: 'Verificação em duas etapas alterada',
} as const satisfies Record<string, string>;
export type AuditAction = keyof typeof AUDIT_ACTIONS;
export const AuditActionSchema = z.enum(Object.keys(AUDIT_ACTIONS) as [AuditAction, ...AuditAction[]]);
/** Nome da ação para a tela; ação fora do catálogo (registro antigo) aparece com o código. */
export function auditActionLabel(action: string): string {
  return (AUDIT_ACTIONS as Record<string, string>)[action] ?? action;
}
export const AuditLog = z.object({
  id: Id,
  actorId: Id.nullable(),
  actorNickname: z.string(),
  action: z.string(),
  actionLabel: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  entityLabel: z.string(),
  tournamentId: Id.nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  reason: z.string().nullable(),
  ip: z.string(),
  createdAt: IsoDateTime,
});
export type AuditLog = z.infer<typeof AuditLog>;

// ── Dashboard ────────────────────────────────────────────────────────
export const AdminStats = z.object({
  activeUsers: z.number().int(),
  totalUsers: z.number().int(),
  activeTournaments: z.number().int(),
  finishedTournaments: z.number().int(),
  matchesThisWeek: z.number().int(),
  /** North Star: partidas concluídas com resultado validado na semana. */
  validatedMatchesThisWeek: z.number().int(),
  openDisputes: z.number().int(),
  openReports: z.number().int(),
  pendingOrganizerRequests: z.number().int(),
  signups: z.array(z.object({ date: z.iso.date(), count: z.number().int() })),
  validatedMatches: z.array(z.object({ date: z.iso.date(), count: z.number().int() })),
  tournamentsByGame: z.array(z.object({ gameName: z.string(), count: z.number().int() })),
  walkoverRate: z.number(),
  disputeRate: z.number(),
});
export type AdminStats = z.infer<typeof AdminStats>;

export const AdminTournament = z.object({
  id: Id,
  slug: z.string(),
  name: z.string(),
  gameName: z.string(),
  status: TournamentStatus,
  ownerId: Id,
  ownerNickname: z.string(),
  featured: z.boolean(),
  takenSlots: z.number().int(),
  maxParticipants: z.number().int(),
  startsAt: IsoDateTime.nullable(),
  hasOwner: z.boolean(),
});
export type AdminTournament = z.infer<typeof AdminTournament>;
export const ChangeOwnerInput = z.object({ ownerId: Id, reason: z.string().min(5, 'Informe o motivo') });

// ── Configurações, flags e saúde ─────────────────────────────────────
export const SiteSettings = z.object({
  siteName: z.string().min(1).max(40),
  logoUrl: z.string().nullable(),
  homeBanners: z.array(z.object({ id: Id, title: z.string(), link: z.string(), imageUrl: z.string().nullable() })),
  termsHtml: z.string(),
  privacyHtml: z.string(),
  supportEmail: z.email(),
  minAge: z.number().int().min(13).max(21),
  requireApprovalForSeniorAdminRemoval: z.boolean(),
});
export type SiteSettings = z.infer<typeof SiteSettings>;

export const FeatureFlag = z.object({ key: z.string(), label: z.string(), description: z.string(), enabled: z.boolean() });
export type FeatureFlag = z.infer<typeof FeatureFlag>;
export const FeatureFlags = z.record(z.string(), z.boolean());

export const SystemHealth = z.object({
  version: z.string(),
  environment: z.string(),
  checkedAt: IsoDateTime,
  errorRate: z.number(),
  services: z.array(z.object({ key: z.string(), name: z.string(), status: z.enum(['ok', 'degraded', 'down']), detail: z.string(), latencyMs: z.number().nullable() })),
  failedJobs: z.number().int(),
  storageUsedMb: z.number(),
});
export type SystemHealth = z.infer<typeof SystemHealth>;

/**
 * `GET /health` (público, sem dados sensíveis): estado de cada dependência da API real.
 * `not_configured` = a variável do serviço ainda não existe naquele ambiente.
 */
export const HealthServiceStatus = z.enum(['ok', 'down', 'not_configured']);
export const ApiHealth = z.object({
  /** `ok`: tudo no ar · `degraded`: algum serviço sem configuração · `down`: algum serviço fora. */
  status: z.enum(['ok', 'degraded', 'down']),
  version: z.string(),
  environment: z.string(),
  checkedAt: IsoDateTime,
  services: z.array(z.object({ key: z.enum(['database', 'redis', 'qstash']), name: z.string(), status: HealthServiceStatus, latencyMs: z.number().nullable(), detail: z.string() })),
});
export type ApiHealth = z.infer<typeof ApiHealth>;

export const GlobalAnnouncement = z.object({
  id: Id,
  title: z.string(),
  body: z.string(),
  kind: z.enum(['BANNER', 'NOTIFICATION', 'MAINTENANCE']),
  audience: z.enum(['ALL', 'ORGANIZERS', 'GAME']),
  gameId: Id.nullable(),
  /** Para avisos de manutenção: início da janela. */
  startsAt: IsoDateTime.nullable(),
  endsAt: IsoDateTime.nullable(),
  active: z.boolean(),
  authorNickname: z.string(),
  createdAt: IsoDateTime,
});
export type GlobalAnnouncement = z.infer<typeof GlobalAnnouncement>;
export const GlobalAnnouncementInput = GlobalAnnouncement.pick({ title: true, body: true, kind: true, audience: true, gameId: true, startsAt: true, endsAt: true }).extend({
  title: z.string().min(3, 'Dê um título').max(80),
  body: z.string().min(3, 'Escreva a mensagem').max(500),
});
export type GlobalAnnouncementInput = z.infer<typeof GlobalAnnouncementInput>;

// ── 2FA ──────────────────────────────────────────────────────────────
export const TwoFactorSetup = z.object({ secret: z.string(), otpauthUrl: z.string(), qrSvg: z.string() });
export const TwoFactorEnableInput = z.object({ code: z.string().regex(/^\d{6}$/, 'O código tem 6 dígitos') });
export const TwoFactorEnabled = z.object({ recoveryCodes: z.array(z.string()) });

// ── Acréscimos do painel do Administrador (F2.8) ─────────────────────
/** Admin na lista de administradores: desde quando tem o papel (base da RN-11). */
export const AdminMember = AdminUser.extend({ adminSince: IsoDateTime, isSuperAdmin: z.boolean() });
export type AdminMember = z.infer<typeof AdminMember>;

/** Pedido para remover um Admin mais antigo, à espera do Super Admin (RN-11). */
export const AdminRemovalRequest = z.object({
  id: Id,
  targetUserId: Id,
  targetNickname: z.string(),
  requestedById: Id,
  requestedByNickname: z.string(),
  reason: z.string().nullable(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  createdAt: IsoDateTime,
  reviewedAt: IsoDateTime.nullable(),
  reviewedByNickname: z.string().nullable(),
});
export type AdminRemovalRequest = z.infer<typeof AdminRemovalRequest>;

export const RoleRevokeInput = z.object({ reason: z.string().max(500).optional() });
/** Campeonato afetado pela saída do organizador (RN-09). */
export const OrphanOutcome = z.object({ id: Id, name: z.string(), outcome: z.enum(['TRANSFERRED', 'PAUSED']), newOwnerNickname: z.string().nullable() });
export type OrphanOutcome = z.infer<typeof OrphanOutcome>;
export const RoleRevokeResult = z.object({
  /** `PENDING_APPROVAL`: o papel continua até o Super Admin aprovar (RN-11). */
  outcome: z.enum(['REVOKED', 'PENDING_APPROVAL']),
  requestId: Id.nullable(),
  affectedTournaments: z.array(OrphanOutcome),
});
export type RoleRevokeResult = z.infer<typeof RoleRevokeResult>;

export const AdminOrganizer = AdminUser.extend({
  organizerLimits: z.object({ maxActiveTournaments: z.number().int(), allowedGameIds: z.array(Id) }),
  activeTournaments: z.number().int(),
  totalTournaments: z.number().int(),
});
export type AdminOrganizer = z.infer<typeof AdminOrganizer>;

/** No protótipo o link de redefinição volta na resposta; a API real envia por e-mail. */
export const PasswordResetLink = z.object({ link: z.string() });
export const MergeUsersResult = z.object({
  target: AdminUserDetail,
  moved: z.object({ registrations: z.number().int(), teams: z.number().int(), gameAccounts: z.number().int() }),
});
export type MergeUsersResult = z.infer<typeof MergeUsersResult>;
export const SanctionResult = z.object({ sanction: Sanction, user: AdminUserDetail, affectedTournaments: z.array(OrphanOutcome) });
export type SanctionResult = z.infer<typeof SanctionResult>;

/** Denúncia na fila do Admin: além do contrato público, quem responde pelo alvo (para as ações rápidas). */
export const AdminReport = Report.extend({
  reporterId: Id.nullable(),
  targetUserId: Id.nullable(),
  targetUserNickname: z.string().nullable(),
  targetUserStatus: UserStatus.nullable(),
});
export type AdminReport = z.infer<typeof AdminReport>;

export const AdminTournamentPatch = z.object({ featured: z.boolean() });
export const AdminCancelTournamentInput = z.object({ reason: z.string().trim().min(5, 'Informe o motivo do cancelamento').max(500) });
/** Fase com a chave travada (já tem partida concluída). Só o Admin destrava (RN-07). */
export const LockedStage = z.object({ stageId: Id, stageName: z.string(), tournamentId: Id, tournamentName: z.string(), completedMatches: z.number().int() });
export type LockedStage = z.infer<typeof LockedStage>;

export const GlobalAnnouncementPatch = z.object({ active: z.boolean() });
/** O que o site mostra no topo: banner ou aviso de manutenção ativo. */
export const SiteBannerItem = z.object({
  id: Id,
  kind: z.enum(['BANNER', 'MAINTENANCE']),
  title: z.string(),
  body: z.string(),
  startsAt: IsoDateTime.nullable(),
  endsAt: IsoDateTime.nullable(),
  /** Manutenção em curso: o aviso não pode ser dispensado. */
  ongoing: z.boolean(),
  dismissible: z.boolean(),
});
export type SiteBannerItem = z.infer<typeof SiteBannerItem>;

/** Parte das configurações que o site público lê. */
export const PublicSiteSettings = SiteSettings.omit({ requireApprovalForSeniorAdminRemoval: true });
export type PublicSiteSettings = z.infer<typeof PublicSiteSettings>;

export const FEATURE_FLAG_DEFAULTS = { ranking: true, publicSignup: true, resultSubmission: true, pushNotifications: false } as const;
export type FeatureFlagKey = keyof typeof FEATURE_FLAG_DEFAULTS;
export const FeatureFlagInput = z.object({ enabled: z.boolean() });

export const AuditMeta = z.object({ actions: z.array(z.object({ value: z.string(), label: z.string() })), entityTypes: z.array(z.string()) });
export type AuditMeta = z.infer<typeof AuditMeta>;

export const TwoFactorStatus = z.object({
  enabled: z.boolean(),
  /** Obrigatória para Admin e Super Admin (RNF-08): não pode ser desligada. */
  required: z.boolean(),
  recoveryCodesLeft: z.number().int(),
});
export type TwoFactorStatus = z.infer<typeof TwoFactorStatus>;
/** Para desligar: código do aplicativo (6 dígitos) ou um código de recuperação. */
export const TwoFactorDisableInput = z.object({ code: z.string().trim().min(6, 'Informe o código').max(20) });
/** Só no protótipo: o código atual, para a demonstração funcionar sem aplicativo autenticador. */
export const TwoFactorDevCode = z.object({ code: z.string(), expiresInSeconds: z.number().int() });
export const TwoFactorResetInput = z.object({ reason: z.string().trim().min(5, 'Informe o motivo').max(500) });
