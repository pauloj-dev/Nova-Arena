/** Squads sem banco (issue #78): tentativas de código de convite têm limite por IP (força bruta). */
import type { PrismaClient } from '@nova/db';
import { Problem } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { createApp, envFrom } from '../src';

const env = envFrom({ NODE_ENV: 'test' });
/** Banco falso: nenhum convite existe (todo código está errado). */
const noInvites = (() => ({ teamInvite: { findUnique: async () => null } })) as unknown as () => PrismaClient;

describe('código de convite', () => {
  it('código errado = 404; depois de 20 tentativas no minuto, 429 até a janela passar', async () => {
    let now = new Date('2026-11-14T12:00:00Z');
    const app = createApp({ env, deps: { db: noInvites, now: () => now } });
    const tryCode = (ip: string) => app.request('/api/v1/team-invites/ABC123', { headers: { 'x-forwarded-for': ip } });

    for (let i = 0; i < 20; i += 1) expect((await tryCode('198.51.100.1')).status).toBe(404);
    const blocked = await tryCode('198.51.100.1');
    expect(blocked.status).toBe(429);
    expect(Problem.parse(await blocked.json()).code).toBe('TOO_MANY_ATTEMPTS');
    expect(blocked.headers.get('retry-after')).toBeTruthy();

    // Outro IP não é afetado; passado o minuto, volta a tentar.
    expect((await tryCode('198.51.100.2')).status).toBe(404);
    now = new Date(now.getTime() + 61_000);
    expect((await tryCode('198.51.100.1')).status).toBe(404);
  });
});
