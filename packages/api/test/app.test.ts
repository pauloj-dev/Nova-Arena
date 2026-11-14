import { ApiHealth, Problem } from '@nova/schemas';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp, envFrom, respond, type AppEnv, type DependencyCheck, type LogEntry } from '../src';
import { qstashCheck, redisCheck } from '../src/modules/health';

const NOW = new Date('2026-11-13T12:00:00.000Z');
const ok: DependencyCheck = async () => 'ok';
const off: DependencyCheck = async () => 'not_configured';
const broken: DependencyCheck = async () => {
  throw new Error('conexão recusada');
};

function setup(checks: Partial<Record<'database' | 'redis' | 'qstash', DependencyCheck>> = {}, env: Record<string, string> = {}) {
  const logs: LogEntry[] = [];
  const app = createApp({
    env: envFrom({ NODE_ENV: 'test', ...env }),
    deps: { checks: { database: ok, redis: ok, qstash: ok, ...checks }, now: () => NOW },
    logSink: (e) => logs.push(e),
  });
  return { app, logs };
}

describe('GET /api/v1/health', () => {
  it('tudo no ar: 200, status ok e a resposta segue o contrato', async () => {
    const { app } = setup({}, { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'abcdef1234567' });
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = ApiHealth.parse(await res.json());
    expect(body).toMatchObject({ status: 'ok', version: 'abcdef1', environment: 'preview', checkedAt: NOW.toISOString() });
    expect(body.services.map((s) => [s.key, s.status])).toEqual([
      ['database', 'ok'],
      ['redis', 'ok'],
      ['qstash', 'ok'],
    ]);
  });

  it('serviço ainda não configurado: 200 com status degraded', async () => {
    const { app } = setup({ qstash: off });
    const body = ApiHealth.parse(await (await app.request('/api/v1/health')).json());
    expect(body.status).toBe('degraded');
    expect(body.services.find((s) => s.key === 'qstash')).toMatchObject({ status: 'not_configured', latencyMs: null });
  });

  it('dependência fora: 503 com o motivo, sem derrubar as outras verificações', async () => {
    const { app } = setup({ database: broken });
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(503);
    const body = ApiHealth.parse(await res.json());
    expect(body.status).toBe('down');
    expect(body.services.find((s) => s.key === 'database')).toMatchObject({ status: 'down', detail: 'Fora do ar: conexão recusada.' });
    expect(body.services.find((s) => s.key === 'redis')?.status).toBe('ok');
  });
});

describe('erros, ID de requisição e logs', () => {
  it('rota inexistente: 404 em application/problem+json, com X-Request-Id', async () => {
    const { app } = setup();
    const res = await app.request('/api/v1/nao-existe');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(res.headers.get('x-request-id')).toMatch(/^[\w:.-]+$/);
    expect(Problem.parse(await res.json())).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('reaproveita o ID que veio da borda e registra a requisição em JSON com ele', async () => {
    const { app, logs } = setup();
    const res = await app.request('/api/v1/health', { headers: { 'x-request-id': 'req-123' } });
    expect(res.headers.get('x-request-id')).toBe('req-123');
    expect(logs.find((l) => l.msg === 'requisição')).toMatchObject({ level: 'info', requestId: 'req-123', method: 'GET', path: '/api/v1/health', status: 200 });
  });

  it('ID vindo de fora com caracteres estranhos é trocado por um novo', async () => {
    const { app } = setup();
    const res = await app.request('/api/v1/health', { headers: { 'x-request-id': 'id falso <script>' } });
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('resposta fora do contrato vira 500 CONTRACT_VIOLATION (e quebra o teste da rota)', async () => {
    const { app } = setup();
    const Contract = z.object({ name: z.string() });
    app.route('/', new Hono<AppEnv>().get('/quebrada', (c) => respond(c, Contract, { name: 42 } as unknown as z.infer<typeof Contract>)));
    const res = await app.request('/api/v1/quebrada');
    expect(res.status).toBe(500);
    expect(Problem.parse(await res.json()).code).toBe('CONTRACT_VIOLATION');
  });

  it('erro inesperado: 500 genérico em pt-BR, com a pilha só no log', async () => {
    const { app, logs } = setup();
    app.route('/', new Hono<AppEnv>().get('/explode', () => {
      throw new Error('segredo interno');
    }));
    const res = await app.request('/api/v1/explode');
    const problem = Problem.parse(await res.json());
    expect(res.status).toBe(500);
    expect(problem.code).toBe('INTERNAL');
    expect(JSON.stringify(problem)).not.toContain('segredo interno');
    expect(logs.find((l) => l.msg === 'erro inesperado')).toBeDefined();
  });
});

describe('variáveis de ambiente', () => {
  it('valida formato e diz o que está errado, sem mostrar valores', () => {
    expect(() => envFrom({ DATABASE_URL: 'nao-e-url', AUTH_JWT_SECRET: 'curta' })).toThrow(/DATABASE_URL \(Precisa ser uma URL\.\).*AUTH_JWT_SECRET/);
  });

  it('em produção os serviços do núcleo são obrigatórios', () => {
    expect(() => envFrom({ VERCEL_ENV: 'production' })).toThrow(/DATABASE_URL \(Obrigatória em produção\.\)/);
  });

  it('variável cadastrada vazia vale como ausente', () => {
    expect(envFrom({ DATABASE_URL: '' }).DATABASE_URL).toBeUndefined();
  });

  it('configuração inválida responde 500 CONFIG_INVALID e registra só os nomes', async () => {
    const logs: LogEntry[] = [];
    const app = createApp({ env: () => envFrom({ DATABASE_URL: 'postgres-sem-protocolo' }), logSink: (e) => logs.push(e) });
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(500);
    expect(Problem.parse(await res.json()).code).toBe('CONFIG_INVALID');
    const entry = logs.find((l) => l.msg === 'variáveis de ambiente inválidas');
    expect(entry?.problems).toEqual({ DATABASE_URL: 'Precisa ser uma URL.' });
    expect(JSON.stringify(logs)).not.toContain('postgres-sem-protocolo');
  });
});

describe('verificações padrão de Redis e QStash', () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = envFrom({ KV_REST_API_URL: 'https://redis.exemplo.io', KV_REST_API_TOKEN: 'tok', QSTASH_TOKEN: 'q' });

  it('sem variáveis: não configurado (sem chamar a rede)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await redisCheck(envFrom({}))).toBe('not_configured');
    expect(await qstashCheck(envFrom({}))).toBe('not_configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Redis: PONG com o token no cabeçalho; outra resposta = fora', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ result: 'PONG' })));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await redisCheck(env)).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledWith(new URL('https://redis.exemplo.io/ping'), { headers: { Authorization: 'Bearer tok' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    await expect(redisCheck(env)).rejects.toThrow('HTTP 401');
  });

  it('QStash: leitura autenticada no endereço padrão', async () => {
    const fetchSpy = vi.fn(async () => new Response('[]'));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await qstashCheck(env)).toBe('ok');
    expect(fetchSpy).toHaveBeenCalledWith(new URL('https://qstash.upstash.io/v2/schedules'), { headers: { Authorization: 'Bearer q' } });
  });
});
