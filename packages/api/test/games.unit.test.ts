/** Catálogo de jogos sem banco (issue #74): modelo de pontuação inválido é recusado com erro por campo. */
import type { PrismaClient } from '@nova/db';
import { Problem } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { createApp, envFrom } from '../src';
import { signAccessToken } from '../src/auth/jwt';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: SECRET });
const ADMIN = '33333333-3333-4333-8333-333333333333';

/** Banco falso: só a sessão e os papéis do Admin; o modelo inválido não pode chegar a gravar. */
const adminDb = (roles: string[]) =>
  (() => ({
    session: { findUnique: async () => ({ revokedAt: null, userId: ADMIN, twoFactorVerified: true, user: { status: 'ACTIVE', sessionVersion: 0 } }) },
    userRole: { findMany: async () => roles.map((role) => ({ role })) },
    // `/admin/*` exige 2FA ativo (RNF-08).
    twoFactor: { findUnique: async () => ({ enabledAt: new Date() }) },
    $transaction: async () => {
      throw new Error('modelo inválido não deveria chegar ao banco');
    },
  })) as unknown as () => PrismaClient;

async function post(roles: string[], body: unknown) {
  const app = createApp({ env, deps: { db: adminDb(roles) } });
  const token = await signAccessToken(env, { sub: ADMIN, sid: 's1', sv: 0, tfa: true, roles: [] }, new Date());
  return app.request('/api/v1/admin/games/free-fire/scoring-models', { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', Cookie: `na_at=${token}` }, body: JSON.stringify(body) });
}

describe('modelo de pontuação', () => {
  const valid = { name: 'Kills dobradas', matchType: 'BATTLE_ROYALE', rules: [{ type: 'PER_UNIT', stat: 'kills', points: 2 }], tiebreakers: ['points', 'kills'], isDefault: false };

  it('Modelo de pontuação inválido é recusado com erro por campo (motor)', async () => {
    const res = await post(['ADMIN', 'PARTICIPANT'], { ...valid, name: '   ', rules: [{ type: 'MULTIPLIER', factor: 2 }] });
    expect(res.status).toBe(400);
    const problem = Problem.parse(await res.json());
    expect(problem.code).toBe('VALIDATION');
    expect(problem.errors?.name).toBe('Informe o nome do modelo.');
    expect(Object.keys(problem.errors ?? {}).some((k) => k === 'rules' || k.startsWith('rules.'))).toBe(true);
  });

  it('formato errado já cai no schema, com o caminho do campo', async () => {
    const res = await post(['ADMIN'], { ...valid, rules: [{ type: 'PER_UNIT', stat: 'kills', points: 'muitos' }] });
    const problem = Problem.parse(await res.json());
    expect(res.status).toBe(400);
    expect(Object.keys(problem.errors ?? {})).toContain('rules.0.points');
  });

  it('organizador não escreve no catálogo (403)', async () => {
    expect((await post(['ORGANIZER', 'PARTICIPANT'], valid)).status).toBe(403);
  });
});
