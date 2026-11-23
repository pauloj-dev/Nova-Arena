/**
 * `POST /jobs/notifications/email` (issue #98): o e-mail de uma notificação, agendado por `notify()` no QStash.
 *
 * Idempotente — a mesma mensagem entregue duas vezes (ou uma nova tentativa depois de falha) não duplica o e-mail:
 * 1. `emailSentAt` preenchido → nada a fazer;
 * 2. o envio leva a chave de idempotência `notification-<id>` (o Resend devolve o envio original por 24 h se a
 *    primeira tentativa chegou a sair mas a resposta se perdeu);
 * 3. depois do envio, `emailSentAt` é marcado numa atualização condicional.
 *
 * Falha do Resend → 500 → o QStash tenta de novo (e, esgotadas as tentativas, `/jobs/failures` registra).
 * Respeita a preferência **na hora do envio** (a pessoa pode ter desligado o e-mail do tipo nesse meio-tempo) e só
 * manda para e-mail confirmado de conta ativa.
 */
import { NotificationType } from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext, AppEnv } from '../../context';
import { badRequest } from '../../errors';
import { siteUrl } from '../../auth/email-tokens';
import { requireQStash } from '../../jobs';
import { runJob } from '../../jobs/runner';
import { NOTIFICATION_EMAIL_JOB_PATH, preferencesOf } from '../../notify';

export const NotificationJobBody = z.object({
  userId: z.uuid(),
  notificationId: z.uuid().nullable(),
  type: NotificationType,
  title: z.string(),
  body: z.string(),
  link: z.string().nullable().optional(),
  dedupId: z.string(),
});
export type NotificationJobBody = z.infer<typeof NotificationJobBody>;

export function parseJobBody(c: AppContext, what: string): NotificationJobBody {
  const parsed = NotificationJobBody.safeParse(c.get('jobBody'));
  // Mensagem que nunca vai dar certo: registra e recusa (não adianta o QStash tentar de novo).
  if (!parsed.success) {
    c.get('log').warn(`job de ${what} com corpo inválido`, { errors: parsed.error.issues.length });
    throw badRequest('Corpo do job inválido.', 'INVALID_BODY');
  }
  return parsed.data;
}

/** Link da notificação como endereço completo (só caminhos do próprio site; o resto cai na lista). */
export function absoluteLink(c: AppContext, link: string | null | undefined): string {
  return siteUrl(c, link && link.startsWith('/') && !link.startsWith('//') ? link : '/notificacoes');
}

type EmailOutcome = 'sent' | 'already-sent' | 'skipped';

export async function deliverNotificationEmail(c: AppContext, job: NotificationJobBody): Promise<EmailOutcome> {
  const { db: getDb, mailer, now } = c.get('deps');
  const db = getDb();
  if (!job.notificationId) return 'skipped';
  const notification = await db.notification.findUnique({ where: { id: job.notificationId }, select: { id: true, userId: true, type: true, title: true, body: true, link: true, emailSentAt: true } });
  // Apagada (conta excluída) ou de outra pessoa: nada a fazer.
  if (!notification || notification.userId !== job.userId) return 'skipped';
  if (notification.emailSentAt) return 'already-sent';
  const user = await db.user.findUnique({ where: { id: job.userId }, select: { email: true, nickname: true, emailVerified: true, status: true } });
  if (!user || user.status !== 'ACTIVE' || !user.emailVerified) return 'skipped';
  const pref = (await preferencesOf(db, [job.userId], notification.type)).get(job.userId);
  if (pref && !pref.email) return 'skipped';
  await mailer(c.get('env'), c.get('log')).send(
    user.email,
    {
      template: 'NOTIFICATION',
      data: { type: notification.type, nickname: user.nickname, title: notification.title, body: notification.body, link: absoluteLink(c, notification.link), preferencesLink: siteUrl(c, '/minha-conta/notificacoes') },
    },
    { idempotencyKey: `notification-${notification.id}` },
  );
  await db.notification.updateMany({ where: { id: notification.id, emailSentAt: null }, data: { emailSentAt: now() } });
  return 'sent';
}

export const notificationJobs = new Hono<AppEnv>();

notificationJobs.post(NOTIFICATION_EMAIL_JOB_PATH, requireQStash, async (c) => {
  const job = parseJobBody(c, 'e-mail de notificação');
  const outcome = await runJob(c, 'notifications:email', 'qstash', () => deliverNotificationEmail(c, job));
  return c.json({ ok: true, outcome });
});
