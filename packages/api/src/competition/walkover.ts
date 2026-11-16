/**
 * W.O. (issue #84, PRD PAR-07, RN-04).
 *
 * Em duelo com horário marcado, quando a janela de check-in fecha: quem não fez check-in leva W.O. se o adversário
 * fez; com os dois presentes joga-se; com os dois ausentes a organização decide. Quem aplica é a mensagem do QStash
 * no fechamento da janela e, se ela não chegar, a varredura por minuto do Cron.
 *
 * Idempotente: roda numa transação com a linha da fase travada (`FOR UPDATE`) e não faz nada se a partida já tem
 * resultado — a mesma mensagem entregue duas vezes (ou o Cron junto com ela) aplica uma vez só.
 */
import { audited, withAudit, type AuditContext, type Prisma, type PrismaClient } from '@nova/db';
import { applyWalkover } from '@nova/engine';
import { checkInWindow } from './bracket';
import { isComplete, requiredUsers, rosterSelect } from './check-in';
import { projectRun, readRun, snapshotOf, engine } from './run';

type Tx = Prisma.TransactionClient;

/** Trava a fase da partida e devolve o que é preciso para mexer na chave. */
async function lockedMatch(tx: Tx, matchId: string, stageId: string) {
  // Uma operação de chave por vez nesta fase.
  await tx.$queryRaw`SELECT id FROM stages WHERE id = ${stageId}::uuid FOR UPDATE`;
  const match = await tx.match.findUniqueOrThrow({ where: { id: matchId }, include: { stage: { include: { tournament: true } } } });
  const run = readRun(match.stage);
  const node = run?.structure.matches.find((m) => m.id === match.nodeId);
  return { match, run, node };
}

/** Grava o W.O. no retrato do motor e na projeção; o vencedor avança na chave. */
async function writeWalkover(tx: Tx, found: Awaited<ReturnType<typeof lockedMatch>>, winnerId: string, after: Record<string, unknown>) {
  const { match, run, node } = found;
  if (!run || !node) throw new Error('partida sem chave');
  const snapshot = engine(() => applyWalkover(run.structure, run.state, { matchId: node.id, winnerId }));
  await tx.stage.update({ where: { id: match.stageId }, data: { engineSnapshot: snapshotOf(snapshot.structure, snapshot.state) } });
  await projectRun(tx, match.stageId, { ...run, structure: snapshot.structure, state: snapshot.state });
  await tx.match.update({ where: { id: match.id }, data: { status: 'WALKOVER' } });
  await audited(tx, {
    action: 'WALKOVER_APPLIED',
    entityType: 'Match',
    entityId: match.id,
    entityLabel: `${match.stage.name} · ${node.roundLabel}`,
    tournamentId: match.stage.tournamentId,
    after: { vencedor: winnerId, ...after },
  });
}

export type WalkoverOutcome = 'APPLIED' | 'ALREADY_DECIDED' | 'NOT_DUE' | 'BOTH_PRESENT' | 'BOTH_ABSENT' | 'NOT_APPLICABLE';

/** Aplica o W.O. automático de uma partida se a janela fechou e só um lado fez check-in. */
export async function applyDueWalkover(db: PrismaClient, matchId: string, now: Date): Promise<{ outcome: WalkoverOutcome; winnerId?: string; loserId?: string }> {
  const head = await db.match.findUnique({ where: { id: matchId }, select: { stageId: true } });
  if (!head) return { outcome: 'NOT_APPLICABLE' };
  return withAudit(db, { actorId: null, reason: 'Check-in não realizado até o fechamento da janela (automático)' }, async (tx) => {
    const found = await lockedMatch(tx, matchId, head.stageId);
    const { match, run, node } = found;
    const t = match.stage.tournament;
    if (!run?.confirmed || t.status !== 'IN_PROGRESS' || !node) return { outcome: 'NOT_APPLICABLE' as const };
    if (node.kind !== 'DUEL' || node.slots.length !== 2) return { outcome: 'NOT_APPLICABLE' as const };
    if (run.state.results[node.id]) return { outcome: 'ALREADY_DECIDED' as const };
    const [a, b] = node.slots.map((s) => s.entrantId);
    if (!a || !b) return { outcome: 'NOT_APPLICABLE' as const };
    const window = checkInWindow(t, match.scheduledAt);
    if (!window || now.getTime() < Date.parse(window.closesAt)) return { outcome: 'NOT_DUE' as const };

    const [regs, done] = await Promise.all([
      tx.registration.findMany({ where: { id: { in: [a, b] } }, select: rosterSelect }),
      tx.checkIn.findMany({ where: { matchId: match.id }, select: { registrationId: true, userId: true } }),
    ]);
    const present = (id: string) => {
      const reg = regs.find((r) => r.id === id);
      return reg ? isComplete(requiredUsers(reg, t.checkInConfig), done, id) : false;
    };
    const aIn = present(a);
    const bIn = present(b);
    if (aIn && bIn) return { outcome: 'BOTH_PRESENT' as const };
    if (!aIn && !bIn) return { outcome: 'BOTH_ABSENT' as const };
    const winnerId = aIn ? a : b;
    const loserId = aIn ? b : a;
    await writeWalkover(tx, found, winnerId, { motivo: 'check-in não realizado', automatico: true });
    return { outcome: 'APPLIED' as const, winnerId, loserId };
  });
}

/** W.O. manual da organização (moderador também pode), com motivo. */
export async function applyManualWalkover(db: PrismaClient, ctx: AuditContext, matchId: string, stageId: string, winnerId: string): Promise<void> {
  await withAudit(db, ctx, async (tx) => {
    const found = await lockedMatch(tx, matchId, stageId);
    await writeWalkover(tx, found, winnerId, { automatico: false });
  });
}

/** Partidas que podem ter W.O. atrasado: duelos marcados, sem resultado, de campeonatos em andamento. */
export async function sweepWalkovers(db: PrismaClient, now: Date): Promise<number> {
  const candidates = await db.match.findMany({
    where: {
      kind: 'DUEL',
      // A janela fecha antes do horário; uma semana para trás cobre qualquer atraso do Cron.
      scheduledAt: { not: null, gte: new Date(now.getTime() - 7 * 24 * 3600_000), lte: new Date(now.getTime() + 24 * 3600_000) },
      status: { in: ['SCHEDULED', 'CHECK_IN'] },
      stage: { confirmedAt: { not: null }, tournament: { status: 'IN_PROGRESS' } },
    },
    select: { id: true, scheduledAt: true, stage: { select: { tournament: { select: { checkInConfig: true } } } } },
    orderBy: { scheduledAt: 'asc' },
    take: 500,
  });
  // Só abre transação para quem já passou do fechamento da janela.
  const due = candidates.filter((m) => {
    const window = checkInWindow(m.stage.tournament, m.scheduledAt);
    return window !== null && now.getTime() >= Date.parse(window.closesAt);
  });
  let applied = 0;
  for (const { id } of due) if ((await applyDueWalkover(db, id, now)).outcome === 'APPLIED') applied += 1;
  return applied;
}
