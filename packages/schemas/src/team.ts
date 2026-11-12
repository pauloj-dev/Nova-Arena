import { z } from 'zod';
import { Id, IsoDateTime } from './common';

export const InviteStatus = z.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED']);
export type InviteStatus = z.infer<typeof InviteStatus>;

export const TeamMember = z.object({
  userId: Id,
  nickname: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(['CAPTAIN', 'MEMBER']),
  isSub: z.boolean(),
  joinedAt: IsoDateTime,
});
export type TeamMember = z.infer<typeof TeamMember>;

export const TeamInvite = z.object({
  id: Id,
  teamId: Id,
  teamName: z.string(),
  teamTag: z.string(),
  /** Preenchido no convite por nick; nulo no convite por link ou código. */
  invitedUserId: Id.nullable(),
  invitedNickname: z.string().nullable(),
  /** Código de 6 caracteres (também é o final do link). */
  code: z.string().length(6),
  status: InviteStatus,
  invitedByNickname: z.string(),
  expiresAt: IsoDateTime,
  createdAt: IsoDateTime,
});
export type TeamInvite = z.infer<typeof TeamInvite>;

export const Team = z.object({
  id: Id,
  name: z.string().min(2, 'O nome precisa de pelo menos 2 caracteres').max(30),
  tag: z
    .string()
    .min(2, 'A tag precisa de 2 a 5 caracteres')
    .max(5, 'A tag precisa de 2 a 5 caracteres')
    .regex(/^[A-Za-z0-9]+$/, 'Use só letras e números'),
  logoUrl: z.string().nullable(),
  captainId: Id,
  members: z.array(TeamMember),
  pendingInvites: z.array(TeamInvite),
  createdAt: IsoDateTime,
});
export type Team = z.infer<typeof Team>;

export const TeamInput = Team.pick({ name: true, tag: true }).extend({ logoUrl: z.string().nullable().optional() });
export type TeamInput = z.infer<typeof TeamInput>;

export const TeamInviteInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('nickname'), nickname: z.string().min(1, 'Informe o apelido') }),
  z.object({ kind: z.literal('link') }),
]);
export type TeamInviteInput = z.infer<typeof TeamInviteInput>;

export const TransferCaptainInput = z.object({ userId: Id });
export const UpdateMemberInput = z.object({ isSub: z.boolean() });

// ── Acréscimos da F1.9 (squads e convites) ───────────────────────────

/** Máximo de pessoas num squad: o maior modo possível (10 titulares) + o máximo de reservas (5). */
export const MAX_TEAM_MEMBERS = 15;
/** Validade do convite de squad (PRD §12.1). */
export const TEAM_INVITE_TTL_HOURS = 72;
/** Tamanho máximo do arquivo de logo (o upload real, em B1, vai para o Vercel Blob). */
export const TEAM_LOGO_MAX_BYTES = 5 * 1024 * 1024;

/** Edição do squad: só os campos enviados mudam. */
export const TeamUpdateInput = TeamInput.partial();
export type TeamUpdateInput = z.infer<typeof TeamUpdateInput>;

export type TransferCaptainInput = z.infer<typeof TransferCaptainInput>;
export type UpdateMemberInput = z.infer<typeof UpdateMemberInput>;

/** Resultado da busca de jogador por apelido para convidar. Só o que é público. */
export const InviteCandidate = z.object({ id: Id, nickname: z.string(), avatarUrl: z.string().nullable() });
export type InviteCandidate = z.infer<typeof InviteCandidate>;

export const TeamInviteState = z.enum(['VALID', 'EXPIRED', 'REVOKED', 'ACCEPTED', 'DECLINED']);
export type TeamInviteState = z.infer<typeof TeamInviteState>;

/** Prévia pública do convite (`/squads/convite/[code]`): o suficiente para a pessoa decidir se entra. */
export const TeamInvitePreview = z.object({
  code: z.string().length(6),
  state: TeamInviteState,
  team: z.object({ id: Id, name: z.string(), tag: z.string(), logoUrl: z.string().nullable(), memberCount: z.number().int() }),
  invitedByNickname: z.string(),
  /** Preenchido quando o convite foi feito por apelido (só vale para essa pessoa). */
  invitedNickname: z.string().nullable(),
  expiresAt: IsoDateTime,
  /** Quem está vendo já faz parte do squad. Sempre falso para visitante. */
  viewerIsMember: z.boolean(),
  /** O convite é dirigido a outra pessoa. Sempre falso para visitante. */
  viewerIsNotInvitee: z.boolean(),
});
export type TeamInvitePreview = z.infer<typeof TeamInvitePreview>;
