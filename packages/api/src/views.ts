/**
 * Conversão dos registros do banco para os contratos de `@nova/schemas` (o equivalente de
 * `apps/web/mocks/views.ts`). Toda resposta passa por aqui e por `respond()`.
 */
import type { Prisma, PrismaClient } from '@nova/db';
import type { Me } from '@nova/schemas';

/** O que `toMe` precisa carregar junto com o usuário. */
export const meInclude = {
  roles: true,
  organizerLimits: { select: { verified: true } },
  twoFactor: { select: { enabledAt: true } },
  gameAccounts: true,
} satisfies Prisma.UserInclude;

export type UserForMe = Prisma.UserGetPayload<{ include: typeof meInclude }>;

const ROLE_ORDER = ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER', 'PARTICIPANT'] as const;

export function toMe(u: UserForMe): Me {
  return {
    id: u.id,
    nickname: u.nickname,
    avatarUrl: u.avatarUrl,
    country: u.country,
    state: u.state,
    bio: u.bio,
    socials: (u.socials ?? {}) as Me['socials'],
    roles: ROLE_ORDER.filter((r) => u.roles.some((x) => x.role === r)),
    verifiedOrganizer: u.organizerLimits?.verified ?? false,
    createdAt: u.createdAt.toISOString(),
    email: u.email,
    emailVerified: u.emailVerified,
    birthDate: u.birthDate ? u.birthDate.toISOString().slice(0, 10) : null,
    timezone: u.timezone,
    status: u.status,
    twoFactorEnabled: Boolean(u.twoFactor?.enabledAt),
    gameAccounts: u.gameAccounts.map((g) => ({ gameId: g.gameId, fields: g.fields as Record<string, string>, updatedAt: g.updatedAt.toISOString() })),
  };
}

export async function loadMe(db: PrismaClient, userId: string): Promise<Me> {
  return toMe(await db.user.findUniqueOrThrow({ where: { id: userId }, include: meInclude }));
}
