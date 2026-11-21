/**
 * Sanções com efeito imediato (issue #96, ADM-07, CT-09). Porta de `applySanction` e `expireSuspensions` de
 * `apps/web/mocks/handlers/admin-users.ts`.
 *
 * - Suspensão e banimento mudam o status, **sobem a versão da sessão** do usuário e revogam as sessões abertas, na
 *   mesma transação. `currentSession` confere status e versão a cada requisição: o próximo pedido da pessoa já
 *   volta sem sessão (401). Depois do commit sai `session.revoked` em `user:{id}` para a tela sair na hora.
 * - Suspensão expira sozinha: `expireSuspensions` roda na varredura do Cron (a cada minuto) e nas leituras do painel.
 * - Nova suspensão (ou o banimento) substitui a suspensão em vigor: fica só uma valendo.
 * - Organizador suspenso ou banido: RN-09 nos campeonatos dele.
 */
import { audited, withAudit, type PrismaClient, type Tx } from '@nova/db';
import type { CreateSanctionInput, OrphanOutcome, Sanction } from '@nova/schemas';
import type { AuditContext } from '@nova/db';
import { badRequest, conflict } from '../../errors';
import type { AdminActor } from '../../auth/admin';
import { releaseTournamentsOf } from './rn09';
import { AfterCommit, assertCanModerate, DAY_MS, inForce, isUuid, toSanction, type AdminUserRow } from './shared';

const SANCTION_TEXT: Record<Sanction['type'], { title: string; verb: string }> = {
  WARNING: { title: 'Você recebeu uma advertência', verb: 'Advertência aplicada' },
  SUSPENSION: { title: 'Sua conta foi suspensa', verb: 'Suspensão aplicada' },
  BAN: { title: 'Sua conta foi banida', verb: 'Banimento aplicado' },
};

/** Derruba todas as sessões do usuário (na transação de quem chamou). */
export async function dropSessions(tx: Tx, userId: string, now: Date): Promise<void> {
  await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  await tx.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
}

export interface SanctionOutcome {
  sanction: Sanction;
  affectedTournaments: OrphanOutcome[];
  after: AfterCommit;
}

export async function applySanction(db: PrismaClient, ctx: AuditContext, actor: AdminActor & { nickname: string }, target: AdminUserRow, input: CreateSanctionInput, now: Date): Promise<SanctionOutcome> {
  assertCanModerate(actor, target, 'sancionar');
  if (target.status === 'BANNED') throw conflict('Esta conta já está banida.', 'ALREADY_BANNED');
  const report = input.reportId && isUuid(input.reportId) ? await db.report.findUnique({ where: { id: input.reportId } }) : null;
  if (input.reportId && !report) throw badRequest('Denúncia não encontrada.', 'VALIDATION', { reportId: 'Denúncia não encontrada.' });

  const reason = input.reason.trim();
  const endsAt = input.type === 'SUSPENSION' ? new Date(now.getTime() + (input.days ?? 1) * DAY_MS) : null;
  const after = new AfterCommit();
  const result = await withAudit(db, { ...ctx, reason }, async (tx) => {
    // Uma suspensão nova (ou o banimento) substitui a suspensão em vigor.
    if (input.type !== 'WARNING') {
      await tx.sanction.updateMany({ where: { userId: target.id, type: 'SUSPENSION', liftedAt: null, endsAt: { gt: now } }, data: { liftedAt: now } });
    }
    const record = await tx.sanction.create({ data: { userId: target.id, type: input.type, reason, issuedById: actor.id, startsAt: now, endsAt, reportId: report?.id ?? null } });
    const status = input.type === 'SUSPENSION' ? 'SUSPENDED' : input.type === 'BAN' ? 'BANNED' : target.status;
    if (input.type !== 'WARNING') {
      // Corrida entre dois banimentos: só um passa.
      const { count } = await tx.user.updateMany({ where: { id: target.id, status: { not: 'BANNED' } }, data: { status } });
      if (count === 0) throw conflict('Esta conta já está banida.', 'ALREADY_BANNED');
      await dropSessions(tx, target.id, now);
    }
    const resolution = `${SANCTION_TEXT[input.type].verb}: ${reason}`;
    if (report) await tx.report.update({ where: { id: report.id }, data: { status: 'ACTIONED', resolution, handledById: actor.id } });
    await audited(tx, {
      action: 'USER_SANCTIONED',
      entityType: 'User',
      entityId: target.id,
      entityLabel: target.nickname,
      before: { status: target.status },
      after: { status, sancao: input.type, ...(endsAt ? { ate: endsAt.toISOString() } : {}), ...(report ? { denuncia: report.id } : {}) },
      reason,
    });
    if (report) {
      await audited(tx, { action: 'REPORT_HANDLED', entityType: 'Report', entityId: report.id, entityLabel: report.targetLabel || report.targetId, before: { status: report.status }, after: { status: 'ACTIONED' }, reason: resolution });
    }
    let affected: OrphanOutcome[] = [];
    if (input.type !== 'WARNING') {
      affected = await releaseTournamentsOf(tx, target, input.type === 'BAN' ? `Organizador ${target.nickname} banido` : `Organizador ${target.nickname} suspenso`, after);
    }
    return { record, affected };
  });

  const until = endsAt ? ` até ${endsAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : '';
  after.notify([target.id], { type: 'SANCTION', title: SANCTION_TEXT[input.type].title, body: `${input.type === 'SUSPENSION' ? `Suspensão${until}. ` : ''}Motivo: ${reason}`, link: null });
  // CT-09: a tela aberta sai na hora. O evento não leva dado sensível: só o motivo genérico.
  if (input.type !== 'WARNING') after.publish(`user:${target.id}`, { type: 'session.revoked', reason: input.type === 'BAN' ? 'BANNED' : 'SUSPENDED' });
  return { sanction: toSanction(result.record, new Map([[actor.id, actor.nickname]])), affectedTournaments: result.affected, after };
}

/** Remove a sanção antes do prazo. O status volta ao que as outras sanções em vigor mandarem. */
export async function liftSanction(db: PrismaClient, ctx: AuditContext, actor: AdminActor, target: AdminUserRow, sanctionId: string, reason: string | null, now: Date): Promise<AfterCommit> {
  assertCanModerate(actor, target, 'alterar as sanções de');
  const after = new AfterCommit();
  const record = await db.sanction.findUniqueOrThrow({ where: { id: sanctionId } });
  if (record.liftedAt) throw conflict('Esta sanção já foi removida.', 'ALREADY_LIFTED');
  await withAudit(db, { ...ctx, reason }, async (tx) => {
    const { count } = await tx.sanction.updateMany({ where: { id: record.id, liftedAt: null }, data: { liftedAt: now } });
    if (count === 0) throw conflict('Esta sanção já foi removida.', 'ALREADY_LIFTED');
    let status = target.status;
    if (record.type !== 'WARNING') {
      const others = (await tx.sanction.findMany({ where: { userId: target.id, liftedAt: null, type: { in: ['SUSPENSION', 'BAN'] } } })).filter((s) => inForce(s, now));
      status = others.some((s) => s.type === 'BAN') ? 'BANNED' : others.some((s) => s.type === 'SUSPENSION') ? 'SUSPENDED' : 'ACTIVE';
      await tx.user.update({ where: { id: target.id }, data: { status } });
    }
    await audited(tx, { action: 'SANCTION_LIFTED', entityType: 'User', entityId: target.id, entityLabel: target.nickname, before: { status: target.status, sancao: record.type }, after: { status }, reason });
  });
  after.notify([target.id], {
    type: 'SANCTION',
    title: 'Sanção removida',
    body: record.type === 'WARNING' ? 'A administração removeu uma advertência da sua conta.' : 'A administração removeu a sanção e a sua conta voltou a ficar ativa.',
    link: null,
  });
  return after;
}

/**
 * Suspensão vencida devolve a conta para "ativa" (idempotente). Roda na varredura do Cron e nas leituras do painel.
 * Não sobe a versão da sessão: a pessoa só precisa entrar de novo.
 */
export async function expireSuspensions(db: PrismaClient | Tx, now: Date): Promise<number> {
  const due = await db.user.findMany({
    where: { status: 'SUSPENDED', sanctions: { none: { type: { in: ['SUSPENSION', 'BAN'] }, liftedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } } },
    select: { id: true },
    take: 500,
  });
  if (due.length === 0) return 0;
  const { count } = await db.user.updateMany({ where: { id: { in: due.map((u) => u.id) }, status: 'SUSPENDED' }, data: { status: 'ACTIVE' } });
  return count;
}
