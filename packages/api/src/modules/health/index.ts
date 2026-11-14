/**
 * `GET /health`: estado de cada dependência (banco, Redis, QStash), sem dados sensíveis.
 * 200 quando nada está fora (serviço ainda não configurado aparece como `not_configured` e deixa o
 * estado geral `degraded`); 503 quando alguma dependência configurada não responde.
 */
import { ApiHealth, type HealthServiceStatus } from '@nova/schemas';
import { Hono } from 'hono';
import type { z } from 'zod';
import { respond, type AppEnv, type DependencyCheck } from '../../context';
import type { Env } from '../../env';
import { pingDb } from '@nova/db';

const SERVICES = [
  { key: 'database', name: 'Banco de dados (Neon Postgres)' },
  { key: 'redis', name: 'Cache (Upstash Redis)' },
  { key: 'qstash', name: 'Fila de tarefas (Upstash QStash)' },
] as const;

/** Tempo máximo de cada verificação: health lento é health fora. */
const CHECK_TIMEOUT_MS = 3000;

type Status = z.infer<typeof HealthServiceStatus>;

async function runCheck(check: DependencyCheck, env: Env): Promise<{ status: Status; latencyMs: number | null; detail: string }> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`sem resposta em ${CHECK_TIMEOUT_MS / 1000} s`)), CHECK_TIMEOUT_MS);
    });
    const result = await Promise.race([check(env), timeout]);
    if (result === 'not_configured') return { status: 'not_configured', latencyMs: null, detail: 'Ainda não configurado neste ambiente.' };
    return { status: 'ok', latencyMs: Math.round(performance.now() - started), detail: 'Respondendo.' };
  } catch (error) {
    return { status: 'down', latencyMs: Math.round(performance.now() - started), detail: `Fora do ar: ${error instanceof Error ? error.message : 'erro desconhecido'}.` };
  } finally {
    clearTimeout(timer);
  }
}

export const health = new Hono<AppEnv>().get('/health', async (c) => {
  const env = c.get('env');
  const { checks, now } = c.get('deps');
  const results = await Promise.all(SERVICES.map(async (s) => ({ ...s, ...(await runCheck(checks[s.key], env)) })));
  const status: ApiHealth['status'] = results.some((r) => r.status === 'down') ? 'down' : results.some((r) => r.status === 'not_configured') ? 'degraded' : 'ok';
  const body: ApiHealth = {
    status,
    version: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    environment: env.VERCEL_ENV ?? env.NODE_ENV,
    checkedAt: now().toISOString(),
    services: results.map(({ key, name, status: s, latencyMs, detail }) => ({ key, name, status: s, latencyMs, detail })),
  };
  // Health não pode ficar em cache: é ele que a monitoração consulta.
  c.header('Cache-Control', 'no-store');
  return respond(c, ApiHealth, body, status === 'down' ? 503 : 200);
});

// ── Verificações padrão ───────────────────────────────────────────────

/** Upstash Redis pela API REST: `GET /ping` responde `{ "result": "PONG" }`. */
export const redisCheck: DependencyCheck = async (env) => {
  if (!env.KV_REST_API_URL || !env.KV_REST_API_TOKEN) return 'not_configured';
  const res = await fetch(new URL('/ping', env.KV_REST_API_URL), { headers: { Authorization: `Bearer ${env.KV_REST_API_TOKEN}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { result?: string };
  if (data.result !== 'PONG') throw new Error('resposta inesperada');
  return 'ok';
};

/** QStash: uma leitura autenticada simples (lista de agendamentos) confirma URL e token. */
export const qstashCheck: DependencyCheck = async (env) => {
  if (!env.QSTASH_TOKEN) return 'not_configured';
  const base = env.QSTASH_URL ?? 'https://qstash.upstash.io';
  const res = await fetch(new URL('/v2/schedules', base), { headers: { Authorization: `Bearer ${env.QSTASH_TOKEN}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return 'ok';
};

/** Banco: `SELECT 1` pela conexão com pooler (`DATABASE_URL`). */
export const databaseCheck: DependencyCheck = async (env) => {
  if (!env.DATABASE_URL) return 'not_configured';
  await pingDb();
  return 'ok';
};
