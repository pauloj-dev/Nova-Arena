/**
 * Conta contra um Postgres de verdade (`TEST_DATABASE_URL`, no CI): aparelhos, troca de senha e troca de
 * e-mail (issue #69). Critério de aceite: trocar a senha invalida os refresh tokens das outras sessões.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { ChangeEmailResponse, DeviceSessions, Me, Problem } from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, envFrom, type App } from '../src';
import type { EmailMessage } from '../src/mail';

const url = process.env.TEST_DATABASE_URL;
const ORIGIN = 'http://localhost';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

/** Navegador mínimo: cookies por `Path` e um User-Agent próprio (cada um é um aparelho). */
class Browser {
  private jar = new Map<string, { value: string; path: string }>();
  constructor(
    private app: App,
    private userAgent: string,
  ) {}

  async request(path: string, init: { method?: string; body?: unknown } = {}) {
    const fullPath = `/api/v1${path}`;
    const cookie = [...this.jar.entries()].filter(([, c]) => fullPath.startsWith(c.path)).map(([k, c]) => `${k}=${c.value}`).join('; ');
    const res = await this.app.request(fullPath, {
      method: init.method ?? 'GET',
      headers: { Origin: ORIGIN, 'User-Agent': this.userAgent, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';').map((s) => s.trim());
      const [name, value = ''] = (pair ?? '').split('=');
      const cookiePath = attrs.find((a) => a.toLowerCase().startsWith('path='))?.slice(5) ?? '/';
      if (!name) continue;
      if (value === '' || attrs.some((a) => a.toLowerCase() === 'max-age=0')) this.jar.delete(name);
      else this.jar.set(name, { value, path: cookiePath });
    }
    const text = await res.text();
    return { status: res.status, data: text ? (JSON.parse(text) as unknown) : null };
  }
}

describe.skipIf(!url)('conta (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const sent: (EmailMessage & { to: string })[] = [];
  const stamp = Date.now();
  const email = `conta.${stamp}@exemplo.com`;
  let password = 'primeira-senha-1';
  const login = (b: Browser, pass = password) => b.request('/auth/login', { method: 'POST', body: { email, password: pass } });

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 3 });
    app = createApp({
      env: envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url }),
      deps: {
        db: () => db,
        // Vários logins seguidos no mesmo "IP": o limite de tentativas tem teste próprio.
        limiter: () => ({ limit: async () => ({ success: true, remaining: 99, reset: 0 }) }),
        mailer: () => ({ mode: 'log' as const, send: async (to, m) => void sent.push({ ...m, to }) }),
      },
    });
    const res = await new Browser(app, ANDROID).request('/auth/register', { method: 'POST', body: { email, nickname: `Conta${stamp}`.slice(0, 20), password, birthDate: '2000-05-10', acceptTerms: true } });
    expect(res.status).toBe(201);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('lista os aparelhos (este marcado) e encerra outro: o refresh dele para de funcionar', async () => {
    const phone = new Browser(app, ANDROID);
    const tablet = new Browser(app, IPHONE);
    await login(phone);
    await login(tablet);
    const list = DeviceSessions.parse((await phone.request('/me/sessions')).data);
    const mine = list.find((s) => s.current);
    const other = list.find((s) => s.device === 'Safari no iPhone');
    expect(mine?.device).toBe('Chrome no Android');
    expect(other?.current).toBe(false);

    expect((await phone.request(`/me/sessions/${mine?.id}`, { method: 'DELETE' })).status).toBe(400);
    expect((await phone.request(`/me/sessions/${other?.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await tablet.request('/auth/refresh', { method: 'POST' })).status).toBe(401);
    expect((await phone.request('/auth/refresh', { method: 'POST' })).status).toBe(200);
  });

  it('encerrar todos os outros mantém só este aparelho', async () => {
    const a = new Browser(app, ANDROID);
    const b = new Browser(app, IPHONE);
    await login(a);
    await login(b);
    expect((await a.request('/me/sessions', { method: 'DELETE' })).status).toBe(204);
    expect(DeviceSessions.parse((await a.request('/me/sessions')).data)).toHaveLength(1);
    expect((await b.request('/auth/refresh', { method: 'POST' })).status).toBe(401);
  });

  it('Trocar a senha invalida os refresh tokens das outras sessões (e o acesso delas cai na hora)', async () => {
    const me = new Browser(app, ANDROID);
    const other = new Browser(app, IPHONE);
    await login(me);
    await login(other);

    const wrong = await me.request('/me/password/change', { method: 'POST', body: { currentPassword: 'errada-123', newPassword: 'segunda-senha-2' } });
    expect(Problem.parse(wrong.data).code).toBe('INVALID_PASSWORD');

    const ok = await me.request('/me/password/change', { method: 'POST', body: { currentPassword: password, newPassword: 'segunda-senha-2' } });
    expect(ok.status).toBe(200);
    // O outro aparelho: token de acesso já não vale e o refresh foi revogado.
    expect((await other.request('/me')).data).toBeNull();
    expect((await other.request('/auth/refresh', { method: 'POST' })).status).toBe(401);
    // Este aparelho continua, com sessão nova.
    expect(Me.parse((await me.request('/me')).data).email).toBe(email);
    expect((await me.request('/auth/refresh', { method: 'POST' })).status).toBe(200);
    expect(sent.at(-1)).toMatchObject({ template: 'PASSWORD_CHANGED', to: email });

    expect((await login(new Browser(app, ANDROID))).status).toBe(401);
    password = 'segunda-senha-2';
    expect((await login(new Browser(app, ANDROID))).status).toBe(200);
  });

  it('troca de e-mail: pede a senha, confirma pelo link do endereço novo e avisa o antigo', async () => {
    const me = new Browser(app, ANDROID);
    await login(me);
    const newEmail = `Novo.${stamp}@Exemplo.com`;

    expect(Problem.parse((await me.request('/me/email', { method: 'POST', body: { newEmail, password: 'errada-123' } })).data).code).toBe('INVALID_PASSWORD');
    const taken = await me.request('/me/email', { method: 'POST', body: { newEmail: 'rafael@novaarena.gg', password } });
    expect([409, 202]).toContain(taken.status); // 409 quando o seed já rodou neste banco.

    const res = await me.request('/me/email', { method: 'POST', body: { newEmail, password } });
    expect(res.status).toBe(202);
    const { pendingEmail, devConfirmToken } = ChangeEmailResponse.parse(res.data);
    expect(pendingEmail).toBe(newEmail.toLowerCase());
    expect(sent.at(-1)).toMatchObject({ template: 'CONFIRM_EMAIL_CHANGE', to: newEmail.toLowerCase() });
    // Até confirmar, nada muda.
    expect(Me.parse((await me.request('/me')).data).email).toBe(email);

    // O link pode ser aberto em outro aparelho, sem login.
    const confirmed = await new Browser(app, IPHONE).request('/auth/confirm-email-change', { method: 'POST', body: { token: devConfirmToken } });
    expect(Me.parse(confirmed.data)).toMatchObject({ email: newEmail.toLowerCase(), emailVerified: true });
    expect(sent.at(-1)).toMatchObject({ template: 'EMAIL_CHANGED', to: email });
    expect((await new Browser(app, IPHONE).request('/auth/confirm-email-change', { method: 'POST', body: { token: devConfirmToken } })).status).toBe(400);
  });
});
