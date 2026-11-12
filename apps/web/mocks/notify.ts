/**
 * Notificações da API simulada: grava para cada destinatário (respeitando as preferências)
 * e avisa o canal `user:{id}`. É o ponto único que os módulos chamam; a API real fará o
 * mesmo e, além disso, enfileirará o e-mail (plano B2.10).
 */
import type { NotificationType } from '@nova/schemas';
import { publish } from './bus';
import { collection, nowIso, save, uid } from './db';

export interface DbNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  /** No protótipo o e-mail não é enviado; fica registrado se teria sido. */
  emailQueued: boolean;
  createdAt: string;
}
export interface DbNotificationPreference {
  userId: string;
  type: NotificationType;
  inApp: boolean;
  email: boolean;
}

export const notifications = () => collection<DbNotification>('notifications');
export const notificationPreferences = () => collection<DbNotificationPreference>('notificationPreferences');

export function preferenceOf(userId: string, type: NotificationType): { inApp: boolean; email: boolean } {
  // Avisos da moderação não podem ser desligados.
  if (type === 'SANCTION') return { inApp: true, email: true };
  const pref = notificationPreferences().find((p) => p.userId === userId && p.type === type);
  return pref ? { inApp: pref.inApp, email: pref.email } : { inApp: true, email: true };
}

export function notify(userIds: Iterable<string>, type: NotificationType, title: string, body: string, link: string | null = null): void {
  const list = notifications();
  for (const userId of new Set(userIds)) {
    const pref = preferenceOf(userId, type);
    if (!pref.inApp && !pref.email) continue;
    const n: DbNotification = { id: uid('n'), userId, type, title, body, link, readAt: pref.inApp ? null : nowIso(), emailQueued: pref.email, createdAt: nowIso() };
    list.push(n);
    if (pref.inApp) publish(`user:${userId}`, { type: 'notification.created', id: n.id });
  }
  save();
}
