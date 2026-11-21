/**
 * Módulo `push` (issue #109): notificações push no PWA (Web Push com VAPID), pelo mesmo `notify()` das
 * notificações do site e do e-mail.
 *
 * - `GET /push/public-key`: a chave pública VAPID (503 `PUSH_UNAVAILABLE` sem as chaves).
 * - `POST /me/push-subscriptions`: guarda a assinatura do aparelho (o mesmo `endpoint` de novo só atualiza; se o
 *   aparelho trocou de conta, a assinatura passa para a conta nova).
 * - `DELETE /me/push-subscriptions?endpoint=…`: cancela a deste aparelho.
 * - `POST /jobs/notifications/push` (QStash): envia para todos os aparelhos da pessoa. Idempotente: `pushSentAt`
 *   marcado → nada a fazer; assinatura que o navegador cancelou (404/410) é apagada; se nenhum aparelho recebeu
 *   por erro do serviço de push, responde 500 para o QStash tentar de novo (o service worker usa o id da
 *   notificação como `tag`: uma repetição substitui a anterior em vez de aparecer duas vezes).
 */
import { Ok, PushPayload, PushPublicKey, PushSubscriptionInput } from '@nova/schemas';
import { Hono } from 'hono';
import type { AppContext, AppEnv } from '../../context';
import { body, respond } from '../../context';
import { HttpProblem } from '../../errors';
import { requireSession } from '../../auth/session';
import { requireQStash } from '../../jobs';
import { runJob } from '../../jobs/runner';
import { NOTIFICATION_PUSH_JOB_PATH, preferencesOf } from '../../notify';
import { parseJobBody, type NotificationJobBody } from '../notifications/jobs';

export const push = new Hono<AppEnv>();

push.get('/push/public-key', (c) => {
  const key = c.get('env').VAPID_PUBLIC_KEY;
  if (!key || !c.get('env').VAPID_PRIVATE_KEY) throw new HttpProblem(503, 'As notificações no aparelho não estão disponíveis no momento.', 'PUSH_UNAVAILABLE');
  return respond(c, PushPublicKey, { publicKey: key });
});

push.post('/me/push-subscriptions', async (c) => {
  const session = await requireSession(c);
  const input = await body(c, PushSubscriptionInput);
  const { db, now } = c.get('deps');
  const userAgent = c.req.header('user-agent')?.slice(0, 300) ?? null;
  const data = { userId: session.userId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent, lastUsedAt: now() };
  await db().pushSubscription.upsert({ where: { endpoint: input.endpoint }, create: { endpoint: input.endpoint, ...data }, update: data });
  return respond(c, Ok, { ok: true as const }, 201);
});

push.delete('/me/push-subscriptions', async (c) => {
  const session = await requireSession(c);
  const endpoint = c.req.query('endpoint') ?? '';
  // Só a própria assinatura: a de outra conta "não existe" (e repetir não dá erro).
  await c.get('deps').db().pushSubscription.deleteMany({ where: { endpoint, userId: session.userId } });
  return c.body(null, 204);
});

type PushOutcome = { sent: number; removed: number; skipped?: true; alreadySent?: true };

export async function deliverNotificationPush(c: AppContext, job: NotificationJobBody): Promise<PushOutcome> {
  const { db: getDb, push: sender, now } = c.get('deps');
  const db = getDb();
  const log = c.get('log');
  if (!job.notificationId) return { sent: 0, removed: 0, skipped: true };
  const notification = await db.notification.findUnique({ where: { id: job.notificationId } });
  if (!notification || notification.userId !== job.userId) return { sent: 0, removed: 0, skipped: true };
  if (notification.pushSentAt) return { sent: 0, removed: 0, alreadySent: true };
  const pref = (await preferencesOf(db, [job.userId], notification.type)).get(job.userId);
  const user = await db.user.findUnique({ where: { id: job.userId }, select: { status: true } });
  if ((pref && !pref.push) || user?.status !== 'ACTIVE') return { sent: 0, removed: 0, skipped: true };
  const targets = await db.pushSubscription.findMany({ where: { userId: job.userId } });
  const payload: PushPayload = { id: notification.id, type: notification.type, title: notification.title, body: notification.body, link: notification.link };
  const text = JSON.stringify(PushPayload.parse(payload));
  const client = sender(c.get('env'), log);
  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (const target of targets) {
    try {
      const result = await client.send(target, text);
      if (result === 'gone') {
        await db.pushSubscription.deleteMany({ where: { id: target.id } });
        removed += 1;
      } else {
        sent += 1;
        await db.pushSubscription.updateMany({ where: { id: target.id }, data: { lastUsedAt: now() } });
      }
    } catch (error) {
      failed += 1;
      log.warn('falha ao enviar push', { subscriptionId: target.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  // Nenhum aparelho recebeu por erro do serviço: tenta de novo (os que já receberam não existem nesse caso).
  if (sent === 0 && failed > 0) throw new Error(`push falhou em ${failed} aparelho(s)`);
  await db.notification.updateMany({ where: { id: notification.id, pushSentAt: null }, data: { pushSentAt: now() } });
  return { sent, removed };
}

export const pushJobs = new Hono<AppEnv>();

pushJobs.post(NOTIFICATION_PUSH_JOB_PATH, requireQStash, async (c) => {
  const job = parseJobBody(c, 'push de notificação');
  const outcome = await runJob(c, 'notifications:push', 'qstash', () => deliverNotificationPush(c, job));
  return c.json({ ok: true, ...outcome });
});
