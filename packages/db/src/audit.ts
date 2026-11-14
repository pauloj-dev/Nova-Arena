/**
 * Auditoria imutável (issue #71, RF-06, RNF-15). Toda ação sensível grava o registro **na mesma
 * transação** da mudança: se a ação falhar, não sobra registro; se o registro falhar, a ação não vale.
 *
 *   await withAudit(db(), { actorId, ip, userAgent }, async (tx) => {
 *     const t = await tx.tournament.update({ ... });
 *     await audited(tx, { action: 'TOURNAMENT_UPDATED', entityType: 'Tournament', entityId: t.id, entityLabel: t.name, before, after });
 *   });
 *
 * Mudança de papel (`user_roles`) é registrada sozinha por um gatilho do banco, com o autor vindo do
 * contexto de `withAudit` — não chame `audited` para ROLE_GRANTED/ROLE_REVOKED.
 */
import { AuditActionSchema, type AuditAction } from '@nova/schemas';
import { Prisma, type PrismaClient } from './generated/prisma/client';

export type Tx = Prisma.TransactionClient;

export interface AuditContext {
  /** Quem fez. Nulo para ações do sistema (jobs, Cron). */
  actorId: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** Motivo informado pela pessoa, quando a ação exige. */
  reason?: string | null;
}

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId: string;
  /** Nome legível no momento da ação (ex.: o nome do campeonato). */
  entityLabel?: string;
  tournamentId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
}

/** Contexto da transação atual, lido pelos gatilhos de auditoria do banco. */
async function setContext(tx: Tx, ctx: AuditContext): Promise<void> {
  // `set_config(..., true)` vale só até o fim da transação (equivale a SET LOCAL).
  await tx.$executeRaw`SELECT
    set_config('nova.actor_id', ${ctx.actorId ?? ''}, true),
    set_config('nova.ip', ${ctx.ip ?? ''}, true),
    set_config('nova.user_agent', ${(ctx.userAgent ?? '').slice(0, 500)}, true),
    set_config('nova.reason', ${ctx.reason ?? ''}, true)`;
}

const contexts = new WeakMap<object, AuditContext>();

/** Abre uma transação com o contexto de auditoria e roda `fn` dentro dela. */
export async function withAudit<T>(client: PrismaClient, ctx: AuditContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return client.$transaction(async (tx) => {
    await setContext(tx, ctx);
    contexts.set(tx, ctx);
    return fn(tx);
  });
}

const json = (value: Record<string, unknown> | null | undefined) => (value == null ? Prisma.DbNull : (value as Prisma.InputJsonObject));

/**
 * Grava um registro de auditoria. Use dentro de `withAudit` (a transação traz autor, IP e navegador).
 * Ação fora do catálogo `AUDIT_ACTIONS` é recusada antes de chegar ao banco.
 */
export async function audited(tx: Tx, entry: AuditEntry): Promise<void> {
  const action = AuditActionSchema.parse(entry.action);
  if (action === 'ROLE_GRANTED' || action === 'ROLE_REVOKED') {
    throw new Error('Mudança de papel já é auditada pelo gatilho de user_roles: não registre de novo.');
  }
  const ctx = contexts.get(tx);
  if (!ctx) throw new Error('audited() precisa rodar dentro de withAudit(): o registro vai na mesma transação da ação.');
  await tx.auditLog.create({
    data: {
      actorId: ctx.actorId,
      action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      entityLabel: entry.entityLabel ?? '',
      tournamentId: entry.tournamentId ?? null,
      before: json(entry.before),
      after: json(entry.after),
      reason: entry.reason ?? ctx.reason ?? null,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 500) : null,
    },
  });
}

/** Concede um papel (idempotente). O registro ROLE_GRANTED sai do gatilho do banco. */
export async function grantRole(tx: Tx, userId: string, role: 'SUPER_ADMIN' | 'ADMIN' | 'ORGANIZER' | 'PARTICIPANT', grantedById: string | null): Promise<boolean> {
  const exists = await tx.userRole.findUnique({ where: { userId_role: { userId, role } } });
  if (exists) return false;
  await tx.userRole.create({ data: { userId, role, grantedById } });
  return true;
}

/** Revoga um papel. Todo usuário mantém PARTICIPANT. O registro ROLE_REVOKED sai do gatilho do banco. */
export async function revokeRole(tx: Tx, userId: string, role: 'SUPER_ADMIN' | 'ADMIN' | 'ORGANIZER'): Promise<boolean> {
  const { count } = await tx.userRole.deleteMany({ where: { userId, role } });
  return count > 0;
}
