/**
 * Papéis e permissões (issue #70, PRD §6). **A checagem que vale é esta, na API**: o `proxy.ts` do Next só
 * redireciona e o front só esconde botões.
 *
 * - Papel global (`requireRole`): lido do banco a cada requisição (o JWT carrega os papéis só para a borda).
 * - Acesso ao campeonato (`requireTournamentAccess`): dono e staff do campeonato; Admin e Super Admin
 *   passam sempre (matriz: ✅ para eles).
 * - Regras da matriz que não cabem num middleware ficam como funções puras (`roleChangeDecision`,
 *   `registrationBlock`), testadas sem banco.
 */
import type { Role, StaffRole } from '@nova/db';
import type { MiddlewareHandler } from 'hono';
import type { AppContext, AppEnv } from '../context';
import { forbidden, HttpProblem, notFound } from '../errors';
import { requireSession } from './session';

export const ADMIN_ROLES: readonly Role[] = ['SUPER_ADMIN', 'ADMIN'];
export const ORGANIZER_AREA_ROLES: readonly Role[] = ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'];

export const isAdmin = (roles: readonly Role[]) => roles.some((r) => ADMIN_ROLES.includes(r));

/** Papéis globais de quem fez a requisição (uma consulta por requisição). */
export async function currentRoles(c: AppContext): Promise<Role[]> {
  const cached = c.get('roles');
  if (cached) return cached;
  const session = await requireSession(c);
  const rows = await c.get('deps').db().userRole.findMany({ where: { userId: session.userId }, select: { role: true } });
  const roles = rows.map((r) => r.role);
  c.set('roles', roles);
  return roles;
}

/** Exige login e pelo menos um dos papéis. Sem sessão → 401; sem o papel → 403. */
export async function assertRole(c: AppContext, roles: readonly Role[]): Promise<Role[]> {
  const mine = await currentRoles(c);
  if (!mine.some((r) => roles.includes(r))) throw forbidden();
  return mine;
}

export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await assertRole(c, roles);
    await next();
  };
}

/**
 * Níveis de acesso ao campeonato, da matriz:
 * - `manage`: editar/cancelar, chaveamento, desclassificar, ver a auditoria do campeonato → dono e co-organizador;
 * - `moderate`: lançar/validar resultados, gerenciar inscrições → também o moderador do evento.
 */
export type TournamentAccessLevel = 'manage' | 'moderate';

export interface TournamentAccess {
  tournamentId: string;
  ownerId: string;
  /** Como a pessoa chegou aqui: dona, staff (com a função) ou Admin da plataforma. */
  via: 'admin' | 'owner' | StaffRole;
}

const STAFF_ALLOWED: Record<TournamentAccessLevel, readonly StaffRole[]> = {
  manage: ['CO_ORGANIZER'],
  moderate: ['CO_ORGANIZER', 'MODERATOR'],
};

/** Decide o acesso sem banco (testável): Admin passa; dono passa; staff conforme o nível. */
export function tournamentAccessDecision(input: { userId: string; roles: readonly Role[]; ownerId: string; staffRole: StaffRole | null; level: TournamentAccessLevel }): TournamentAccess['via'] | null {
  if (isAdmin(input.roles)) return 'admin';
  if (input.ownerId === input.userId) return 'owner';
  if (input.staffRole && STAFF_ALLOWED[input.level].includes(input.staffRole)) return input.staffRole;
  return null;
}

/** Carrega o campeonato pelo id ou slug e confere o acesso. Campeonato inexistente → 404; sem acesso → 403. */
export async function assertTournamentAccess(c: AppContext, idOrSlug: string, level: TournamentAccessLevel): Promise<TournamentAccess> {
  const session = await requireSession(c);
  const roles = await currentRoles(c);
  const db = c.get('deps').db();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const tournament = await db.tournament.findUnique({
    where: isUuid ? { id: idOrSlug } : { slug: idOrSlug },
    select: { id: true, ownerId: true, staff: { where: { userId: session.userId }, select: { role: true } } },
  });
  if (!tournament) throw notFound('Campeonato');
  const via = tournamentAccessDecision({ userId: session.userId, roles, ownerId: tournament.ownerId, staffRole: tournament.staff[0]?.role ?? null, level });
  if (!via) throw forbidden('Você não faz parte da organização deste campeonato.', 'NOT_TOURNAMENT_STAFF');
  const access: TournamentAccess = { tournamentId: tournament.id, ownerId: tournament.ownerId, via };
  c.set('tournamentAccess', access);
  return access;
}

/** Middleware para rotas `/…/:tournamentId/…` (ou outro parâmetro com id ou slug). */
export function requireTournamentAccess(level: TournamentAccessLevel, param = 'tournamentId'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const value = c.req.param(param);
    if (!value) throw notFound('Campeonato');
    await assertTournamentAccess(c, value, level);
    await next();
  };
}

/**
 * Promover/revogar papéis (matriz + nota ¹):
 * - Super Admin: só outro Super Admin dá ou tira;
 * - Admin: Admin ou Super Admin; um Admin **não remove** Super Admin nem Admin com mais tempo de casa
 *   (isso fica para o Super Admin aprovar);
 * - Organizador: Admin ou Super Admin;
 * - Participante: papel base, não sai pela gestão de papéis.
 */
export interface RoleChange {
  actor: { id: string; roles: readonly Role[]; adminSince?: Date | null };
  target: { id: string; roles: readonly Role[]; adminSince?: Date | null };
  role: Role;
  action: 'grant' | 'revoke';
}

export function roleChangeDecision({ actor, target, role, action }: RoleChange): { ok: true } | { ok: false; code: string; title: string } {
  const deny = (code: string, title: string) => ({ ok: false as const, code, title });
  const actorIsSuper = actor.roles.includes('SUPER_ADMIN');
  if (role === 'PARTICIPANT') return deny('ROLE_NOT_MANAGEABLE', 'O papel de participante é de toda conta e não pode ser alterado.');
  if (!isAdmin(actor.roles)) return deny('FORBIDDEN', 'Você não tem permissão para fazer isso.');
  if (role === 'SUPER_ADMIN' && !actorIsSuper) return deny('REQUIRES_SUPER_ADMIN', 'Só um Super Admin pode mudar este papel.');
  if (action === 'revoke' && !actorIsSuper) {
    if (target.roles.includes('SUPER_ADMIN')) return deny('REQUIRES_SUPER_ADMIN', 'Um Admin não pode remover um Super Admin.');
    if (role === 'ADMIN' && target.id !== actor.id && actor.adminSince && target.adminSince && target.adminSince < actor.adminSince) {
      return deny('REQUIRES_SUPER_ADMIN', 'Este Admin está há mais tempo na equipe. A remoção precisa do Super Admin.');
    }
  }
  return { ok: true };
}

export function assertRoleChange(change: RoleChange): void {
  const decision = roleChangeDecision(change);
  if (!decision.ok) throw new HttpProblem(403, decision.title, decision.code);
}

/** Nota ³: quem organiza não se inscreve no próprio campeonato. `null` = pode se inscrever. */
export function registrationBlock(userId: string, tournament: { ownerId: string }): { code: string; title: string } | null {
  if (tournament.ownerId === userId) return { code: 'OWN_TOURNAMENT', title: 'Você organiza este campeonato e não pode se inscrever nele.' };
  return null;
}
