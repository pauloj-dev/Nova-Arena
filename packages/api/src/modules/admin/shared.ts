/**
 * Peças comuns aos módulos do painel Admin (#91–#96): conversões para os contratos, quem pode agir sobre quem,
 * paginação numerada e os efeitos que só acontecem **depois do commit** (notificação e tempo real).
 */
import type { Prisma, PrismaClient, Role, SanctionType, Tx } from '@nova/db';
import { ACTIVE_TOURNAMENT_STATUSES, type AdminUser, type AdminUserDetail, type RealtimeChannel, type RealtimeEvent, type Sanction } from '@nova/schemas';
import type { AppContext } from '../../context';
import { conflict, forbidden, notFound } from '../../errors';
import { notify, publish, type NotificationInput } from '../../notify';
import type { AdminActor } from '../../auth/admin';

export type Db = PrismaClient | Tx;

export const DAY_MS = 24 * 3600_000;
export const PAGE_SIZE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Colunas `uuid` não aceitam texto qualquer: id fora do formato é "não encontrado", nunca erro 500. */
export const isUuid = (value: string | null | undefined): value is string => typeof value === 'string' && UUID.test(value);

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Página pedida (1, 2…) e o recorte. A página é limitada ao total, como na API simulada. */
export function pageOf(param: string | undefined, total: number, size = PAGE_SIZE): { page: number; pageCount: number; skip: number; take: number } {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Number.parseInt(param ?? '1', 10) || 1), pageCount);
  return { page, pageCount, skip: (page - 1) * size, take: size };
}

export function paginate<T>(items: T[], param: string | undefined, size = PAGE_SIZE) {
  const { page, pageCount, skip, take } = pageOf(param, items.length, size);
  return { items: items.slice(skip, skip + take), page, pageCount, total: items.length };
}

// ── Efeitos depois do commit ─────────────────────────────────────────
/**
 * Notificações e eventos de tempo real coletados dentro da transação e disparados só depois que ela confirma
 * (plano §2.3). Nunca derrubam a requisição: falhas vão para o log (`notify`/`publish` já tratam).
 */
export class AfterCommit {
  private readonly tasks: Array<(c: AppContext) => Promise<void>> = [];

  notify(userIds: Iterable<string>, input: NotificationInput): this {
    const ids = [...userIds];
    this.tasks.push((c) => notify(c, ids, input));
    return this;
  }

  publish(channel: RealtimeChannel, event: RealtimeEvent): this {
    this.tasks.push((c) => publish(c, channel, event));
    return this;
  }

  run(task: (c: AppContext) => Promise<void>): this {
    this.tasks.push(task);
    return this;
  }

  async flush(c: AppContext): Promise<void> {
    for (const task of this.tasks.splice(0)) {
      try {
        await task(c);
      } catch (error) {
        c.get('log').error('efeito depois do commit falhou', { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
}

// ── Usuários ─────────────────────────────────────────────────────────
export const adminUserInclude = {
  roles: true,
  organizerLimits: true,
  twoFactor: { select: { enabledAt: true } },
} satisfies Prisma.UserInclude;
export type AdminUserRow = Prisma.UserGetPayload<{ include: typeof adminUserInclude }>;

const ROLE_ORDER: readonly Role[] = ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER', 'PARTICIPANT'];
export const rolesOf = (u: { roles: { role: Role }[] }): Role[] => ROLE_ORDER.filter((r) => u.roles.some((x) => x.role === r));
export const hasRole = (u: { roles: { role: Role }[] }, role: Role) => u.roles.some((r) => r.role === role);
export const isAdminUser = (u: { roles: { role: Role }[] }) => hasRole(u, 'ADMIN') || hasRole(u, 'SUPER_ADMIN');
export const DEFAULT_LIMITS = { maxActiveTournaments: 3, allowedGameIds: [] as string[] };
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Sanção que ainda vale agora (advertência nunca "vale": é só registro). */
export function inForce(s: { type: SanctionType; liftedAt: Date | null; endsAt: Date | null }, now: Date): boolean {
  if (s.liftedAt || s.type === 'WARNING') return false;
  return s.endsAt === null || s.endsAt.getTime() > now.getTime();
}

/** Fim da suspensão em vigor de cada usuário suspenso (a que termina por último). */
export async function suspensionEnds(db: Db, userIds: string[], now: Date): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await db.sanction.findMany({ where: { userId: { in: userIds }, type: 'SUSPENSION', liftedAt: null, endsAt: { gt: now } }, select: { userId: true, endsAt: true }, orderBy: { endsAt: 'desc' } });
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.userId) && r.endsAt) out.set(r.userId, r.endsAt.toISOString());
  return out;
}

export function toAdminUser(u: AdminUserRow, suspendedUntil: string | null): AdminUser {
  return {
    id: u.id,
    nickname: u.nickname,
    email: u.email,
    avatarUrl: u.avatarUrl,
    roles: rolesOf(u),
    status: u.status,
    emailVerified: u.emailVerified,
    twoFactorEnabled: Boolean(u.twoFactor?.enabledAt),
    verifiedOrganizer: u.organizerLimits?.verified ?? false,
    createdAt: u.createdAt.toISOString(),
    lastSeenAt: (u.lastSeenAt ?? u.createdAt).toISOString(),
    suspendedUntil: u.status === 'SUSPENDED' ? suspendedUntil : null,
  };
}

export async function toAdminUsers(db: Db, rows: AdminUserRow[], now: Date): Promise<AdminUser[]> {
  const ends = await suspensionEnds(
    db,
    rows.filter((u) => u.status === 'SUSPENDED').map((u) => u.id),
    now,
  );
  return rows.map((u) => toAdminUser(u, ends.get(u.id) ?? null));
}

/** Nome de quem fez algo (sanção, convite, pedido). Conta que não existe mais vira o texto padrão. */
export async function nicknames(db: Db, ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set([...ids].filter(isUuid))];
  if (wanted.length === 0) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, nickname: true } });
  return new Map(rows.map((r) => [r.id, r.nickname]));
}

type SanctionRow = { id: string; userId: string; type: SanctionType; reason: string; issuedById: string; startsAt: Date; endsAt: Date | null; liftedAt: Date | null; reportId: string | null };
export function toSanction(s: SanctionRow, names: Map<string, string>): Sanction {
  return { id: s.id, userId: s.userId, type: s.type, reason: s.reason, issuedByNickname: names.get(s.issuedById) ?? 'Administração', startsAt: s.startsAt.toISOString(), endsAt: iso(s.endsAt), liftedAt: iso(s.liftedAt), reportId: s.reportId };
}

/** Campeonatos distintos em que a pessoa jogou (inscrição própria ou no elenco de um squad), sem recusadas/canceladas. */
export async function tournamentsPlayed(db: Db, userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const ok = { notIn: ['REJECTED', 'CANCELLED'] as ('REJECTED' | 'CANCELLED')[] };
  const [solo, squad] = await Promise.all([
    db.registration.findMany({ where: { userId: { in: userIds }, status: ok }, select: { userId: true, tournamentId: true } }),
    db.registrationMember.findMany({ where: { userId: { in: userIds }, registration: { status: ok } }, select: { userId: true, tournamentId: true } }),
  ]);
  const sets = new Map<string, Set<string>>();
  for (const r of [...solo, ...squad]) {
    if (!r.userId) continue;
    const set = sets.get(r.userId) ?? new Set<string>();
    set.add(r.tournamentId);
    sets.set(r.userId, set);
  }
  return new Map([...sets].map(([id, set]) => [id, set.size]));
}

export async function toAdminUserDetail(db: Db, userId: string, now: Date): Promise<AdminUserDetail> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { ...adminUserInclude, gameAccounts: { include: { game: { select: { name: true } } }, orderBy: { createdAt: 'asc' } } } });
  const [sanctions, played, organized, memberships, reportsAgainst, ends] = await Promise.all([
    db.sanction.findMany({ where: { userId }, orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }] }),
    tournamentsPlayed(db, [userId]),
    db.tournament.count({ where: { ownerId: userId } }),
    db.teamMember.findMany({ where: { userId }, include: { team: { select: { id: true, name: true, tag: true, captainId: true } } }, orderBy: { joinedAt: 'asc' } }),
    db.report.count({ where: { OR: [{ targetOwnerUserId: userId }, { targetType: 'USER', targetId: userId }] } }),
    suspensionEnds(db, [userId], now),
  ]);
  const names = await nicknames(
    db,
    sanctions.map((s) => s.issuedById),
  );
  return {
    ...toAdminUser(u, ends.get(u.id) ?? null),
    bio: u.bio,
    state: u.state,
    gameAccounts: u.gameAccounts.map((a) => ({ gameName: a.game.name, fields: (a.fields ?? {}) as Record<string, string> })),
    sanctions: sanctions.map((s) => toSanction(s, names)),
    tournamentsPlayed: played.get(userId) ?? 0,
    tournamentsOrganized: organized,
    teams: memberships.map((m) => ({ id: m.team.id, name: m.team.name, tag: m.team.tag, isCaptain: m.team.captainId === userId })),
    reportsAgainst,
    organizerLimits: hasRole(u, 'ORGANIZER') ? (u.organizerLimits ? { maxActiveTournaments: u.organizerLimits.maxActiveTournaments, allowedGameIds: u.organizerLimits.allowedGameIds } : { ...DEFAULT_LIMITS }) : null,
  };
}

export async function findTargetUser(db: Db, id: string): Promise<AdminUserRow> {
  const user = isUuid(id) ? await db.user.findUnique({ where: { id }, include: adminUserInclude }) : null;
  if (!user) throw notFound('Usuário');
  return user;
}

/** Quem pode agir sobre quem: nunca sobre o Super Admin nem sobre si mesmo; sobre outro Admin, só o Super Admin. */
export function assertCanModerate(actor: AdminActor, target: AdminUserRow, what: string): void {
  if (target.id === actor.id) throw forbidden(`Você não pode ${what} a própria conta.`);
  if (hasRole(target, 'SUPER_ADMIN')) throw forbidden(`Ninguém pode ${what} o Super Admin.`);
  if (isAdminUser(target) && !actor.isSuperAdmin) throw forbidden(`Só o Super Admin pode ${what} outro administrador.`);
  if (target.status === 'MERGED' || target.status === 'DELETED') throw conflict('Esta conta não existe mais (foi mesclada ou excluída).', 'ACCOUNT_GONE');
}

/** Admins com a conta ativa (avisos da RN-09 e da RN-11). */
export async function activeAdminIds(db: Db, onlySuper = false): Promise<string[]> {
  const rows = await db.user.findMany({ where: { status: 'ACTIVE', roles: { some: { role: onlySuper ? 'SUPER_ADMIN' : { in: ['ADMIN', 'SUPER_ADMIN'] } } } }, select: { id: true } });
  return rows.map((r) => r.id);
}

export const isActiveTournament = (status: string) => (ACTIVE_TOURNAMENT_STATUSES as string[]).includes(status);

/** Campeonato pelo id ou pelo endereço (slug). */
export async function findTournamentRow(db: Db, idOrSlug: string) {
  const t = await db.tournament.findUnique({ where: isUuid(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug }, include: { game: { select: { name: true } }, owner: { select: { id: true, nickname: true, status: true } } } });
  if (!t) throw notFound('Campeonato');
  return t;
}
