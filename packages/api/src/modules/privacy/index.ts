/**
 * LGPD (issue #115): exportar e excluir os dados pessoais. Porta de `apps/web/mocks/handlers/privacy.ts`.
 *
 * - `POST /me/export`: o arquivo JSON na própria resposta (`Content-Disposition: attachment`). Conta com muito
 *   histórico (mais de `EXPORT_INLINE_LIMIT` linhas) → 202: o job `/jobs/privacy/export` gera o arquivo no Blob
 *   privado e a pessoa é avisada. Uma exportação por hora (limite por conta).
 * - `GET /me/exports` e `GET /me/exports/:id/download`: as exportações geradas em job (só o dono baixa; valem 7 dias).
 * - `GET /me/deletion`: dá para excluir agora? (campeonatos em andamento, inscrições abertas, único Super Admin).
 * - `DELETE /me`: confirma com a senha (quem tem) e a frase; anonimiza a conta (`anonymizeAccount`), apaga os
 *   arquivos do Blob depois do commit e encerra a sessão.
 */
import { DataExportJob, DataExportQueued, DeleteAccountInput, DeletionCheck, PersonalDataExport } from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { auditContext } from '../../auth/admin';
import { verifyPassword } from '../../auth/crypto';
import { clearSessionCookies } from '../../auth/cookies';
import { requireSession } from '../../auth/session';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, HttpProblem, notFound } from '../../errors';
import { requireQStash } from '../../jobs';
import { runJob } from '../../jobs/runner';
import { notify } from '../../notify';
import { anonymizeAccount, buildPersonalExport, deletionBlockers, exportSize } from '../../privacy';
import { enforceLimit, type RateRule } from '../../security';
import type { DataExport } from '@nova/db';
import { messages } from '../../messages/pt-BR';

/** Acima disto, a exportação vai para um job (o arquivo pode passar de alguns MB). */
export const EXPORT_INLINE_LIMIT = 5000;
export const EXPORT_JOB_PATH = '/jobs/privacy/export';
const EXPORT_TTL_MS = 7 * 24 * 3600_000;
const EXPORT_RULE: RateRule = { name: 'data-export', tokens: 3, windowSeconds: 3600 };
const DELETE_RULE: RateRule = { name: 'delete-account', tokens: 5, windowSeconds: 900 };

const toJob = (e: DataExport): DataExportJob => ({
  id: e.id,
  status: e.status,
  createdAt: e.createdAt.toISOString(),
  readyAt: e.readyAt ? e.readyAt.toISOString() : null,
  expiresAt: e.expiresAt.toISOString(),
  downloadUrl: e.status === 'READY' ? `/api/v1/me/exports/${e.id}/download` : null,
  size: e.size,
});

const fileName = (now: Date) => `nova-arena-meus-dados-${now.toISOString().slice(0, 10)}.json`;

export const privacy = new Hono<AppEnv>();

privacy.post('/me/export', async (c) => {
  const session = await requireSession(c);
  const { db: getDb, now: clock, limiter, queue } = c.get('deps');
  const db = getDb();
  const now = clock();
  await enforceLimit(limiter(c.get('env')), EXPORT_RULE, `user:${session.userId}`, now);
  // Sem QStash (local, testes) não há job: o arquivo sai na hora, qualquer que seja o tamanho.
  if (c.get('env').QSTASH_TOKEN && (await exportSize(db, session.userId)) > EXPORT_INLINE_LIMIT) {
    const job = await db.dataExport.create({ data: { userId: session.userId, expiresAt: new Date(now.getTime() + EXPORT_TTL_MS) } });
    await queue(c.get('env'), c.get('log')).schedule({ path: EXPORT_JOB_PATH, body: { exportId: job.id }, at: now, dedupId: `export-${job.id}` });
    return respond(c, DataExportQueued, { queued: true, export: toJob(job) }, 202);
  }
  const data = await buildPersonalExport(db, session.userId, now);
  c.header('Content-Disposition', `attachment; filename="${fileName(now)}"`);
  return respond(c, PersonalDataExport, data);
});

privacy.get('/me/exports', async (c) => {
  const session = await requireSession(c);
  const now = c.get('deps').now();
  const list = await c
    .get('deps')
    .db()
    .dataExport.findMany({ where: { userId: session.userId, expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' }, take: 5 });
  return respond(c, z.array(DataExportJob), list.map(toJob));
});

privacy.get('/me/exports/:id/download', async (c) => {
  const session = await requireSession(c);
  const { db, blob, now } = c.get('deps');
  const id = c.req.param('id');
  const record = /^[0-9a-f-]{36}$/i.test(id) ? await db().dataExport.findUnique({ where: { id } }) : null;
  // De outra pessoa = não existe.
  if (!record || record.userId !== session.userId || record.status !== 'READY' || !record.blobUrl || record.expiresAt <= now()) throw notFound('Exportação');
  const env = c.get('env');
  const token = env.BLOB_PRIVATE_READ_WRITE_TOKEN ?? env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new HttpProblem(503, 'O download está indisponível no momento. Tente mais tarde.', 'UPLOADS_UNAVAILABLE');
  const file = await blob.read(record.blobUrl, token);
  if (!file) throw notFound('Exportação');
  return new Response(file.stream, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName(record.createdAt)}"`, 'Cache-Control': 'private, no-store' },
  });
});

/** Job: gera o arquivo grande, guarda no Blob privado e avisa a pessoa. Idempotente (pronto → nada a fazer). */
export async function runExportJob(c: AppContext, exportId: string): Promise<'ready' | 'skipped'> {
  const { db: getDb, blob, now: clock } = c.get('deps');
  const db = getDb();
  const record = await db.dataExport.findUnique({ where: { id: exportId } });
  if (!record || record.status !== 'PENDING') return 'skipped';
  const env = c.get('env');
  const token = env.BLOB_PRIVATE_READ_WRITE_TOKEN ?? env.BLOB_READ_WRITE_TOKEN;
  if (!token || !blob.putPrivate) {
    await db.dataExport.update({ where: { id: record.id }, data: { status: 'FAILED', error: 'Blob não configurado' } });
    return 'skipped';
  }
  const data = await buildPersonalExport(db, record.userId, clock());
  const saved = await blob.putPrivate(`data-export/${record.userId}/${record.id}.json`, JSON.stringify(data), 'application/json', token);
  await db.dataExport.update({ where: { id: record.id }, data: { status: 'READY', blobUrl: saved.url, size: saved.size, readyAt: clock() } });
  await notify(c, [record.userId], { type: 'ANNOUNCEMENT', title: messages.account.dataExportReady.title, body: messages.account.dataExportReady.body, link: '/minha-conta/privacidade' });
  return 'ready';
}

privacy.post(EXPORT_JOB_PATH, requireQStash, async (c) => {
  const parsed = z.object({ exportId: z.uuid() }).safeParse(c.get('jobBody'));
  if (!parsed.success) throw badRequest('Corpo do job inválido.', 'INVALID_BODY');
  const result = await runJob(c, 'jobs/privacy/export', 'qstash', () => runExportJob(c, parsed.data.exportId));
  return c.json({ result });
});

privacy.get('/me/deletion', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const [blockers, user] = await Promise.all([deletionBlockers(db, session.userId), db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { passwordHash: true } })]);
  return respond(c, DeletionCheck, { canDelete: blockers.length === 0, blockers, hasPassword: Boolean(user.passwordHash) });
});

privacy.delete('/me', async (c) => {
  const session = await requireSession(c);
  const { db: getDb, now: clock, limiter, blob } = c.get('deps');
  const db = getDb();
  await enforceLimit(limiter(c.get('env')), DELETE_RULE, `user:${session.userId}`, clock());
  const input = await body(c, DeleteAccountInput);
  const user = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { passwordHash: true, status: true } });
  if (user.status === 'DELETED') throw notFound('Conta');
  if (user.passwordHash) {
    if (!input.password) throw badRequest('Confira os campos destacados.', 'VALIDATION', { password: 'Informe a sua senha' });
    if (!(await verifyPassword(user.passwordHash, input.password))) throw new HttpProblem(400, 'Senha incorreta.', 'INVALID_PASSWORD', { password: 'Senha incorreta.' });
  }
  const blockers = await deletionBlockers(db, session.userId);
  if (blockers.length > 0) throw conflict(blockers[0]?.message ?? 'Ainda não dá para excluir a conta.', blockers[0]?.code ?? 'DELETION_BLOCKED');

  const outcome = await anonymizeAccount(db, await auditContext(c, 'Pedido do titular (LGPD)'), session.userId, clock());

  // Arquivos: depois do commit e sem derrubar a resposta (o que falhar fica no log e a limpeza diária não acha dono).
  const env = c.get('env');
  for (const file of outcome.blobs) {
    const token = file.access === 'private' ? (env.BLOB_PRIVATE_READ_WRITE_TOKEN ?? env.BLOB_READ_WRITE_TOKEN) : env.BLOB_READ_WRITE_TOKEN;
    if (!token) continue;
    try {
      await blob.remove(file.url, token);
    } catch (error) {
      c.get('log').warn('LGPD: arquivo não apagado do Blob', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  c.get('log').info('conta excluída (LGPD)', { userId: session.userId, files: outcome.blobs.length });
  clearSessionCookies(c);
  c.set('session', null);
  return c.body(null, 204);
});
