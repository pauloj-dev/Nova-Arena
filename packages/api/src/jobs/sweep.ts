/**
 * Varredura por minuto (issue #99): corrige tudo o que tem hora marcada e pode ter ficado para trás.
 * - Abre e fecha inscrições na data (#76).
 * - RN-12: squad promovido que não completou o elenco no prazo volta ao fim da fila e a vaga anda.
 * - RN-04: W.O. de quem não fez check-in, se a mensagem do QStash do fechamento não chegou (#84).
 * Idempotente: cada passo confere o estado atual no banco, na transação com a trava do campeonato.
 */
import type { PrismaClient } from '@nova/db';
import { sweepWalkovers } from '../competition/walkover';
import { LOCKED_TX, lockTournament, settleWaitlist } from '../modules/registrations/core';
import { syncRegistrationWindows } from './registration';

export interface SweepResult {
  opened: number;
  closed: number;
  waitlistsSettled: number;
  walkovers: number;
}

export async function sweep(db: PrismaClient, now: Date): Promise<SweepResult> {
  const windows = await syncRegistrationWindows(db, now);
  // Só os campeonatos com alguma reserva vencida: o resto não tem o que acertar.
  const due = await db.registration.findMany({ where: { status: 'PENDING_MEMBERS', reservedUntil: { lte: now } }, select: { tournamentId: true }, distinct: ['tournamentId'], take: 100 });
  let waitlistsSettled = 0;
  for (const { tournamentId } of due) {
    await db.$transaction(async (tx) => {
      const t = await lockTournament(tx, tournamentId);
      await settleWaitlist(tx, t, now);
    }, LOCKED_TX);
    waitlistsSettled += 1;
  }
  const walkovers = await sweepWalkovers(db, now);
  return { ...windows, waitlistsSettled, walkovers };
}
