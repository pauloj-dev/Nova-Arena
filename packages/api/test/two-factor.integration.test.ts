/**
 * Verificação em duas etapas contra um Postgres de verdade (`TEST_DATABASE_URL`) — issue #95.
 * Critérios: segredo cifrado no banco, códigos de recuperação de uso único (só o hash guardado), login com o passo do
 * código, limite de tentativas, Admin não desliga, redefinição só pelo Super Admin (auditada), `/admin` sem 2FA = 403.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { LoginResult, Me, Problem, TwoFactorEnabled, TwoFactorSetup, TwoFactorStatus } from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, envFrom, type App } from '../src';
import { hashPassword } from '../src/auth/crypto';
import { readAccessClaims } from '../src/auth/edge';
import { totp } from '../src/auth/totp';
import { memoryRealtime } from '../src/realtime';
import { Browser } from './fixtures/browser';

const url = process.env.TEST_DATABASE_URL;
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: SECRET, DATABASE_URL: url, TWO_FACTOR_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64') });
const PASSWORD = 'senha-forte-123';

describe.skipIf(!url)('verificação em duas etapas (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  /** Relógio simulado: TOTP, limite de tentativas e validade do passo do login leem `deps.now()`. */
  let clock = new Date();
  const stamp = String(Date.now()).slice(-7);
  const rt = memoryRealtime();
  const emails = new Map<string, string>();

  async function makeUser(key: string, roles: ('SUPER_ADMIN' | 'ADMIN' | 'PARTICIPANT')[]) {
    const nickname = `tf${key}${stamp}`.slice(0, 20);
    const email = `tf.${key}.${stamp}@exemplo.com`;
    emails.set(key, email);
    return db.user.create({ data: { email, nickname, nicknameKey: nickname.toLowerCase(), passwordHash: await hashPassword(PASSWORD), emailVerified: true, roles: { create: roles.map((role) => ({ role })) } } });
  }
  const code = (data: unknown) => Problem.parse(data).code;
  const tick = (ms: number) => (clock = new Date(clock.getTime() + ms));

  async function login(key: string) {
    const b = new Browser(app);
    const res = await b.request('/auth/login', { method: 'POST', body: { email: emails.get(key), password: PASSWORD } });
    return { b, res };
  }

  /** Liga o 2FA pela API e devolve o segredo (lido da resposta do setup, como o aplicativo faria) e os códigos. */
  async function enable(b: Browser) {
    const setup = TwoFactorSetup.parse((await b.request('/me/2fa/setup', { method: 'POST' })).data);
    tick(31_000);
    const res = await b.request('/me/2fa/enable', { method: 'POST', body: { code: totp(setup.secret, clock.getTime()) } });
    expect(res.status).toBe(200);
    return { secret: setup.secret, recoveryCodes: TwoFactorEnabled.parse(res.data).recoveryCodes };
  }

  beforeAll(() => {
    db = createDb({ connectionString: url, max: 3 });
    app = createApp({ env, deps: { db: () => db, now: () => clock, realtime: () => rt, queue: () => ({ schedule: async () => undefined }) } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('ativar: segredo cifrado no banco, código conferido, códigos de recuperação só como hash; a sessão passa a valer como 2FA feito', async () => {
    const user = await makeUser('bia', ['PARTICIPANT']);
    const { b, res } = await login('bia');
    expect(Me.parse(res.data).twoFactorEnabled).toBe(false);
    expect(TwoFactorStatus.parse((await b.request('/me/2fa')).data)).toEqual({ enabled: false, required: false, recoveryCodesLeft: 0 });

    const setup = TwoFactorSetup.parse((await b.request('/me/2fa/setup', { method: 'POST' })).data);
    expect(setup.otpauthUrl).toContain(`secret=${setup.secret}`);
    const row = await db.twoFactor.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.secretEnc).not.toContain(setup.secret);
    expect(row.enabledAt).toBeNull();

    // Código errado não ativa; o certo ativa uma vez.
    expect(code((await b.request('/me/2fa/enable', { method: 'POST', body: { code: '000000' } })).data)).toBe('INVALID_CODE');
    const ok = await b.request('/me/2fa/enable', { method: 'POST', body: { code: totp(setup.secret, clock.getTime()) } });
    expect(ok.status).toBe(200);
    const { recoveryCodes } = TwoFactorEnabled.parse(ok.data);
    expect(recoveryCodes).toHaveLength(8);
    const enabled = await db.twoFactor.findUniqueOrThrow({ where: { userId: user.id } });
    expect(enabled.recoveryCodesHash).toHaveLength(8);
    expect(enabled.recoveryCodesHash.some((h) => recoveryCodes.includes(h))).toBe(false);
    expect(code((await b.request('/me/2fa/setup', { method: 'POST' })).data)).toBe('TWO_FACTOR_ALREADY_ENABLED');
    expect(TwoFactorStatus.parse((await b.request('/me/2fa')).data)).toEqual({ enabled: true, required: false, recoveryCodesLeft: 8 });
    const claims = await readAccessClaims(SECRET, b.cookie('na_at') ?? '', clock);
    expect(claims?.tfa).toBe(true);
    const audit = await db.auditLog.findFirst({ where: { action: 'TWO_FACTOR_CHANGED', entityId: user.id }, orderBy: { createdAt: 'desc' } });
    expect(audit?.after).toEqual({ twoFactorEnabled: true });
  });

  it('login com 2FA: a senha não abre sessão; o código abre com tfa; o mesmo código não entra duas vezes', async () => {
    await makeUser('caio', ['PARTICIPANT']);
    const { b } = await login('caio');
    const { secret } = await enable(b);

    const first = await login('caio');
    expect(first.res.status).toBe(202);
    expect(LoginResult.parse(first.res.data)).toEqual({ twoFactorRequired: true });
    expect(first.b.cookie('na_at')).toBeUndefined();
    expect(first.b.cookie('na_tfa')).toBeTruthy();
    expect((await first.b.request('/me')).data).toBeNull();

    tick(31_000);
    const current = totp(secret, clock.getTime());
    const verified = await first.b.request('/auth/2fa/verify', { method: 'POST', body: { code: current } });
    expect(verified.status).toBe(200);
    expect(Me.parse(verified.data).twoFactorEnabled).toBe(true);
    expect(first.b.cookie('na_tfa')).toBeUndefined();
    expect((await readAccessClaims(SECRET, first.b.cookie('na_at') ?? '', clock))?.tfa).toBe(true);
    // A renovação mantém o 2FA feito.
    expect((await first.b.request('/auth/refresh', { method: 'POST' })).status).toBe(200);
    expect((await readAccessClaims(SECRET, first.b.cookie('na_at') ?? '', clock))?.tfa).toBe(true);

    // Outro aparelho tenta repetir o mesmo código (visto por cima do ombro, por exemplo): recusado.
    const second = await login('caio');
    expect(code((await second.b.request('/auth/2fa/verify', { method: 'POST', body: { code: current } })).data)).toBe('INVALID_CODE');
  });

  it('código de recuperação entra uma única vez e some da contagem', async () => {
    await makeUser('duda', ['PARTICIPANT']);
    const { b } = await login('duda');
    const { recoveryCodes } = await enable(b);
    const recovery = recoveryCodes[0] ?? '';

    const a = await login('duda');
    expect((await a.b.request('/auth/2fa/verify', { method: 'POST', body: { code: recovery.toUpperCase() } })).status).toBe(200);
    expect(TwoFactorStatus.parse((await a.b.request('/me/2fa')).data).recoveryCodesLeft).toBe(7);

    const again = await login('duda');
    expect(code((await again.b.request('/auth/2fa/verify', { method: 'POST', body: { code: recovery } })).data)).toBe('INVALID_CODE');
  });

  it('limite de tentativas: 5 códigos errados em 5 minutos → 429; e o passo do login vence em 5 minutos', async () => {
    await makeUser('edu', ['PARTICIPANT']);
    const { b } = await login('edu');
    const { secret } = await enable(b);
    // Ativar também gastou uma tentativa da conta: espera a janela passar.
    tick(5 * 60_000 + 1000);
    const { b: other } = await login('edu');
    for (let i = 0; i < 5; i += 1) expect(code((await other.request('/auth/2fa/verify', { method: 'POST', body: { code: '123456' } })).data)).toBe('INVALID_CODE');
    const blocked = await other.request('/auth/2fa/verify', { method: 'POST', body: { code: totp(secret, clock.getTime()) } });
    expect(blocked.status).toBe(429);
    expect(code(blocked.data)).toBe('RATE_LIMITED');

    tick(6 * 60_000);
    const expired = await other.request('/auth/2fa/verify', { method: 'POST', body: { code: totp(secret, clock.getTime()) } });
    expect(code(expired.data)).toBe('TWO_FACTOR_CHALLENGE_EXPIRED');
    // Sem passo nenhum: o mesmo 401.
    expect(code((await new Browser(app).request('/auth/2fa/verify', { method: 'POST', body: { code: '123456' } })).data)).toBe('TWO_FACTOR_CHALLENGE_EXPIRED');
  });

  it('desligar pede código; Admin não pode desligar', async () => {
    const user = await makeUser('fabi', ['PARTICIPANT']);
    const { b } = await login('fabi');
    const { secret } = await enable(b);
    expect(code((await b.request('/me/2fa/disable', { method: 'POST', body: { code: '000000' } })).data)).toBe('INVALID_CODE');
    tick(31_000);
    const off = await b.request('/me/2fa/disable', { method: 'POST', body: { code: totp(secret, clock.getTime()) } });
    expect(off.status).toBe(200);
    expect(TwoFactorStatus.parse(off.data)).toEqual({ enabled: false, required: false, recoveryCodesLeft: 0 });
    expect(await db.twoFactor.findUnique({ where: { userId: user.id } })).toBeNull();
    expect(code((await b.request('/me/2fa/disable', { method: 'POST', body: { code: '123456' } })).data)).toBe('TWO_FACTOR_NOT_ENABLED');
    // Sem 2FA, a senha volta a bastar.
    expect(Me.parse((await login('fabi')).res.data).id).toBe(user.id);

    await makeUser('gabi', ['ADMIN', 'PARTICIPANT']);
    const admin = await login('gabi');
    expect(TwoFactorStatus.parse((await admin.b.request('/me/2fa')).data).required).toBe(true);
    const adminSecret = (await enable(admin.b)).secret;
    tick(31_000);
    const denied = await admin.b.request('/me/2fa/disable', { method: 'POST', body: { code: totp(adminSecret, clock.getTime()) } });
    expect(denied.status).toBe(403);
    expect(code(denied.data)).toBe('TWO_FACTOR_REQUIRED');
  });

  it('redefinição pelo Super Admin: exige 2FA do Super Admin, motivo, não vale para si mesmo, auditada e avisada', async () => {
    const target = await makeUser('hugo', ['ADMIN', 'PARTICIPANT']);
    const hugo = await login('hugo');
    await enable(hugo.b);
    const boss = await makeUser('rafa', ['SUPER_ADMIN', 'ADMIN', 'PARTICIPANT']);
    const { b: superB } = await login('rafa');
    const path = `/admin/users/${target.id}/2fa/reset`;

    // Super Admin sem 2FA: a área de administração responde 403 TWO_FACTOR_REQUIRED.
    const no2fa = await superB.request(path, { method: 'POST', body: { reason: 'Perdeu o celular' } });
    expect(no2fa.status).toBe(403);
    expect(code(no2fa.data)).toBe('TWO_FACTOR_REQUIRED');
    // Admin (não Super) com 2FA: 403 comum.
    expect((await hugo.b.request(`/admin/users/${boss.id}/2fa/reset`, { method: 'POST', body: { reason: 'Perdeu o celular' } })).status).toBe(403);
    expect((await new Browser(app).request(path, { method: 'POST', body: { reason: 'x' } })).status).toBe(401);

    await enable(superB);
    expect(code((await superB.request(path, { method: 'POST', body: { reason: 'x' } })).data)).toBe('VALIDATION');
    expect(code((await superB.request(`/admin/users/${boss.id}/2fa/reset`, { method: 'POST', body: { reason: 'Perdeu o celular' } })).data)).toBe('SELF_RESET');
    expect((await superB.request('/admin/users/nao-existe/2fa/reset', { method: 'POST', body: { reason: 'Perdeu o celular' } })).status).toBe(404);

    const reset = await superB.request(path, { method: 'POST', body: { reason: 'Perdeu o celular e os códigos' } });
    expect(reset.status).toBe(200);
    expect(TwoFactorStatus.parse(reset.data)).toEqual({ enabled: false, required: true, recoveryCodesLeft: 0 });
    expect(code((await superB.request(path, { method: 'POST', body: { reason: 'De novo, por engano' } })).data)).toBe('TWO_FACTOR_NOT_ENABLED');
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'TWO_FACTOR_CHANGED', entityId: target.id, actorId: boss.id } });
    expect(audit).toMatchObject({ reason: 'Perdeu o celular e os códigos', before: { twoFactorEnabled: true }, after: { twoFactorEnabled: false } });
    const notice = await db.notification.findFirstOrThrow({ where: { userId: target.id, type: 'SANCTION' } });
    expect(notice.title).toBe('Verificação em duas etapas redefinida');
    expect(rt.events).toContainEqual({ channel: `user:${target.id}`, event: { type: 'notification.created', id: notice.id } });
    // As sessões do Hugo perdem o "2FA feito" e a senha volta a bastar no login.
    expect(await db.session.count({ where: { userId: target.id, twoFactorVerified: true } })).toBe(0);
    expect((await login('hugo')).res.status).toBe(200);
  });

  it('redefinir a senha avisa as telas abertas (session.revoked no canal do usuário)', async () => {
    const user = await makeUser('iara', ['PARTICIPANT']);
    const token = 'token-de-redefinicao-do-teste-' + stamp;
    const { sha256 } = await import('../src/auth/crypto');
    await db.emailToken.create({ data: { userId: user.id, type: 'RESET', tokenHash: sha256(token), expiresAt: new Date(clock.getTime() + 3600_000) } });
    const res = await new Browser(app).request('/auth/reset-password', { method: 'POST', body: { token, password: 'outra-senha-forte-456' } });
    expect(res.status).toBe(200);
    expect(rt.events).toContainEqual({ channel: `user:${user.id}`, event: { type: 'session.revoked', reason: 'PASSWORD_RESET' } });
  });
});
