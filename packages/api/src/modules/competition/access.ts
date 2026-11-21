/**
 * Utilidades de acesso compartilhadas pelas rotas de competição (resultados, fases, envios e disputas).
 */
import type { AuditContext } from '@nova/db';
import type { AppContext } from '../../context';
import { currentRoles, isAdmin, tournamentAccessDecision, type TournamentAccess, type TournamentAccessLevel } from '../../auth/rbac';
import { currentSession, requireSession } from '../../auth/session';
import { clientIp } from '../../security';

export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Contexto de auditoria de quem fez a requisição (exige sessão). */
export async function auditCtx(c: AppContext, reason?: string | null): Promise<AuditContext & { actorId: string }> {
  const session = await requireSession(c);
  return { actorId: session.userId, ip: clientIp(c.req.raw.headers), userAgent: c.req.header('user-agent') ?? null, reason: reason ?? null };
}

/**
 * Como a pessoa da requisição chega ao campeonato (dona, staff ou Admin), sem lançar: `null` para visitante ou
 * quem não é da organização. `moderate` inclui o moderador do evento.
 */
export async function staffVia(c: AppContext, t: { id: string; ownerId: string }, level: TournamentAccessLevel = 'moderate'): Promise<TournamentAccess['via'] | null> {
  const session = await currentSession(c);
  if (!session) return null;
  const staff = await c.get('deps').db().tournamentStaff.findUnique({ where: { tournamentId_userId: { tournamentId: t.id, userId: session.userId } }, select: { role: true } });
  return tournamentAccessDecision({ userId: session.userId, roles: await currentRoles(c), ownerId: t.ownerId, staffRole: staff?.role ?? null, level });
}

/** Admin ou Super Admin da plataforma (exige sessão). */
export async function isPlatformAdmin(c: AppContext): Promise<boolean> {
  return isAdmin(await currentRoles(c));
}
