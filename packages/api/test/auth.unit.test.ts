/** Autenticação sem banco: senha, JWT, CSRF e limite de tentativas (critérios de aceite da #67). */
import type { PrismaClient } from '@nova/db';
import { Problem } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { createApp, envFrom } from '../src';
import { hashPassword, randomToken, sha256, verifyPassword } from '../src/auth/crypto';
import { signAccessToken, verifyAccessToken } from '../src/auth/jwt';
import { memoryLimiter, RULES } from '../src/security';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: SECRET, NEXT_PUBLIC_SITE_URL: 'https://novaarena.gg' });
const ORIGIN = 'http://localhost';

/** Banco falso: nenhum usuário existe. */
const emptyDb = (() => ({ user: { findUnique: async () => null } })) as unknown as () => PrismaClient;

describe('senha e tokens', () => {
  it('Argon2id: confere a senha certa e recusa a errada', async () => {
    const h = await hashPassword('arena1234');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'arena1234')).toBe(true);
    expect(await verifyPassword(h, 'outra')).toBe(false);
    expect(await verifyPassword(null, 'arena1234')).toBe(false);
  });

  it('tokens aleatórios diferentes e hash estável', () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(sha256('a')).toBe(sha256('a'));
    expect(sha256('a')).toHaveLength(64);
  });

  it('JWT de acesso vale 15 min e carrega sessão e versão', async () => {
    const now = new Date('2026-11-13T12:00:00Z');
    const token = await signAccessToken(env, { sub: 'u1', sid: 's1', sv: 3, tfa: false }, now);
    expect(await verifyAccessToken(env, token, new Date(now.getTime() + 14 * 60_000))).toEqual({ sub: 'u1', sid: 's1', sv: 3, tfa: false });
    expect(await verifyAccessToken(env, token, new Date(now.getTime() + 16 * 60_000))).toBeNull();
    expect(await verifyAccessToken(envFrom({ AUTH_JWT_SECRET: 'outro-segredo-qualquer-com-32-caracteres' }), token, now)).toBeNull();
  });
});

describe('CSRF: checagem de Origin em toda mutação', () => {
  const app = createApp({ env, deps: { db: emptyDb } });

  it('mutação com Origin de outro site = 403', async () => {
    const res = await app.request('/api/v1/auth/logout', { method: 'POST', headers: { Origin: 'https://site-malicioso.com' } });
    expect(res.status).toBe(403);
    expect(Problem.parse(await res.json()).code).toBe('INVALID_ORIGIN');
  });

  it('mutação sem Origin nem Referer = 403', async () => {
    expect((await app.request('/api/v1/auth/logout', { method: 'POST' })).status).toBe(403);
  });

  it('mesmo site (a própria URL ou NEXT_PUBLIC_SITE_URL) passa', async () => {
    expect((await app.request('/api/v1/auth/logout', { method: 'POST', headers: { Origin: ORIGIN } })).status).toBe(204);
    expect((await app.request('/api/v1/auth/logout', { method: 'POST', headers: { Origin: 'https://novaarena.gg' } })).status).toBe(204);
  });

  it('leitura (GET) não exige Origin', async () => {
    const app2 = createApp({ env, deps: { db: emptyDb } });
    const res = await app2.request('/api/v1/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});

describe('limite de tentativas no login', () => {
  it('6ª tentativa de login em 1 min = 429 com Retry-After; outro IP segue livre', async () => {
    const app = createApp({ env, deps: { db: emptyDb } });
    const login = (ip: string) =>
      app.request('/api/v1/auth/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ email: 'ninguem@exemplo.com', password: 'x' }) });
    for (let i = 0; i < 5; i++) {
      const r = await login('198.51.100.1');
      expect(r.status).toBe(401);
      expect(Problem.parse(await r.json()).code).toBe('INVALID_CREDENTIALS');
    }
    const sixth = await login('198.51.100.1');
    expect(sixth.status).toBe(429);
    expect(Problem.parse(await sixth.json()).code).toBe('RATE_LIMITED');
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await login('198.51.100.2')).status).toBe(401);
  });

  it('a janela libera depois de 1 minuto', async () => {
    let t = 0;
    const limiter = memoryLimiter(() => new Date(t));
    for (let i = 0; i < 5; i++) expect((await limiter.limit('ip', RULES.login)).success).toBe(true);
    expect((await limiter.limit('ip', RULES.login)).success).toBe(false);
    t += 61_000;
    expect((await limiter.limit('ip', RULES.login)).success).toBe(true);
  });
});
