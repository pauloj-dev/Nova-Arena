/**
 * Quem precisa fazer check-in por uma inscrição (issue #84, RN-04): o próprio jogador no solo; no squad, o capitão ou
 * — se o campeonato exigir — todos os titulares confirmados. Mesma regra da API simulada (`mocks/competition.ts`).
 */
import type { Prisma, PrismaClient } from '@nova/db';
import { checkInOf } from '../modules/tournaments/views';

type Db = PrismaClient | Prisma.TransactionClient;

export const rosterSelect = {
  id: true,
  userId: true,
  team: { select: { captainId: true } },
  members: { select: { userId: true, isSub: true, confirmedAt: true } },
} as const;

export type RosterRegistration = Prisma.RegistrationGetPayload<{ select: typeof rosterSelect }>;

export function requiredUsers(reg: RosterRegistration, checkInConfig: unknown): string[] {
  if (reg.userId) return [reg.userId];
  if (checkInOf(checkInConfig).requireAllMembers) return reg.members.filter((m) => !m.isSub && m.confirmedAt).map((m) => m.userId);
  return reg.team ? [reg.team.captainId] : [];
}

/** Quem precisa fazer check-in, por inscrição, em todo o campeonato. */
export async function loadRoster(db: Db, tournament: { id: string; checkInConfig: unknown }): Promise<Map<string, string[]>> {
  const regs = await db.registration.findMany({ where: { tournamentId: tournament.id }, select: rosterSelect });
  return new Map(regs.map((r) => [r.id, requiredUsers(r, tournament.checkInConfig)]));
}

/** A inscrição completou o check-in: todos os obrigatórios confirmaram (lista vazia nunca conta). */
export function isComplete(required: string[] | undefined, done: { registrationId: string; userId: string }[], registrationId: string): boolean {
  if (!required || required.length === 0) return false;
  return required.every((u) => done.some((d) => d.registrationId === registrationId && d.userId === u));
}
