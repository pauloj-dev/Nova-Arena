/**
 * Notificações (PAR-10, issue #98): ponto único que todos os módulos chamam **depois do commit**.
 *
 * - Grava uma `Notification` por destinatário que quer o aviso em algum canal. Quem desligou o aviso no site
 *   para o tipo ganha o registro com `inApp = false` (já lido, fora da lista e do contador): ele existe só para o
 *   e-mail/push terem um id estável — é esse id que impede o envio duplicado.
 * - No site: avisa o canal `user:{id}` (`notification.created`).
 * - Por e-mail: agenda o job `/jobs/notifications/email` no QStash (que tenta de novo sozinho); dedup `email-<id>`.
 * - Push no PWA (issue #109): para quem assinou o push e quer o tipo, agenda `/jobs/notifications/push`.
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

/** Corpo dos jobs de entrega (`/jobs/notifications/email` e `/jobs/notifications/push`). */
export interface NotificationEmailJob extends NotificationInput {
  userId: string;
  /** Id da notificação gravada (sempre presente desde a #98; nulo só em mensagens antigas). */
  notificationId: string | null;
  dedupId: string;
}

export const NOTIFICATION_EMAIL_JOB_PATH = '/jobs/notifications/email';
export const NOTIFICATION_PUSH_JOB_PATH = '/jobs/notifications/push';

export interface ChannelPreference {
  inApp: boolean;
  email: boolean;
  push: boolean;
}

const ALL_ON: ChannelPreference = { inApp: true, email: true, push: true };

export async function preferencesOf(db: PrismaClient, userIds: string[], type: NotificationType): Promise<Map<string, ChannelPreference>> {
  const rows = type === 'SANCTION' ? [] : await db.notificationPreference.findMany({ where: { userId: { in: userIds }, type } });
  const byUser = new Map(rows.map((r) => [r.userId, { inApp: r.inApp, email: r.email, push: r.push }]));
  return new Map(userIds.map((id) => [id, byUser.get(id) ?? ALL_ON]));
}

/** Push só existe com as chaves VAPID configuradas. */
export const pushConfigured = (env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string }) => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

/**
 * Notifica os usuários (ids repetidos são ignorados). Nunca lança: falha ao notificar vai para o log e não
 * desfaz a ação que já foi gravada.
 */
export async function notify(c: AppContext, userIds: Iterable<string>, input: NotificationInput): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  const { db: getDb, queue, realtime, now: clock } = c.get('deps');
  const env = c.get('env');
  const log = c.get('log');
  try {
    const db = getDb();
    const prefs = await preferencesOf(db, ids, input.type);
    const withPush = pushConfigured(env)
      ? new Set((await db.pushSubscription.findMany({ where: { userId: { in: ids } }, select: { userId: true }, distinct: ['userId'] })).map((r) => r.userId))
      : new Set<string>();
    const now = clock();
    for (const userId of ids) {
      const pref = prefs.get(userId) ?? ALL_ON;
      const push = pref.push && withPush.has(userId);
      if (!pref.inApp && !pref.email && !push) continue;
      const row = await db.notification.create({
        data: { userId, type: input.type, title: input.title, body: input.body, link: input.link ?? null, inApp: pref.inApp, readAt: pref.inApp ? null : now, createdAt: now },
      });
      if (pref.inApp) await realtime(env, log).publish(`user:${userId}`, { type: 'notification.created', id: row.id });
      const job: NotificationEmailJob = { ...input, link: input.link ?? null, userId, notificationId: row.id, dedupId: row.id };
      if (pref.email) await queue(env, log).schedule({ path: NOTIFICATION_EMAIL_JOB_PATH, body: job, at: now, dedupId: `email-${row.id}` });
      if (push) await queue(env, log).schedule({ path: NOTIFICATION_PUSH_JOB_PATH, body: job, at: now, dedupId: `push-${row.id}` });
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
