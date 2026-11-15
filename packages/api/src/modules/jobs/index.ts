/**
 * Rotas de jobs (issue #76). Não são para pessoas: o QStash chama `/jobs/*` (com assinatura) e o Cron da
 * Vercel chama `/cron/*` (com `CRON_SECRET`). Ficam fora da checagem de `Origin` (não vêm de navegador).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../context';
import { badRequest } from '../../errors';
import { requireCron, requireQStash } from '../../jobs';
import { runRegistrationJob, syncRegistrationWindows } from '../../jobs/registration';
import { revalidateTournaments } from '../../revalidate';

const RegistrationJob = z.object({ tournamentId: z.uuid(), action: z.enum(['open', 'close']) });

export const jobs = new Hono<AppEnv>();

jobs.post('/jobs/tournaments/registration', requireQStash, async (c) => {
  const parsed = RegistrationJob.safeParse(c.get('jobBody'));
  // Mensagem que nunca vai dar certo: registra e recusa.
  if (!parsed.success) {
    c.get('log').warn('job de inscrição com corpo inválido', { errors: parsed.error.issues.length });
    throw badRequest('Corpo do job inválido.', 'INVALID_BODY');
  }
  const changed = await runRegistrationJob(c.get('deps').db(), parsed.data.tournamentId, parsed.data.action, c.get('deps').now());
  if (changed) revalidateTournaments(c);
  return c.json({ ok: true, changed });
});

jobs.get('/cron/tournaments', requireCron, async (c) => {
  const result = await syncRegistrationWindows(c.get('deps').db(), c.get('deps').now());
  if (result.opened || result.closed) {
    c.get('log').info('cron de inscrições', result);
    revalidateTournaments(c);
  }
  return c.json({ ok: true, ...result });
});
