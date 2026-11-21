/**
 * Acesso à área de administração (RNF-08, decisões do `docs/prompt-continuidade.md` §6). Porta de `adminOnly()` e
 * `superAdminOnly()` de `apps/web/mocks/handlers/admin-settings.ts`.
 *
 * - Toda rota `/admin/*` exige Admin ou Super Admin **com a verificação em duas etapas feita nesta sessão**
 *   (`twoFactorVerified`). Sem ela: 403 `TWO_FACTOR_REQUIRED`. O app aplica `adminArea` em `/admin/*` antes de
 *   qualquer módulo, então vale também para rotas `/admin/*` de outros módulos (jogos, falhas de jobs).
 * - Só o Super Admin altera configurações e flags, aprova remoção de Admin e age sobre a conta de outro Admin.
 * - Papéis vêm do banco a cada requisição (`currentRoles`); o JWT só serve à borda.
 *
 * A configuração do 2FA (ativar, login com código) é de outra frente (#95): aqui só se lê o resultado na sessão.
 */
import type { Role } from '@nova/db';
import type { MiddlewareHandler } from 'hono';
import type { AppContext, AppEnv } from '../context';
import { forbidden, HttpProblem } from '../errors';
import { clientIp } from '../security';
import { ADMIN_ROLES, currentRoles } from './rbac';
import { requireSession } from './session';

export interface AdminActor {
  id: string;
  roles: Role[];
  isSuperAdmin: boolean;
}

export const TWO_FACTOR_REQUIRED_TITLE = 'Ative a verificação em duas etapas para usar a área de administração.';

/** Admin ou Super Admin com 2FA feito. Visitante → 401; sem o papel → 403; sem 2FA → 403 `TWO_FACTOR_REQUIRED`. */
export async function requireAdmin(c: AppContext): Promise<AdminActor> {
  const session = await requireSession(c);
  const roles = await currentRoles(c);
  if (!roles.some((r) => ADMIN_ROLES.includes(r))) throw forbidden();
  if (!session.twoFactorVerified) throw new HttpProblem(403, TWO_FACTOR_REQUIRED_TITLE, 'TWO_FACTOR_REQUIRED');
  return { id: session.userId, roles, isSuperAdmin: roles.includes('SUPER_ADMIN') };
}

/** Só o Super Admin (configurações globais, flags, aprovar remoção de Admin). */
export async function requireSuperAdmin(c: AppContext): Promise<AdminActor> {
  const actor = await requireAdmin(c);
  if (!actor.isSuperAdmin) throw forbidden('Só o Super Admin pode fazer isso.');
  return actor;
}

/** Middleware de `/admin/*`: registrado no app antes dos módulos. */
export const adminArea: MiddlewareHandler<AppEnv> = async (c, next) => {
  await requireAdmin(c);
  await next();
};

/** Contexto de auditoria da requisição (quem, IP, navegador e motivo). */
export async function auditContext(c: AppContext, reason?: string | null) {
  const session = await requireSession(c);
  return { actorId: session.userId, ip: clientIp(c.req.raw.headers), userAgent: c.req.header('user-agent') ?? null, reason: reason ?? null };
}
