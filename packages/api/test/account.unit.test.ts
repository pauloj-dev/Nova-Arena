/** Conta sem banco (issue #69): proteção contra bots, senha fraca ou vazada e descrição do aparelho. */
import type { PrismaClient } from '@nova/db';
import { Problem } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { createApp, envFrom } from '../src';
import { weakPasswordReason } from '../src/auth/password-policy';
import { describeDevice, maskIp } from '../src/modules/account';

const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!' });
const ORIGIN = 'http://localhost';
/** Banco falso: ninguém existe e nenhum token de e-mail é válido. */
const emptyDb = (() => ({ user: { findUnique: async () => null }, emailToken: { findUnique: async () => null } })) as unknown as () => PrismaClient;
const signup = { email: 'nova@exemplo.com', nickname: 'NovaJogadora', password: 'cavalo-bateria-42', birthDate: '2000-01-01', acceptTerms: true };

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(`/api/v1${path}`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('proteção contra bots', () => {
  const app = createApp({ env, deps: { db: emptyDb, botCheck: async () => true, breached: async () => false } });

  it('cadastro de robô = 403 BOT_DETECTED, antes de tocar no banco', async () => {
    const res = await post(app, '/auth/register', signup);
    expect(res.status).toBe(403);
    expect(Problem.parse(await res.json()).code).toBe('BOT_DETECTED');
  });

  it('recuperação de senha de robô = 403', async () => {
    expect((await post(app, '/auth/forgot-password', { email: 'a@exemplo.com' })).status).toBe(403);
  });

  it('serviço de checagem fora do ar não bloqueia gente de verdade', async () => {
    const down = createApp({ env, deps: { db: emptyDb, botCheck: async () => Promise.reject(new Error('fora do ar')), breached: async () => false } });
    expect((await post(down, '/auth/forgot-password', { email: 'a@exemplo.com' })).status).toBe(200);
  });
});

describe('senha fraca ou vazada', () => {
  it('lista de senhas comuns, repetição e apelido/e-mail na senha', () => {
    expect(weakPasswordReason('12345678')).toMatch(/muito usada/);
    expect(weakPasswordReason('Flamengo')).toMatch(/muito usada/);
    expect(weakPasswordReason('aaaaaaaa')).toMatch(/repetido/);
    expect(weakPasswordReason('bianca2026!', { nickname: 'Bianca' })).toMatch(/apelido/);
    expect(weakPasswordReason('joao.silva99', { email: 'joao.silva@exemplo.com' })).toMatch(/e-mail/);
    expect(weakPasswordReason('cavalo-bateria-42', { nickname: 'Bianca', email: 'bia@exemplo.com' })).toBeNull();
  });

  it('cadastro com senha comum = 400 WEAK_PASSWORD no campo da senha', async () => {
    const app = createApp({ env, deps: { db: emptyDb, botCheck: async () => false, breached: async () => false } });
    const res = await post(app, '/auth/register', { ...signup, password: 'senha123' });
    const problem = Problem.parse(await res.json());
    expect(res.status).toBe(400);
    expect(problem.code).toBe('WEAK_PASSWORD');
    expect(problem.errors?.password).toBeTruthy();
  });

  it('cadastro com senha vazada = 400 BREACHED_PASSWORD', async () => {
    const app = createApp({ env, deps: { db: emptyDb, botCheck: async () => false, breached: async () => true } });
    const res = await post(app, '/auth/register', signup);
    expect(Problem.parse(await res.json()).code).toBe('BREACHED_PASSWORD');
  });

  it('redefinição: a senha é conferida antes de gastar o link; checagem fora do ar deixa passar', async () => {
    const breached = createApp({ env, deps: { db: emptyDb, botCheck: async () => false, breached: async () => true } });
    expect(Problem.parse(await (await post(breached, '/auth/reset-password', { token: 'x', password: 'cavalo-bateria-42' })).json()).code).toBe('BREACHED_PASSWORD');
    const down = createApp({ env, deps: { db: emptyDb, botCheck: async () => false, breached: async () => Promise.reject(new Error('timeout')) } });
    // Passou da checagem e chegou ao link (inválido no banco falso).
    expect(Problem.parse(await (await post(down, '/auth/reset-password', { token: 'x', password: 'cavalo-bateria-42' })).json()).code).toBe('INVALID_TOKEN');
  });
});

describe('aparelhos', () => {
  it('descreve o aparelho pelo navegador', () => {
    expect(describeDevice('Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36')).toBe('Chrome no Android');
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toBe('Safari no iPhone');
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0')).toBe('Edge no Windows');
    expect(describeDevice(null)).toBe('Aparelho desconhecido');
  });

  it('esconde o fim do IP', () => {
    expect(maskIp('203.0.113.7')).toBe('203.0.113.x');
    expect(maskIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:85a3:…');
    expect(maskIp('unknown')).toBeNull();
    expect(maskIp(null)).toBeNull();
  });
});
