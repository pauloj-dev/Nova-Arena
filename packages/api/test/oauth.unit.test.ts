/** Login social sem banco: início do fluxo (state + PKCE), proteção de estado e redirecionamento seguro (#68). */
import type { PrismaClient } from '@nova/db';
import { describe, expect, it } from 'vitest';
import { createApp, envFrom } from '../src';
import { nicknameBase, type OAuthFactory } from '../src/auth/oauth';
import { safeNext } from '../src/modules/oauth';

const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', NEXT_PUBLIC_SITE_URL: 'https://novaarena.gg' });
const noDb = (() => {
  throw new Error('o teste não deveria chegar ao banco');
}) as unknown as () => PrismaClient;

const calls: { state: string; verifier: string; redirectUri: string }[] = [];
const fakeFactory: OAuthFactory = (_env, provider, redirectUri) => ({
  authorizationUrl(state, verifier) {
    calls.push({ state, verifier, redirectUri });
    return new URL(`https://provedor.exemplo/${provider}/autorizar?state=${state}`);
  },
  exchange: async () => {
    throw new Error('não usado');
  },
});

const app = createApp({ env, deps: { db: noDb, oauth: fakeFactory } });
const flowCookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith('na_oauth='));

describe('início do login social', () => {
  it('redireciona ao provedor com state e guarda state + verificador PKCE em cookie httpOnly de 10 min', async () => {
    const res = await app.request('/api/v1/auth/oauth/google?next=/campeonatos/copa');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/^https:\/\/provedor\.exemplo\/google\/autorizar\?state=/);
    const cookie = flowCookie(res) ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Max-Age=600/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth\/oauth/);
    const last = calls.at(-1);
    expect(last?.redirectUri).toBe('https://novaarena.gg/api/v1/auth/oauth/google/callback');
    expect(last?.verifier.length).toBeGreaterThanOrEqual(43);
    const flow = JSON.parse(Buffer.from(cookie.split(';')[0]?.slice('na_oauth='.length) ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(flow).toMatchObject({ provider: 'google', state: last?.state, verifier: last?.verifier, next: '/campeonatos/copa', mode: 'login' });
  });

  it('provedor desconhecido = 404', async () => {
    expect((await app.request('/api/v1/auth/oauth/facebook')).status).toBe(404);
  });

  it('provedor sem credenciais neste ambiente volta ao login com aviso', async () => {
    const res = await createApp({ env, deps: { db: noDb, oauth: () => null } }).request('/api/v1/auth/oauth/discord');
    expect(res.headers.get('location')).toBe('/entrar?erro=oauth_indisponivel');
  });
});

describe('retorno do provedor', () => {
  async function start() {
    const res = await app.request('/api/v1/auth/oauth/google');
    const cookie = (flowCookie(res) ?? '').split(';')[0] ?? '';
    return { cookie, state: calls.at(-1)?.state ?? '' };
  }

  it('state diferente do cookie é recusado antes de qualquer troca de código', async () => {
    const { cookie } = await start();
    const res = await app.request('/api/v1/auth/oauth/google/callback?code=abc&state=forjado', { headers: { Cookie: cookie } });
    expect(res.headers.get('location')).toBe('/entrar?erro=oauth_estado');
  });

  it('sem o cookie do fluxo (outro navegador, expirou) é recusado', async () => {
    const { state } = await start();
    const res = await app.request(`/api/v1/auth/oauth/google/callback?code=abc&state=${state}`);
    expect(res.headers.get('location')).toBe('/entrar?erro=oauth_estado');
  });

  it('cookie de um provedor não serve no retorno de outro', async () => {
    const { cookie, state } = await start();
    const res = await app.request(`/api/v1/auth/oauth/discord/callback?code=abc&state=${state}`, { headers: { Cookie: cookie } });
    expect(res.headers.get('location')).toBe('/entrar?erro=oauth_estado');
  });

  it('pessoa que cancelou no provedor volta ao login com aviso, e o cookie do fluxo é apagado', async () => {
    const { cookie } = await start();
    const res = await app.request('/api/v1/auth/oauth/google/callback?error=access_denied', { headers: { Cookie: cookie } });
    expect(res.headers.get('location')).toBe('/entrar?erro=oauth_cancelado');
    expect(flowCookie(res)).toMatch(/Max-Age=0/);
  });

  it('falha ao trocar o código volta ao login sem vazar detalhes', async () => {
    const { cookie, state } = await start();
    const res = await app.request(`/api/v1/auth/oauth/google/callback?code=abc&state=${state}`, { headers: { Cookie: cookie } });
    expect(res.headers.get('location')).toBe('/entrar?erro=oauth_falhou');
  });
});

describe('utilitários', () => {
  it('next só aceita caminho interno (sem redirecionamento aberto)', () => {
    expect(safeNext('/minha-conta')).toBe('/minha-conta');
    expect(safeNext('//site-malicioso.com')).toBeNull();
    expect(safeNext('https://site-malicioso.com')).toBeNull();
    expect(safeNext('/\\site-malicioso.com')).toBeNull();
    expect(safeNext(undefined)).toBeNull();
  });

  it('apelido a partir do nome: sem acento, sem espaço, 3–16 caracteres', () => {
    expect(nicknameBase('Bianca Araújo', null)).toBe('BiancaAraujo');
    expect(nicknameBase('', 'joao.silva@exemplo.com')).toBe('joao.silva');
    expect(nicknameBase('李', null)).toBe('jogador');
    expect(nicknameBase('Um nome muito comprido mesmo', null)).toHaveLength(16);
  });
});
