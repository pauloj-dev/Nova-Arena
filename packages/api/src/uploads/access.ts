/**
 * Quem pode abrir um arquivo privado (issue #73, lacuna do PRD: provas não são públicas).
 * - Quem enviou e o Admin, sempre.
 * - Prova de partida (`MATCH`): as partes da partida e a organização do campeonato.
 * - Prova de disputa (`DISPUTE`): idem, pela partida da disputa.
 * - Denúncia (`REPORT`): só quem denunciou e a moderação (Admin).
 * Arquivo ainda sem recurso associado: só quem enviou.
 */
import type { PrismaClient, Role } from '@nova/db';
import { isAdmin } from '../auth/rbac';

export interface UploadRef {
  ownerId: string;
  attachedType: string | null;
  attachedId: string | null;
}

/** A pessoa está na partida (solo ou no squad) ou organiza o campeonato dela. */
async function partOfMatch(db: PrismaClient, userId: string, matchId: string): Promise<boolean> {
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: {
      participants: { select: { registration: { select: { userId: true, members: { select: { userId: true } } } } } },
      stage: { select: { tournament: { select: { ownerId: true, staff: { where: { userId }, select: { userId: true } } } } } },
    },
  });
  if (!match) return false;
  const tournament = match.stage.tournament;
  if (tournament.ownerId === userId || tournament.staff.length > 0) return true;
  return match.participants.some((p) => p.registration.userId === userId || p.registration.members.some((m) => m.userId === userId));
}

export async function canReadUpload(db: PrismaClient, viewer: { id: string; roles: readonly Role[] }, upload: UploadRef): Promise<boolean> {
  if (upload.ownerId === viewer.id || isAdmin(viewer.roles)) return true;
  if (!upload.attachedId) return false;
  switch (upload.attachedType) {
    case 'MATCH':
      return partOfMatch(db, viewer.id, upload.attachedId);
    case 'DISPUTE': {
      const dispute = await db.dispute.findUnique({ where: { id: upload.attachedId }, select: { matchId: true } });
      return dispute ? partOfMatch(db, viewer.id, dispute.matchId) : false;
    }
    default:
      // REPORT e qualquer tipo novo: fechado até alguém decidir quem vê.
      return false;
  }
}
