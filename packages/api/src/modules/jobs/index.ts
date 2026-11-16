/**
 * Rotas de jobs (issues #76 e #99). Não são para pessoas: o QStash chama `/jobs/*` (com assinatura) e o Cron da
 * Vercel chama `/cron/*` (com `CRON_SECRET`). Sem assinatura ou segredo = 401. `/jobs/*` fica fora da checagem
 * de `Origin` (não vem de navegador).
 *
 * - `GET /cron/sweep` (a cada minuto): janelas de inscrição e reservas vencidas da lista de espera.
 * - `GET /cron/daily-cleanup` (todo dia): convites vencidos, uploads órfãos, tokens e sessões velhos.
 * - `POST /jobs/tournaments/registration`: abre ou fecha as inscrições de um campeonato na data marcada.
 * - `POST /jobs/failures`: aviso do QStash de mensagem que esgotou as tentativas (falha definitiva).
 * - `GET /admin/system/job-failures` e `POST …/:id/resolve`: as falhas na Saúde do Sistema (Admin).
 *
 * Todo job confere o estado atual antes de agir: rodar duas vezes não duplica efeito.
 */
import { JobFailure, JobFailureList } from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, notFound } from '../../errors';
import { ADMIN_ROLES, requireRole } from '../../auth/rbac';
import { requireCron, requireQStash } from '../../jobs';
import { dailyCleanup } from '../../jobs/cleanup';
import { runRegistrationJob } from '../../jobs/registration';
import { recordJobFailure, runJob } from '../../jobs/runner';
import { sweep } from '../../jobs/sweep';
import { revalidateTournaments } from '../../revalidate';

const RegistrationJob = z.object({ tournamentId: z.uuid(), action: z.enum(['open', 'close']) });

/** Corpo do aviso de falha do QStash (o que interessa para registrar). */
const QStashFailure = z.object({
  url: z.string().optional(),
  status: z.number().optional(),
  body: z.string().optional(),
  retried: z.number().optional(),
  sourceMessageId: z.string().optional(),
  sourceBody: z.string().optional(),
});

const decodeBase64 = (value: string | undefined) => {
  if (!value) return '';
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
};

export const jobs = new Hono<AppEnv>();

async function runSweep(c: AppContext) {
  const result = await runJob(c, 'cron:sweep', 'cron', () => sweep(c.get('deps').db(), c.get('deps').now()));
  if (result.opened || result.closed || result.waitlistsSettled) {
    c.get('log').info('varredura do cron', { ...result });
    revalidateTournaments(c);
  }
  return c.json({ ok: true, ...result });
}

jobs.get('/cron/sweep', requireCron, runSweep);
/** Nome antigo (#76), mantido para não quebrar um agendamento já criado. */
jobs.get('/cron/tournaments', requireCron, runSweep);

jobs.get('/cron/daily-cleanup', requireCron, async (c) => {
  const { db, blob, now } = c.get('deps');
  const result = await runJob(c, 'cron:daily-cleanup', 'cron', () => dailyCleanup({ db: db(), blob, env: c.get('env'), log: c.get('log') }, now()));
  c.get('log').info('limpeza diária', { ...result });
  return c.json({ ok: true, ...result });
});

jobs.post('/jobs/tournaments/registration', requireQStash, async (c) => {
  const parsed = RegistrationJob.safeParse(c.get('jobBody'));
  // Mensagem que nunca vai dar certo: registra e recusa (não adianta o QStash tentar de novo).
  if (!parsed.success) {
    c.get('log').warn('job de inscrição com corpo inválido', { errors: parsed.error.issues.length });
    throw badRequest('Corpo do job inválido.', 'INVALID_BODY');
  }
  const { tournamentId, action } = parsed.data;
  const changed = await runJob(c, 'jobs/tournaments/registration', 'qstash', () => runRegistrationJob(c.get('deps').db(), tournamentId, action, c.get('deps').now()));
  if (changed) revalidateTournaments(c);
  return c.json({ ok: true, changed });
});

/** O QStash esgotou as tentativas de uma mensagem: a falha passa a ser definitiva e aparece para o Admin. */
jobs.post('/jobs/failures', requireQStash, async (c) => {
  const parsed = QStashFailure.safeParse(c.get('jobBody'));
  const info = parsed.success ? parsed.data : {};
  const job = info.url ? new URL(info.url, 'https://nova.invalid').pathname.replace(/^\/api\/v1\//, '') : 'desconhecido';
  const response = decodeBase64(info.body).slice(0, 500);
  await recordJobFailure(c, {
    job,
    source: 'qstash',
    error: `Esgotou ${info.retried ?? '?'} tentativas; última resposta HTTP ${info.status ?? '?'}${response ? `: ${response}` : ''}`,
    payload: { messageId: info.sourceMessageId ?? null, body: decodeBase64(info.sourceBody).slice(0, 2000) || null },
  });
  return c.json({ ok: true });
});

// ── Saúde do Sistema (Admin) ─────────────────────────────────────────
const toFailure = (f: { id: string; job: string; source: string; error: string; createdAt: Date; resolvedAt: Date | null }): JobFailure => ({
  id: f.id,
  job: f.job,
  source: f.source === 'cron' ? 'cron' : 'qstash',
  error: f.error,
  createdAt: f.createdAt.toISOString(),
  resolvedAt: f.resolvedAt?.toISOString() ?? null,
});

jobs.get('/admin/system/job-failures', requireRole(...ADMIN_ROLES), async (c) => {
  const db = c.get('deps').db();
  const [open, rows] = await Promise.all([db.jobFailure.count({ where: { resolvedAt: null } }), db.jobFailure.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })]);
  return respond(c, JobFailureList, { open, items: rows.map(toFailure) });
});

jobs.post('/admin/system/job-failures/:id/resolve', requireRole(...ADMIN_ROLES), async (c) => {
  const id = c.req.param('id');
  const db = c.get('deps').db();
  const failure = /^[0-9a-f-]{36}$/i.test(id) ? await db.jobFailure.findUnique({ where: { id } }) : null;
  if (!failure) throw notFound('Falha');
  const saved = failure.resolvedAt ? failure : await db.jobFailure.update({ where: { id }, data: { resolvedAt: c.get('deps').now() } });
  return respond(c, JobFailure, toFailure(saved));
});
