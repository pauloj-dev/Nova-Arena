/**
 * Login social contra um Postgres de verdade (`TEST_DATABASE_URL`, no CI já migrado): regras de vinculação
 * de contas (#68). O provedor é falso: devolve o perfil que cada teste definir.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { LoginMethods, Me, Problem } from '@nova/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp, envFrom, type App } from '../src';
import type { OAuthFactory, OAuthProfile } from '../src/auth/oauth';
import { hashPassword } from '../src/auth/crypto';

const url = process.env.TEST_DATABASE_URL;
const ORIGIN = 'http://localhost';

/** Navegador mínimo com cookies por `Path`, que segue o fluxo até o retorno do provedor. */
class Browser {
  private jar = new Map<string, { value: string; path: string }>();
  constructor(private app: App) {}

  async request(fullPath: string, init: { method?: string; body?: unknown } = {}) {
    const pathname = fullPath.split('?')[0] ?? fullPath;
    const cookie = [...this.jar.entries()].filter(([, c]) => pathname.startsWith(c.path)).map(([k, c]) => `${k}=${c.value}`).join('; ');
    const res = await this.app.request(fullPath, {
      method: init.method ?? 'GET',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';').map((s) => s.trim());
      const [name, value = ''] = (pair ?? '').split('=');
      const path = attrs.find((a) => a.toLowerCase().startsWith('path='))?.slice(5) ?? '/';
      if (!name) continue;
      if (value === '' || attrs.some((a) => a.toLowerCase() === 'max-age=0')) this.jar.delete(name);
      else this.jar.set(name, { value, path });
    }
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location'), data: text && !res.headers.get('location') ? (JSON.parse(text) as unknown) : null };
  }

  /** Vai ao provedor e volta com o `state` certo; devolve para onde a API mandou o navegador. */
  async oauth(provider: 'google' | 'discord', query = '') {
    const start = await this.request(`/api/v1/auth/oauth/${provider}${query}`);
    const state = new URL(start.location ?? '').searchParams.get('state');
    return this.request(`/api/v1/auth/oauth/${provider}/callback?code=codigo&state=${state}`);
  }

  has(name: string) {
    return this.jar.has(name);
  }
}

describe.skipIf(!url)('login social (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  let profile: OAuthProfile;
  const stamp = Date.now();
  let seq = 0;
  const fresh = (over: Partial<OAuthProfile> = {}): OAuthProfile => {
    seq += 1;
    return { providerAccountId: `id-${stamp}-${seq}`, email: `social.${stamp}.${seq}@exemplo.com`, emailVerified: true, name: `Social ${seq}`, avatarUrl: null, ...over };
  };
  const factory: OAuthFactory = (_env, provider) => ({
    authorizationUrl: (state) => new URL(`https://provedor.exemplo/${provider}?state=${state}`),
    exchange: async () => profile,
  });

  beforeAll(() => {
    db = createDb({ connectionString: url, max: 3 });
    app = createApp({ env: envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url }), deps: { db: () => db, oauth: factory } });
  });
  beforeEach(() => {
    profile = fresh();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  async function passwordUser(emailVerified: boolean) {
    seq += 1;
    const email = `senha.${stamp}.${seq}@exemplo.com`;
    const nickname = `Senha${stamp}${seq}`.slice(-20);
    return db.user.create({ data: { email, nickname, nicknameKey: nickname.toLowerCase(), emailVerified, passwordHash: await hashPassword('senha-forte-123'), roles: { create: { role: 'PARTICIPANT' } } } });
  }

  it('e-mail novo cria a conta sem senha, com o provedor vinculado, e abre a sessão', async () => {
    const b = new Browser(app);
    const res = await b.oauth('google');
    expect(res.location).toBe('/minha-conta?completar=1');
    expect(b.has('na_at')).toBe(true);
    const me = Me.parse((await b.request('/api/v1/me')).data);
    expect(me).toMatchObject({ email: profile.email, emailVerified: true, birthDate: null, roles: ['PARTICIPANT'] });
    expect(me.nickname).toMatch(/^Social/);
    const user = await db.user.findUniqueOrThrow({ where: { id: me.id } });
    expect(user.passwordHash).toBeNull();
  });

  it('provedor já vinculado entra na mesma conta (e respeita o next interno)', async () => {
    await new Browser(app).oauth('discord');
    const b = new Browser(app);
    const res = await b.oauth('discord', '?next=/campeonatos');
    expect(res.location).toBe('/campeonatos');
    expect(await db.user.count({ where: { email: profile.email ?? '' } })).toBe(1);
  });

  it('e-mail verificado nos dois lados vincula à conta existente', async () => {
    const existing = await passwordUser(true);
    profile = fresh({ email: existing.email.toUpperCase() });
    const b = new Browser(app);
    expect((await b.oauth('google')).location).toBe('/');
    expect(Me.parse((await b.request('/api/v1/me')).data).id).toBe(existing.id);
    expect(await db.oAuthAccount.count({ where: { userId: existing.id } })).toBe(1);
  });

  it('E-mail não verificado no provedor não assume conta existente', async () => {
    const existing = await passwordUser(true);
    profile = fresh({ email: existing.email, emailVerified: false });
    const b = new Browser(app);
    expect((await b.oauth('discord')).location).toBe('/entrar?erro=oauth_email_existente');
    expect(b.has('na_at')).toBe(false);
    expect(await db.oAuthAccount.count({ where: { userId: existing.id } })).toBe(0);
  });

  it('conta existente com e-mail ainda não verificado também não é assumida', async () => {
    const existing = await passwordUser(false);
    profile = fresh({ email: existing.email });
    expect((await new Browser(app).oauth('google')).location).toBe('/entrar?erro=oauth_email_existente');
  });

  it('provedor sem e-mail não cria conta', async () => {
    profile = fresh({ email: null });
    expect((await new Browser(app).oauth('discord')).location).toBe('/entrar?erro=oauth_sem_email');
  });

  it('apelido repetido ganha sufixo numérico', async () => {
    const taken = await passwordUser(true);
    profile = fresh({ name: taken.nickname });
    const b = new Browser(app);
    await b.oauth('google');
    const me = Me.parse((await b.request('/api/v1/me')).data);
    expect(me.nickname.toLowerCase()).not.toBe(taken.nicknameKey);
    expect(me.nickname).toMatch(/\d$/);
  });

  it('conta banida não entra pelo provedor', async () => {
    const b = new Browser(app);
    await b.oauth('google');
    const banned = profile;
    await db.user.update({ where: { email: banned.email ?? '' }, data: { status: 'BANNED' } });
    expect((await new Browser(app).oauth('google')).location).toBe('/entrar?erro=conta_banida');
  });

  it('vincular em "Minha conta": exige sessão e não rouba vínculo de outra pessoa', async () => {
    const owner = new Browser(app);
    await owner.oauth('google');
    const ownerProfile = profile;

    const other = new Browser(app);
    profile = fresh();
    await other.oauth('google');
    // Agora `other` tenta vincular o Discord… que já é de outra conta.
    profile = fresh();
    await owner.oauth('discord', '?mode=link');
    expect((await other.oauth('discord', '?mode=link')).location).toBe('/minha-conta/seguranca?erro=oauth_ja_vinculado');

    // Sem sessão, o modo vincular não faz nada.
    profile = fresh();
    expect((await new Browser(app).oauth('discord', '?mode=link')).location).toBe('/entrar?erro=sessao_expirada');

    const { links, hasPassword } = LoginMethods.parse((await owner.request('/api/v1/me/oauth')).data);
    expect(hasPassword).toBe(false);
    expect(links.map((l) => l.provider).sort()).toEqual(['discord', 'google']);
    expect(links.find((l) => l.provider === 'google')?.email).toBe(ownerProfile.email);
  });

  it('desvincular: não deixa a conta sem jeito de entrar; depois de definir senha, pode', async () => {
    const b = new Browser(app);
    await b.oauth('google');
    const blocked = await b.request('/api/v1/me/oauth/google', { method: 'DELETE' });
    expect(blocked.status).toBe(409);
    expect(Problem.parse(blocked.data).code).toBe('LAST_LOGIN_METHOD');

    expect((await b.request('/api/v1/me/password', { method: 'POST', body: { password: 'senha-nova-123' } })).status).toBe(200);
    const again = await b.request('/api/v1/me/password', { method: 'POST', body: { password: 'outra-senha-123' } });
    expect(Problem.parse(again.data).code).toBe('PASSWORD_ALREADY_SET');

    expect((await b.request('/api/v1/me/oauth/google', { method: 'DELETE' })).status).toBe(204);
    expect(LoginMethods.parse((await b.request('/api/v1/me/oauth')).data)).toEqual({ hasPassword: true, links: [] });
    const login = await new Browser(app).request('/api/v1/auth/login', { method: 'POST', body: { email: profile.email, password: 'senha-nova-123' } });
    expect(login.status).toBe(200);
  });
});
