/**
 * Abertura e fechamento automáticos das inscrições (issue #76, PRD §8.3).
 *
 * Ao publicar, a API agenda no QStash uma mensagem para a data de abertura e outra para a de fechamento.
 * O Cron por minuto chama `syncRegistrationWindows`, que corrige o que ficou para trás (mensagem perdida,
 * data editada depois de publicar). Tudo idempotente: a mudança só acontece se o status e a data ainda
 * pedem, numa atualização condicional — rodar duas vezes não muda nada na segunda. A mudança é auditada
 * com autor nulo (sistema).
 */
import { audited, withAudit, type Prisma, type PrismaClient } from '@nova/db';
import type { Queue } from './index';

export type RegistrationAction = 'open' | 'close';

export const REGISTRATION_JOB_PATH = '/jobs/tournaments/registration';

const RULE: Record<RegistrationAction, { from: 'PUBLISHED' | 'REGISTRATION_OPEN'; to: 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED'; date: 'registrationOpensAt' | 'registrationClosesAt' }> = {
  // Abre se está publicado e a data chegou (sem data, publicar já abre na hora).
  open: { from: 'PUBLISHED', to: 'REGISTRATION_OPEN', date: 'registrationOpensAt' },
  close: { from: 'REGISTRATION_OPEN', to: 'REGISTRATION_CLOSED', date: 'registrationClosesAt' },
};

const dueWhere = (action: RegistrationAction, now: Date): Prisma.TournamentWhereInput => ({ status: RULE[action].from, [RULE[action].date]: { lte: now } });

/** Aplica uma ação a um campeonato. Devolve `true` se mudou alguma coisa. */
export async function runRegistrationJob(db: PrismaClient, tournamentId: string, action: RegistrationAction, now: Date): Promise<boolean> {
  return withAudit(db, { actorId: null, reason: action === 'open' ? 'Abertura automática das inscrições' : 'Fechamento automático das inscrições' }, async (tx) => {
    const { count } = await tx.tournament.updateMany({ where: { id: tournamentId, ...dueWhere(action, now) }, data: { status: RULE[action].to } });
    if (count === 0) return false;
    const t = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId }, select: { name: true } });
    await audited(tx, { action: 'TOURNAMENT_STATUS_CHANGED', entityType: 'Tournament', entityId: tournamentId, entityLabel: t.name, tournamentId, before: { status: RULE[action].from }, after: { status: RULE[action].to } });
    return true;
  });
}

/** Cron: abre e fecha tudo o que já passou da hora. Devolve quantos mudaram. */
export async function syncRegistrationWindows(db: PrismaClient, now: Date): Promise<{ opened: number; closed: number }> {
  const result = { opened: 0, closed: 0 };
  // Abre primeiro: um campeonato com as duas datas no passado abre e fecha na mesma passada.
  for (const action of ['open', 'close'] as const) {
    const due = await db.tournament.findMany({ where: dueWhere(action, now), select: { id: true }, take: 200 });
    for (const { id } of due) if (await runRegistrationJob(db, id, action, now)) result[action === 'open' ? 'opened' : 'closed'] += 1;
  }
  return result;
}

/** Agenda as mensagens de abertura e fechamento de um campeonato recém-publicado. */
export async function scheduleRegistrationWindow(queue: Queue, t: { id: string; registrationOpensAt: Date | null; registrationClosesAt: Date | null }, now: Date): Promise<void> {
  if (t.registrationOpensAt && t.registrationOpensAt > now) {
    await queue.schedule({ path: REGISTRATION_JOB_PATH, body: { tournamentId: t.id, action: 'open' }, at: t.registrationOpensAt, dedupId: `open-${t.id}-${t.registrationOpensAt.getTime()}` });
  }
  if (t.registrationClosesAt) {
    await queue.schedule({ path: REGISTRATION_JOB_PATH, body: { tournamentId: t.id, action: 'close' }, at: t.registrationClosesAt, dedupId: `close-${t.id}-${t.registrationClosesAt.getTime()}` });
  }
}
