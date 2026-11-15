/**
 * Jobs (issue #76, ADR-008): mensagens agendadas no QStash e um Cron que corrige o que ficou para trás.
 *
 * - `Queue.schedule`: publica no QStash para rodar numa data (`notBefore`), com id de deduplicação. Sem QStash
 *   (local, testes), só registra no log: o Cron cobre.
 * - `requireQStash`: a rota do job só aceita mensagem assinada pelo QStash (chave atual ou a próxima).
 * - `requireCron`: a rota do Cron só aceita `Authorization: Bearer <CRON_SECRET>` (como a Vercel envia).
 * - Todo job é **idempotente**: rodar de novo não muda nada (a condição é conferida no banco na hora).
 */
import { Client, Receiver } from '@upstash/qstash';
import type { MiddlewareHandler } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import type { AppEnv } from '../context';
import type { Env } from '../env';
import type { Logger } from '../logger';
import { HttpProblem } from '../errors';

export interface ScheduledJob {
  /** Caminho dentro da API, ex.: `/jobs/tournaments/registration`. */
  path: string;
  body: unknown;
  /** Quando deve rodar. */
  at: Date;
  /** Mesmo id = mesma mensagem (o QStash descarta a repetida). */
  dedupId: string;
}

export interface Queue {
  schedule(job: ScheduledJob): Promise<void>;
}

export function qstashQueue(env: Env, log: Logger): Queue {
  const base = env.NEXT_PUBLIC_SITE_URL;
  if (!env.QSTASH_TOKEN || !base) {
    return { schedule: async (job) => log.info('job não agendado (sem QStash neste ambiente); o Cron cobre', { path: job.path, at: job.at.toISOString() }) };
  }
  const client = new Client({ token: env.QSTASH_TOKEN, ...(env.QSTASH_URL ? { baseUrl: env.QSTASH_URL } : {}) });
  return {
    async schedule(job) {
      await client.publishJSON({
        url: `${base}/api/v1${job.path}`,
        body: job.body,
        notBefore: Math.max(Math.floor(job.at.getTime() / 1000), Math.floor(Date.now() / 1000)),
        deduplicationId: job.dedupId,
        retries: 3,
      });
    },
  };
}

/** Só mensagens assinadas pelo QStash passam. O corpo lido fica em `c.get('jobBody')`. */
export const requireQStash: MiddlewareHandler<AppEnv> = async (c, next) => {
  const env = c.get('env');
  const signature = c.req.header('upstash-signature');
  const raw = await c.req.text();
  if (!env.QSTASH_CURRENT_SIGNING_KEY || !env.QSTASH_NEXT_SIGNING_KEY || !signature) throw new HttpProblem(401, 'Assinatura do job ausente.', 'JOB_UNSIGNED');
  const receiver = new Receiver({ currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY, nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY });
  // A mensagem foi assinada para o endereço público (o mesmo usado ao agendar), não para o host interno.
  const url = env.NEXT_PUBLIC_SITE_URL ? `${env.NEXT_PUBLIC_SITE_URL}${c.req.path}` : c.req.url;
  const valid = await receiver.verify({ signature, body: raw, url }).catch(() => false);
  if (!valid) throw new HttpProblem(401, 'Assinatura do job inválida.', 'JOB_UNSIGNED');
  c.set('jobBody', raw ? (JSON.parse(raw) as unknown) : null);
  await next();
};

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Só o Cron da Vercel (com o segredo) passa. */
export const requireCron: MiddlewareHandler<AppEnv> = async (c, next) => {
  const secret = c.get('env').CRON_SECRET;
  const header = c.req.header('authorization') ?? '';
  if (!secret || !sameSecret(header, `Bearer ${secret}`)) throw new HttpProblem(401, 'Acesso negado.', 'CRON_UNAUTHORIZED');
  await next();
};
