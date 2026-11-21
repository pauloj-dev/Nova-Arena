/** Saúde do Sistema × Sentry (issue #116): o ponto de integração nunca quebra a tela, com ou sem conta. */
import { describe, expect, it } from 'vitest';
import { envFrom } from '../src';
import { sentryErrorStats } from '../src/observability';

const now = new Date('2026-11-21T12:00:00Z');
const base = { NODE_ENV: 'test' as const, SENTRY_DSN: 'https://chave@o1.ingest.us.sentry.io/123' };

describe('sentryErrorStats', () => {
  it('sem DSN: não configurado', async () => {
    expect(await sentryErrorStats(envFrom({ NODE_ENV: 'test' }), now)).toEqual({ configured: false, eventsLastHour: null, reason: 'no-dsn' });
  });

  it('com DSN e sem token de leitura: recebe erros, mas sem contagem', async () => {
    expect(await sentryErrorStats(envFrom(base), now)).toEqual({ configured: true, eventsLastHour: null, reason: 'no-read-token' });
  });

  it('soma a última hora pela API de estatísticas do projeto, com o token no cabeçalho', async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify([[1763722800, 3], [1763726400, 4]]), { status: 200 });
    }) as typeof fetch;
    const env = envFrom({ ...base, SENTRY_AUTH_TOKEN: 'sntrys_teste', SENTRY_ORG: 'nova-arena', SENTRY_PROJECT: 'web' });
    expect(await sentryErrorStats(env, now, fetcher)).toEqual({ configured: true, eventsLastHour: 7, reason: null });
    expect(calls[0]?.url).toBe(`https://sentry.io/api/0/projects/nova-arena/web/stats/?stat=received&resolution=1h&since=${now.getTime() / 1000 - 3600}`);
    expect(calls[0]?.auth).toBe('Bearer sntrys_teste');
  });

  it('resposta inesperada ou falha de rede viram "sem dados", nunca erro', async () => {
    const env = envFrom({ ...base, SENTRY_AUTH_TOKEN: 't', SENTRY_ORG: 'o', SENTRY_PROJECT: 'p' });
    expect((await sentryErrorStats(env, now, (async () => new Response('{"detail":"x"}', { status: 200 })) as typeof fetch)).reason).toBe('failed');
    expect((await sentryErrorStats(env, now, (async () => new Response('', { status: 401 })) as typeof fetch)).reason).toBe('failed');
    expect((await sentryErrorStats(env, now, (async () => Promise.reject(new Error('rede'))) as typeof fetch)).reason).toBe('failed');
  });
});
