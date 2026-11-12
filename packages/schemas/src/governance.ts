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
