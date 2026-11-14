/**
 * Quem vê os IDs de jogo de alguém (issue #72, RNF-10). Fora a própria pessoa, só quem precisa deles para
 * a partida acontecer:
 * - Admin e Super Admin;
 * - a organização (dono e staff) de um campeonato em que a pessoa está inscrita;
 * - os adversários: quem está na mesma partida, em outra inscrição.
 *
 * O perfil público (`GET /users/:nickname`) nunca leva IDs de jogo nem e-mail.
 */
import type { PrismaClient, Role } from '@nova/db';
import { isAdmin } from './rbac';

export async function canSeeGameAccounts(db: PrismaClient, viewer: { id: string; roles: readonly Role[] }, targetId: string): Promise<boolean> {
  if (viewer.id === targetId || isAdmin(viewer.roles)) return true;

  // Inscrições da pessoa (solo ou como membro de squad), ativas.
  const registrations = await db.registration.findMany({
    where: { status: { notIn: ['CANCELLED', 'REJECTED', 'WITHDRAWN'] }, OR: [{ userId: targetId }, { members: { some: { userId: targetId } } }] },
    select: { id: true, tournamentId: true },
  });
  if (registrations.length === 0) return false;

  // Organização de algum desses campeonatos.
  const tournamentIds = [...new Set(registrations.map((r) => r.tournamentId))];
  const organizes = await db.tournament.count({ where: { id: { in: tournamentIds }, OR: [{ ownerId: viewer.id }, { staff: { some: { userId: viewer.id } } }] } });
  if (organizes > 0) return true;

  // Adversário: mesma partida, outra inscrição, e o visitante está nela (solo ou membro do squad).
  const opponents = await db.matchParticipant.count({
    where: {
      registrationId: { notIn: registrations.map((r) => r.id) },
      registration: { OR: [{ userId: viewer.id }, { members: { some: { userId: viewer.id } } }] },
      match: { participants: { some: { registrationId: { in: registrations.map((r) => r.id) } } } },
    },
  });
  return opponents > 0;
}
