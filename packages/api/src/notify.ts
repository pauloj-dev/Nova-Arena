/**
 * Notificações (PAR-10, issue #98): ponto único que todos os módulos chamam **depois do commit**.
 *
 * - Grava uma `Notification` por destinatário quando ele quer o aviso no site e avisa o canal `user:{id}`.
 * - Quando ele quer o aviso por e-mail, agenda o job `/jobs/notifications/email` no QStash (que tenta de novo
 *   sozinho); o id de deduplicação evita e-mail repetido. O job é implementado na issue #98.
 * - Avisos da moderação (`SANCTION`) não podem ser desligados.
 */
import type { NotificationType, PrismaClient } from '@nova/db';
import type { AppContext } from './context';
import type { Realtime } from './realtime';

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
}

/** Corpo do job de e-mail (`/jobs/notifications/email`). */
export interface NotificationEmailJob extends NotificationInput {
  userId: string;
  /** Id da notificação gravada; nulo quando a pessoa desligou o aviso no site e quer só o e-mail. */
  notificationId: string | null;
  dedupId: string;
}

export const NOTIFICATION_EMAIL_JOB_PATH = '/jobs/notifications/email';

export async function preferencesOf(db: PrismaClient, userIds: string[], type: NotificationType): Promise<Map<string, { inApp: boolean; email: boolean }>> {
  const rows = type === 'SANCTION' ? [] : await db.notificationPreference.findMany({ where: { userId: { in: userIds }, type } });
  const byUser = new Map(rows.map((r) => [r.userId, { inApp: r.inApp, email: r.email }]));
  return new Map(userIds.map((id) => [id, byUser.get(id) ?? { inApp: true, email: true }]));
}

/**
 * Notifica os usuários (ids repetidos são ignorados). Nunca lança: falha ao notificar vai para o log e não
 * desfaz a ação que já foi gravada.
 */
export async function notify(c: AppContext, userIds: Iterable<string>, input: NotificationInput): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  const { db: getDb, queue, realtime } = c.get('deps');
  const env = c.get('env');
  const log = c.get('log');
  try {
    const db = getDb();
    const prefs = await preferencesOf(db, ids, input.type);
    const now = c.get('deps').now();
    for (const userId of ids) {
      const pref = prefs.get(userId) ?? { inApp: true, email: true };
      if (!pref.inApp && !pref.email) continue;
      let notificationId: string | null = null;
      if (pref.inApp) {
        const row = await db.notification.create({ data: { userId, type: input.type, title: input.title, body: input.body, link: input.link ?? null } });
        notificationId = row.id;
        await realtime(env, log).publish(`user:${userId}`, { type: 'notification.created', id: row.id });
      }
      if (pref.email) {
        const dedupId = notificationId ?? `${userId}-${input.type}-${now.getTime()}`;
        const job: NotificationEmailJob = { ...input, link: input.link ?? null, userId, notificationId, dedupId };
        await queue(env, log).schedule({ path: NOTIFICATION_EMAIL_JOB_PATH, body: job, at: now, dedupId: `email-${dedupId}` });
      }
    }
  } catch (error) {
    log.error('falha ao notificar', { type: input.type, destinatarios: ids.length, error: error instanceof Error ? error.message : String(error) });
  }
}

/** Quem segue um campeonato ou um jogo (RN-15). */
export async function followersOf(db: PrismaClient, targetType: 'TOURNAMENT' | 'GAME', targetId: string): Promise<string[]> {
  const rows = await db.follow.findMany({ where: { targetType, targetId }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/** Publica um evento de tempo real depois do commit. Nunca lança. */
export async function publish(c: AppContext, ...args: Parameters<Realtime['publish']>): Promise<void> {
  try {
    await c.get('deps').realtime(c.get('env'), c.get('log')).publish(...args);
  } catch (error) {
    c.get('log').error('falha ao publicar evento', { error: error instanceof Error ? error.message : String(error) });
  }
}
