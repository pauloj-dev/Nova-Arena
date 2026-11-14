/**
 * Autenticação contra um Postgres de verdade (`TEST_DATABASE_URL`, no CI já migrado): cadastro, login,
 * refresh rotativo com detecção de reuso, logout, verificação de e-mail e redefinição de senha.
 * Toda resposta é validada pelo contrato dentro da própria rota (`respond`).
 */
import { createDb, type PrismaClient } from '@nova/db';
import { Me, Problem, RegisterResponse } from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, envFrom, type App } from '../src';
import type { MailMessage } from '../src/mail';

const url = process.env.TEST_DATABASE_URL;
const ORIGIN = 'http://localhost';

/** Navegador mínimo: guarda os cookies que a API manda, respeitando o `Path`. */
class Browser {
  private jar = new Map<string, { value: string; path: string }>();
  constructor(private app: App) {}

  async request(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const cookie = [...this.jar.entries()].filter(([, c]) => path.startsWith(c.path)).map(([k, c]) => `${k}=${c.value}`).join('; ');
    const res = await this.app.request(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...init.headers },
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
    return { status: res.status, data: text ? (JSON.parse(text) as unknown) : null, headers: res.headers };
  }

  cookie(name: string) {
    return this.jar.get(name)?.value;
  }
  setCookie(name: string, value: string, path: string) {
    this.jar.set(name, { value, path });
  }
}

describe.skipIf(!url)('autenticação (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const sent: MailMessage[] = [];
  const stamp = Date.now();
  const account = { email: `Jogadora.${stamp}@Exemplo.com`, nickname: `Jogadora${stamp}`.slice(0, 20), password: 'senha-forte-123', birthDate: '2000-05-10', acceptTerms: true };

  beforeAll(() => {
    db = createDb({ connectionString: url, max: 3 });
    app = createApp({
      env: envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url }),
      deps: { db: () => db, mailer: () => ({ send: async (m) => void sent.push(m) }) },
    });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('cadastro cria a conta (e-mail em minúsculas), abre a sessão e manda o e-mail de verificação', async () => {
    const b = new Browser(app);
    const res = await b.request('/auth/register', { method: 'POST', body: account });
    expect(res.status).toBe(201);
    const { user, devVerifyToken } = RegisterResponse.parse(res.data);
    expect(user).toMatchObject({ email: account.email.toLowerCase(), roles: ['PARTICIPANT'], emailVerified: false, birthDate: '2000-05-10' });
    expect(devVerifyToken).toBeTruthy();
    expect(sent.at(-1)).toMatchObject({ template: 'VERIFY_EMAIL', to: account.email.toLowerCase() });
    expect(sent.at(-1)?.data.link).toContain(`/verificar-email?token=${devVerifyToken}`);
    expect(b.cookie('na_at')).toBeTruthy();
    expect(b.cookie('na_rt')).toBeTruthy();
    expect(Me.parse((await b.request('/me')).data).id).toBe(user.id);
    // O token fica no banco só como hash.
    expect(await db.emailToken.count({ where: { tokenHash: devVerifyToken as string } })).toBe(0);
  });

  it('e-mail ou apelido repetido: 409 com o campo marcado', async () => {
    const b = new Browser(app);
    const email = await b.request('/auth/register', { method: 'POST', body: { ...account, nickname: `Outra${stamp}`.slice(0, 20) } });
    expect(email.status).toBe(409);
    expect(Problem.parse(email.data)).toMatchObject({ code: 'EMAIL_TAKEN', errors: { email: 'Já existe uma conta com este e-mail.' } });
    const nick = await b.request('/auth/register', { method: 'POST', body: { ...account, email: `outra.${stamp}@exemplo.com`, nickname: account.nickname.toUpperCase() } });
    expect(Problem.parse(nick.data).code).toBe('NICKNAME_TAKEN');
  });

  it('login: senha errada e e-mail inexistente dão a mesma resposta; certo abre a sessão', async () => {
    const b = new Browser(app);
    const wrong = await b.request('/auth/login', { method: 'POST', body: { email: account.email, password: 'errada' }, headers: { 'x-forwarded-for': '10.0.0.1' } });
    const missing = await b.request('/auth/login', { method: 'POST', body: { email: 'nao.existe@exemplo.com', password: 'errada' }, headers: { 'x-forwarded-for': '10.0.0.1' } });
    expect(wrong).toMatchObject({ status: 401, data: missing.data });
    const ok = await b.request('/auth/login', { method: 'POST', body: { email: account.email, password: account.password }, headers: { 'x-forwarded-for': '10.0.0.1' } });
    expect(ok.status).toBe(200);
    expect(Me.parse(ok.data).nickname).toBe(account.nickname);
  });

  it('refresh troca o token; reuso de um token já trocado derruba a família inteira', async () => {
    const b = new Browser(app);
    await b.request('/auth/login', { method: 'POST', body: { email: account.email, password: account.password }, headers: { 'x-forwarded-for': '10.0.0.2' } });
    const stolen = b.cookie('na_rt') as string;
    const first = await b.request('/auth/refresh', { method: 'POST' });
    expect(first.status).toBe(200);
    expect(b.cookie('na_rt')).not.toBe(stolen);

    // Alguém reapresenta o token antigo (roubado): a família é revogada.
    const attacker = new Browser(app);
    attacker.setCookie('na_rt', stolen, '/api/v1/auth');
    const reuse = await attacker.request('/auth/refresh', { method: 'POST' });
    expect(reuse.status).toBe(401);
    expect(Problem.parse(reuse.data).code).toBe('SESSION_REUSED');

    // O dono também sai: o token novo dele pertencia à mesma família.
    expect((await b.request('/auth/refresh', { method: 'POST' })).status).toBe(401);
    expect((await b.request('/me')).data).toBeNull();
  });

  it('logout encerra a sessão: o token de acesso deixa de valer na hora', async () => {
    const b = new Browser(app);
    await b.request('/auth/login', { method: 'POST', body: { email: account.email, password: account.password }, headers: { 'x-forwarded-for': '10.0.0.3' } });
    const access = b.cookie('na_at') as string;
    expect((await b.request('/auth/logout', { method: 'POST' })).status).toBe(204);
    const replay = new Browser(app);
    replay.setCookie('na_at', access, '/');
    expect((await replay.request('/me')).data).toBeNull();
  });

  it('verificação de e-mail: link de uso único', async () => {
    const b = new Browser(app);
    await b.request('/auth/login', { method: 'POST', body: { email: account.email, password: account.password }, headers: { 'x-forwarded-for': '10.0.0.4' } });
    const resend = await b.request('/auth/resend-verification', { method: 'POST' });
    const token = (resend.data as { devVerifyToken: string }).devVerifyToken;
    const verified = await b.request('/auth/verify-email', { method: 'POST', body: { token } });
    expect(Me.parse(verified.data).emailVerified).toBe(true);
    const again = await b.request('/auth/verify-email', { method: 'POST', body: { token } });
    expect(again.status).toBe(400);
    expect(Problem.parse(again.data).code).toBe('INVALID_TOKEN');
    expect((await b.request('/auth/resend-verification', { method: 'POST' })).status).toBe(409);
  });

  it('recuperação de senha: sempre 200; a nova senha derruba as sessões antigas', async () => {
    const logged = new Browser(app);
    await logged.request('/auth/login', { method: 'POST', body: { email: account.email, password: account.password }, headers: { 'x-forwarded-for': '10.0.0.5' } });
    const anon = new Browser(app);
    const unknown = await anon.request('/auth/forgot-password', { method: 'POST', body: { email: 'nao.existe@exemplo.com' } });
    expect(unknown).toMatchObject({ status: 200, data: { ok: true, devResetToken: null } });
    const forgot = await anon.request('/auth/forgot-password', { method: 'POST', body: { email: account.email } });
    const token = (forgot.data as { devResetToken: string }).devResetToken;
    expect(token).toBeTruthy();
    expect((await anon.request('/auth/reset-password', { method: 'POST', body: { token, password: 'outra-senha-forte-1' } })).status).toBe(200);
    expect((await logged.request('/me')).data).toBeNull();
    expect((await anon.request('/auth/login', { method: 'POST', body: { email: account.email, password: account.password }, headers: { 'x-forwarded-for': '10.0.0.6' } })).status).toBe(401);
    expect((await anon.request('/auth/login', { method: 'POST', body: { email: account.email, password: 'outra-senha-forte-1' }, headers: { 'x-forwarded-for': '10.0.0.6' } })).status).toBe(200);
    expect((await anon.request('/auth/reset-password', { method: 'POST', body: { token, password: 'mais-uma-senha-1' } })).status).toBe(400);
  });

  it('conta banida não entra (403 ACCOUNT_BANNED) e perde a sessão aberta', async () => {
    const b = new Browser(app);
    await b.request('/auth/login', { method: 'POST', body: { email: account.email, password: 'outra-senha-forte-1' }, headers: { 'x-forwarded-for': '10.0.0.7' } });
    await db.user.update({ where: { email: account.email.toLowerCase() }, data: { status: 'BANNED' } });
    expect((await b.request('/me')).data).toBeNull();
    const res = await new Browser(app).request('/auth/login', { method: 'POST', body: { email: account.email, password: 'outra-senha-forte-1' }, headers: { 'x-forwarded-for': '10.0.0.8' } });
    expect(res.status).toBe(403);
    expect(Problem.parse(res.data).code).toBe('ACCOUNT_BANNED');
  });
});
