/**
 * Execução dos jobs (issue #99). Toda rodada passa por `runJob`: se quebrar, a falha fica registrada em
 * `job_failures` (aparece na Saúde do Sistema) e a resposta é 500 — o QStash tenta de novo; o Cron roda de novo
 * no próximo horário. Quando o QStash esgota as tentativas, ele chama `/jobs/failures` e a falha vira definitiva.
 */
import type { Prisma } from '@nova/db';
import type { AppContext } from '../context';
import { HttpProblem } from '../errors';

export async function recordJobFailure(c: AppContext, failure: { job: string; source: 'qstash' | 'cron'; error: string; payload?: unknown }): Promise<void> {
  try {
    await c
      .get('deps')
      .db()
      .jobFailure.create({ data: { job: failure.job.slice(0, 200), source: failure.source, error: failure.error.slice(0, 2000), payload: (failure.payload ?? undefined) as Prisma.InputJsonValue | undefined } });
  } catch (error) {
    // Sem banco não há onde registrar: fica no log, que a Vercel guarda.
    c.get('log').error('não foi possível registrar a falha do job', { job: failure.job, error: String(error) });
  }
}

export async function runJob<T>(c: AppContext, job: string, source: 'qstash' | 'cron', fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    // Erro esperado (corpo inválido, 4xx) não é falha de infraestrutura.
    if (error instanceof HttpProblem && error.status < 500) throw error;
    const message = error instanceof Error ? error.message : String(error);
    c.get('log').error('job falhou', { job, source, error: message });
    try {
      c.get('deps').reportError(error, { job, source });
    } catch {
      // O monitoramento nunca derruba o job.
    }
    // No QStash a falha só é definitiva depois das tentativas (aviso em `/jobs/failures`); no Cron, toda rodada conta.
    if (source === 'cron') await recordJobFailure(c, { job, source, error: message });
    throw new HttpProblem(500, 'O job falhou e será tentado de novo.', 'JOB_FAILED');
  }
}
