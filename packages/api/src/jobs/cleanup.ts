/**
 * Limpeza diária (issue #99). Cada passo confere o estado atual e é idempotente: rodar duas vezes não muda
 * nada na segunda.
 *
 * - Convites de squad vencidos → `EXPIRED`.
 * - Uploads órfãos (sem recurso associado há mais de 24 h, #73) → apagados do Blob e do banco.
 * - Tokens de e-mail usados ou vencidos há mais de 7 dias → apagados (só o hash era guardado).
 * - Sessões revogadas ou vencidas há mais de 30 dias → apagadas.
 */
import type { PrismaClient } from '@nova/db';
import type { UploadPurpose } from '@nova/schemas';
import type { Env } from '../env';
import type { Logger } from '../logger';
import { storeToken, type BlobStore } from '../uploads/store';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** Por rodada: o resto fica para o dia seguinte (a função tem tempo limite). */
const BATCH = 500;

export interface CleanupResult {
  invitesExpired: number;
  uploadsDeleted: number;
  uploadsFailed: number;
  emailTokensDeleted: number;
  sessionsDeleted: number;
}

export async function dailyCleanup(deps: { db: PrismaClient; blob: BlobStore; env: Env; log: Logger }, now: Date): Promise<CleanupResult> {
  const { db, blob, env, log } = deps;

  const invites = await db.teamInvite.updateMany({ where: { status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });

  let uploadsDeleted = 0;
  let uploadsFailed = 0;
  const orphans = await db.upload.findMany({ where: { attachedAt: null, createdAt: { lte: new Date(now.getTime() - DAY) } }, take: BATCH, orderBy: { createdAt: 'asc' } });
  for (const upload of orphans) {
    try {
      await blob.remove(upload.blobUrl, storeToken(env, upload.purpose as UploadPurpose));
      // Só some do banco se ainda estiver órfão (alguém pode ter associado no meio do caminho).
      const { count } = await db.upload.deleteMany({ where: { id: upload.id, attachedAt: null } });
      uploadsDeleted += count;
    } catch (error) {
      // Um arquivo com problema não trava os outros; ele volta na próxima limpeza.
      uploadsFailed += 1;
      log.warn('upload órfão não apagado', { uploadId: upload.id, error: String(error) });
    }
  }

  const emailTokens = await db.emailToken.deleteMany({ where: { OR: [{ usedAt: { lte: new Date(now.getTime() - 7 * DAY) } }, { expiresAt: { lte: new Date(now.getTime() - 7 * DAY) } }] } });
  const sessions = await db.session.deleteMany({ where: { OR: [{ revokedAt: { lte: new Date(now.getTime() - 30 * DAY) } }, { expiresAt: { lte: new Date(now.getTime() - 30 * DAY) } }] } });

  return { invitesExpired: invites.count, uploadsDeleted, uploadsFailed, emailTokensDeleted: emailTokens.count, sessionsDeleted: sessions.count };
}
