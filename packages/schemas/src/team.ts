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
