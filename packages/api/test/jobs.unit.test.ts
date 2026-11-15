/** Jobs sem banco (issue #76): assinatura do QStash, segredo do Cron e a fila sem QStash. */
import type { PrismaClient } from '@nova/db';
import { Problem } from '@nova/schemas';
import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { createApp, envFrom } from '../src';
import { qstashQueue } from '../src/jobs';
import { scheduleRegistrationWindow } from '../src/jobs/registration';
import { createLogger } from '../src/logger';

const KEYS = { QSTASH_CURRENT_SIGNING_KEY: 'chave-atual-de-teste', QSTASH_NEXT_SIGNING_KEY: 'chave-seguinte-de-teste' };
const env = envFrom({ NODE_ENV: 'test', NEXT_PUBLIC_SITE_URL: 'https://novaarena.gg', CRON_SECRET: 'segredo-do-cron-de-teste', ...KEYS });
const JOB = '/api/v1/jobs/tournaments/registration';

/** Banco falso: o job roda numa transação em que nada está pendente (o campeonato não muda). */
const calls: string[] = [];
const fakeDb = (() => ({
  $transaction: async (fn: (tx: unknown) => unknown) =>
    fn({
      $executeRaw: async () => 0,
      tournament: {
        updateMany: async () => {
          calls.push('updateMany');
          return { count: 0 };
        },
        findMany: async () => [],
      },
    }),
  tournament: { findMany: async () => [] },
})) as unknown as () => PrismaClient;

async function sign(body: string, key = KEYS.QSTASH_CURRENT_SIGNING_KEY, url = `https://novaarena.gg${JOB}`) {
  const hash = createHash('sha256').update(body).digest('base64url');
  return new SignJWT({ body: hash })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('Upstash')
    .setSubject(url)
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(key));
}

const app = createApp({ env, deps: { db: fakeDb } });
const body = JSON.stringify({ tournamentId: '44444444-4444-4444-8444-444444444444', action: 'open' });
// Sem `Origin`: o QStash não é navegador. A rota de job é a única mutação liberada disso.
const post = (headers: Record<string, string>, raw = body) => app.request(JOB, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: raw });

describe('job assinado pelo QStash', () => {
  it('sem assinatura ou com assinatura forjada: 401', async () => {
    expect(Problem.parse(await (await post({})).json()).code).toBe('JOB_UNSIGNED');
    expect((await post({ 'Upstash-Signature': await sign(body, 'chave-errada') })).status).toBe(401);
    // Assinatura de outro corpo (adulterado no caminho).
    expect((await post({ 'Upstash-Signature': await sign('{"outro":1}') }))).toHaveProperty('status', 401);
  });

  it('assinatura válida (chave atual ou a próxima) roda o job; corpo inválido é recusado', async () => {
    const ok = await post({ 'Upstash-Signature': await sign(body) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, changed: false });
    expect((await post({ 'Upstash-Signature': await sign(body, KEYS.QSTASH_NEXT_SIGNING_KEY) })).status).toBe(200);
    const bad = '{"tournamentId":"x"}';
    expect((await post({ 'Upstash-Signature': await sign(bad) }, bad)).status).toBe(400);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('outras mutações continuam exigindo Origin do site', async () => {
    const res = await app.request('/api/v1/auth/logout', { method: 'POST' });
    expect(Problem.parse(await res.json()).code).toBe('INVALID_ORIGIN');
  });
});

describe('Cron', () => {
  it('só com o segredo certo', async () => {
    expect((await app.request('/api/v1/cron/tournaments')).status).toBe(401);
    expect((await app.request('/api/v1/cron/tournaments', { headers: { Authorization: 'Bearer outro' } })).status).toBe(401);
    const ok = await app.request('/api/v1/cron/tournaments', { headers: { Authorization: 'Bearer segredo-do-cron-de-teste' } });
    expect(await ok.json()).toEqual({ ok: true, opened: 0, closed: 0 });
  });

  it('sem CRON_SECRET configurado, ninguém entra', async () => {
    const off = createApp({ env: envFrom({ NODE_ENV: 'test' }), deps: { db: fakeDb } });
    expect((await off.request('/api/v1/cron/tournaments', { headers: { Authorization: 'Bearer ' } })).status).toBe(401);
  });
});

describe('agendamento', () => {
  it('sem QStash, só registra no log (o Cron cobre)', async () => {
    const lines: string[] = [];
    const log = createLogger((entry) => lines.push(entry.msg));
    const queue = qstashQueue(envFrom({ NODE_ENV: 'test' }), log);
    await scheduleRegistrationWindow(queue, { id: 't1', registrationOpensAt: new Date(Date.now() + 60_000), registrationClosesAt: new Date(Date.now() + 120_000) }, new Date());
    expect(lines.filter((l) => l.includes('job não agendado'))).toHaveLength(2);
  });

  it('agenda abertura (se futura) e fechamento, com id de deduplicação estável', async () => {
    const schedule = vi.fn(async () => undefined);
    const now = new Date('2026-11-14T12:00:00Z');
    await scheduleRegistrationWindow({ schedule }, { id: 't1', registrationOpensAt: new Date('2026-11-13T12:00:00Z'), registrationClosesAt: new Date('2026-11-20T12:00:00Z') }, now);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({ body: { tournamentId: 't1', action: 'close' }, dedupId: `close-t1-${new Date('2026-11-20T12:00:00Z').getTime()}` }));
  });
});
