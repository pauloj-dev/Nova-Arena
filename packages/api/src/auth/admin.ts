/**
 * Acesso à área de administração (RNF-08, decisões do `docs/prompt-continuidade.md` §6). Porta de `adminOnly()` e
 * `superAdminOnly()` de `apps/web/mocks/handlers/admin-settings.ts`.
 *
 * - Toda rota `/admin/*` exige Admin ou Super Admin **com 2FA ativo e feito nesta sessão** (`twoFactorVerified` na
 *   sessão e a configuração ativa em `two_factor`). Sem isso: 403 `TWO_FACTOR_REQUIRED`. O app aplica `adminArea` em
 *   `/admin/*` antes de qualquer módulo, então vale também para rotas `/admin/*` de outros módulos (jogos, jobs).
 * - Só o Super Admin altera configurações e flags e aprova remoção de Admin (`superAdmin: true`).
 * - Papéis vêm do banco a cada requisição (`currentRoles`); o JWT só serve à borda.
 *
 * `requireAdminTwoFactor` tem o mesmo nome, assinatura e comportamento do helper da frente de 2FA (#95,
 * `auth/two-factor.ts`): na junção fica uma implementação só. A configuração do 2FA em si é daquela frente.
 */
import type { Role } from '@nova/db';
import type { MiddlewareHandler } from 'hono';
import type { AppContext, AppEnv } from '../context';
import { forbidden, HttpProblem } from '../errors';
import { clientIp } from '../security';
import { currentRoles, isAdmin } from './rbac';
import { requireSession } from './session';

export interface AdminActor {
  id: string;
  roles: Role[];
  isSuperAdmin: boolean;
}

/** 2FA ativo na conta (configuração confirmada com um código). */
async function twoFactorEnabled(c: AppContext, userId: string): Promise<boolean> {
  const row = await c.get('deps').db().twoFactor.findUnique({ where: { userId }, select: { enabledAt: true } });
  return Boolean(row?.enabledAt);
}

/**
 * Admin ou Super Admin **com 2FA ativo e feito nesta sessão**. Visitante → 401; sem o papel → 403 `FORBIDDEN`; sem
 * 2FA → 403 `TWO_FACTOR_REQUIRED`; `superAdmin: true` exige também o papel de Super Admin.
 */
export async function requireAdminTwoFactor(c: AppContext, opts: { superAdmin?: boolean } = {}): Promise<{ userId: string; roles: Role[] }> {
  const session = await requireSession(c);
  const roles = await currentRoles(c);
  if (!isAdmin(roles)) throw forbidden();
  if (!session.twoFactorVerified || !(await twoFactorEnabled(c, session.userId))) {
    throw new HttpProblem(403, 'Ative a verificação em duas etapas para usar a área de administração.', 'TWO_FACTOR_REQUIRED');
  }
  if (opts.superAdmin && !roles.includes('SUPER_ADMIN')) throw forbidden('Só o Super Admin pode fazer isso.');
  return { userId: session.userId, roles };
}

const toActor = ({ userId, roles }: { userId: string; roles: Role[] }): AdminActor => ({ id: userId, roles, isSuperAdmin: roles.includes('SUPER_ADMIN') });

/** Atalho dos módulos `admin-*`: o mesmo `requireAdminTwoFactor`, devolvendo quem age. */
export async function requireAdmin(c: AppContext): Promise<AdminActor> {
  return toActor(await requireAdminTwoFactor(c));
}

/** Só o Super Admin (configurações globais, flags, aprovar remoção de Admin). */
export async function requireSuperAdmin(c: AppContext): Promise<AdminActor> {
  return toActor(await requireAdminTwoFactor(c, { superAdmin: true }));
}

/** Middleware de `/admin/*`: registrado no app antes dos módulos. */
export const adminArea: MiddlewareHandler<AppEnv> = async (c, next) => {
  await requireAdminTwoFactor(c);
  await next();
};

/** Contexto de auditoria da requisição (quem, IP, navegador e motivo). */
export async function auditContext(c: AppContext, reason?: string | null) {
  const session = await requireSession(c);
  return { actorId: session.userId, ip: clientIp(c.req.raw.headers), userAgent: c.req.header('user-agent') ?? null, reason: reason ?? null };
}
