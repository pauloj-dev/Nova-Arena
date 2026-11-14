import { z } from 'zod';
import { Id, IsoDateTime } from './common';

export const Role = z.enum(['SUPER_ADMIN', 'ADMIN', 'ORGANIZER', 'PARTICIPANT']);
export type Role = z.infer<typeof Role>;

export const UserStatus = z.enum(['ACTIVE', 'SUSPENDED', 'BANNED', 'MERGED', 'DELETED']);
export type UserStatus = z.infer<typeof UserStatus>;

export const Nickname = z
  .string()
  .min(3, 'O apelido precisa de pelo menos 3 caracteres')
  .max(20, 'O apelido pode ter no máximo 20 caracteres')
  .regex(/^[A-Za-z0-9_.-]+$/, 'Use só letras, números, ponto, hífen e sublinhado');

export const Password = z
  .string()
  .min(8, 'A senha precisa de pelo menos 8 caracteres')
  .max(128)
  .regex(/[A-Za-z]/, 'Inclua pelo menos uma letra')
  .regex(/[0-9]/, 'Inclua pelo menos um número');

export const Socials = z.object({
  discord: z.string().max(60).optional(),
  instagram: z.string().max(60).optional(),
  youtube: z.string().max(120).optional(),
  twitch: z.string().max(60).optional(),
});

/** O que qualquer pessoa pode ver de um usuário. Sem e-mail e sem IDs de jogo (RNF-10). */
export const PublicUser = z.object({
  id: Id,
  nickname: Nickname,
  avatarUrl: z.string().nullable(),
  country: z.string().nullable(),
  state: z.string().nullable(),
  bio: z.string().nullable(),
  socials: Socials,
  roles: z.array(Role),
  verifiedOrganizer: z.boolean(),
  createdAt: IsoDateTime,
});
export type PublicUser = z.infer<typeof PublicUser>;

export const GameAccount = z.object({
  gameId: Id,
  /** Campos exigidos pelo jogo, ex.: `{ playerId: '123456', nick: 'Alfa' }`. */
  fields: z.record(z.string(), z.string()),
  updatedAt: IsoDateTime,
});
export type GameAccount = z.infer<typeof GameAccount>;

/** O próprio usuário (resposta de `/me`). */
export const Me = PublicUser.extend({
  email: z.email(),
  emailVerified: z.boolean(),
  /** Nula enquanto a conta (ex.: só OAuth) não informou a data de nascimento. */
  birthDate: z.iso.date().nullable(),
  timezone: z.string().nullable(),
  status: UserStatus,
  twoFactorEnabled: z.boolean(),
  gameAccounts: z.array(GameAccount),
});
export type Me = z.infer<typeof Me>;

export const MIN_AGE = 16;

function ageOn(birthDate: string, now = new Date()): number {
  const b = new Date(`${birthDate}T00:00:00Z`);
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday = now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export const RegisterInput = z.object({
  email: z.email('Informe um e-mail válido'),
  nickname: Nickname,
  password: Password,
  birthDate: z.iso.date('Informe sua data de nascimento').refine((d) => ageOn(d) >= MIN_AGE, `É preciso ter pelo menos ${MIN_AGE} anos para se cadastrar`),
  acceptTerms: z.literal(true, 'É preciso aceitar os Termos de Uso e a Política de Privacidade'),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: z.email('Informe um e-mail válido'),
  password: z.string().min(1, 'Informe a senha'),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const VerifyEmailInput = z.object({ token: z.string().min(1) });
export const ForgotPasswordInput = z.object({ email: z.email('Informe um e-mail válido') });
export const ResetPasswordInput = z.object({ token: z.string().min(1), password: Password });

export const UpdateMeInput = z.object({
  nickname: Nickname.optional(),
  avatarUrl: z.string().nullable().optional(),
  country: z.string().max(60).nullable().optional(),
  state: z.string().max(60).nullable().optional(),
  bio: z.string().max(280, 'A bio pode ter no máximo 280 caracteres').nullable().optional(),
  socials: Socials.optional(),
  timezone: z.string().nullable().optional(),
});
export type UpdateMeInput = z.infer<typeof UpdateMeInput>;

export const UpsertGameAccountInput = z.object({ fields: z.record(z.string(), z.string().min(1, 'Preencha este campo')) });

export const RequestStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export const OrganizerRequest = z.object({
  id: Id,
  userId: Id,
  justification: z.string(),
  status: RequestStatus,
  reviewReason: z.string().nullable(),
  createdAt: IsoDateTime,
  reviewedAt: IsoDateTime.nullable(),
});
export type OrganizerRequest = z.infer<typeof OrganizerRequest>;
export const OrganizerRequestInput = z.object({
  justification: z.string().min(30, 'Conte um pouco mais (pelo menos 30 caracteres)').max(1000),
});

/** Convite para virar Admin ou Organizador (PRD §7.3). */
export const RoleInvitePreview = z.object({
  role: z.enum(['ADMIN', 'ORGANIZER']),
  state: z.enum(['VALID', 'EXPIRED', 'REVOKED', 'EXHAUSTED']),
  invitedBy: z.string(),
  expiresAt: IsoDateTime,
});
export type RoleInvitePreview = z.infer<typeof RoleInvitePreview>;

// ── Respostas de autenticação (F1.4) ─────────────────────────────────
/** No protótipo, o "e-mail" de verificação volta na resposta (`devVerifyToken`). A API real não devolve esse campo. */
export const RegisterResponse = z.object({ user: Me, devVerifyToken: z.string().nullable().optional() });
export type RegisterResponse = z.infer<typeof RegisterResponse>;
export const ResendVerificationResponse = z.object({ ok: z.literal(true), devVerifyToken: z.string().nullable().optional() });
export type ResendVerificationResponse = z.infer<typeof ResendVerificationResponse>;
/** Sempre 200, exista ou não a conta. `devResetToken` só no protótipo. */
export const ForgotPasswordResponse = z.object({ ok: z.literal(true), devResetToken: z.string().nullable().optional() });
export type ForgotPasswordResponse = z.infer<typeof ForgotPasswordResponse>;

/** Resposta de `POST /role-invites/:token/accept`: o papel concedido e a conta já atualizada. */
export const AcceptRoleInviteResponse = z.object({ role: z.enum(['ADMIN', 'ORGANIZER']), user: Me });
export type AcceptRoleInviteResponse = z.infer<typeof AcceptRoleInviteResponse>;

// ── Seguir campeonato ou jogo (RN-15) ────────────────────────────────
export const FollowTargetType = z.enum(['tournament', 'game']);
export type FollowTargetType = z.infer<typeof FollowTargetType>;
/** Tudo o que a pessoa segue: ids de campeonatos e de jogos. */
export const FollowList = z.object({ tournaments: z.array(Id), games: z.array(Id) });
export type FollowList = z.infer<typeof FollowList>;
