/**
 * Módulo `two-factor` (issue #95, RNF-08): a verificação em duas etapas da própria conta e a redefinição pelo
 * Super Admin. Porta da parte de 2FA de `apps/web/mocks/handlers/admin-settings.ts`: mesmas rotas, mensagens e
 * códigos de erro.
 *
 * Diferenças da API simulada:
 * - O segredo fica cifrado e os códigos de recuperação só como hash (`auth/two-factor.ts`); a repetição do mesmo
 *   código é recusada; tentativas de código limitadas por conta (5 a cada 5 min → 429 `RATE_LIMITED`).
 * - `qrSvg` vem vazio: a tela desenha o QR code a partir do `otpauthUrl` no próprio navegador.
 * - Ativar confere um código: a sessão atual passa a valer como "2FA feito" (o Admin entra na área de administração
 *   sem sair e entrar de novo).
 * - `GET /me/2fa/dev-code` (atalho do protótipo) **não existe**.
 * - A redefinição pelo Super Admin também tira o "2FA feito" das sessões abertas da conta.
 */
import { audited, withAudit, type Role } from '@nova/db';
import { TwoFactorDisableInput, TwoFactorEnabled, TwoFactorEnableInput, TwoFactorResetInput, TwoFactorSetup, TwoFactorStatus } from '@nova/schemas';
import { Hono } from 'hono';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, HttpProblem, notFound } from '../../errors';
import { currentRoles, isAdmin } from '../../auth/rbac';
import { markTwoFactorVerified, requireSession } from '../../auth/session';
import { generateRecoveryCodes, generateSecret, otpauthUrl, verifyTotp } from '../../auth/totp';
import { decryptSecret, encryptSecret, hashRecoveryCode, INVALID_CODE, requireAdminTwoFactor, TWO_FACTOR_RULE, verifyTwoFactorCode } from '../../auth/two-factor';
import { notify } from '../../notify';
import { clientIp, enforceLimit } from '../../security';

const ISSUER = 'Nova Arena';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALREADY_ENABLED = () => conflict('A verificação em duas etapas já está ativa nesta conta.', 'TWO_FACTOR_ALREADY_ENABLED');

async function statusOf(c: AppContext, userId: string, roles: readonly Role[]): Promise<TwoFactorStatus> {
  const row = await c.get('deps').db().twoFactor.findUnique({ where: { userId }, select: { enabledAt: true, recoveryCodesHash: true } });
  const enabled = Boolean(row?.enabledAt);
  return { enabled, required: isAdmin(roles), recoveryCodesLeft: enabled ? (row?.recoveryCodesHash.length ?? 0) : 0 };
}

const auditCtx = (c: AppContext, actorId: string) => ({ actorId, ip: clientIp(c.req.raw.headers), userAgent: c.req.header('user-agent') ?? null });

export const twoFactor = new Hono<AppEnv>();

twoFactor.get('/me/2fa', async (c) => {
  const session = await requireSession(c);
  return respond(c, TwoFactorStatus, await statusOf(c, session.userId, await currentRoles(c)));
});

/** Gera um segredo novo (cifrado no banco) e o endereço `otpauth://`. Nada é ativado até `/me/2fa/enable`. */
twoFactor.post('/me/2fa/setup', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const env = c.get('env');
  const current = await db.twoFactor.findUnique({ where: { userId: session.userId }, select: { enabledAt: true } });
  if (current?.enabledAt) throw ALREADY_ENABLED();
  const user = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { email: true } });
  const secret = generateSecret();
  const secretEnc = encryptSecret(env, session.userId, secret);
  await db.twoFactor.upsert({
    where: { userId: session.userId },
    create: { userId: session.userId, secretEnc, recoveryCodesHash: [] },
    update: { secretEnc, recoveryCodesHash: [], lastUsedStep: null, enabledAt: null },
  });
  c.header('Cache-Control', 'private, no-store');
  return respond(c, TwoFactorSetup, { secret, otpauthUrl: otpauthUrl({ issuer: ISSUER, account: user.email, secret }), qrSvg: '' });
});

/** Confere o primeiro código e ativa. Os códigos de recuperação só aparecem nesta resposta (no banco, só o hash). */
twoFactor.post('/me/2fa/enable', async (c) => {
  const session = await requireSession(c);
  const { db: getDb, now, limiter } = c.get('deps');
  const env = c.get('env');
  const db = getDb();
  const { code } = await body(c, TwoFactorEnableInput);
  const record = await db.twoFactor.findUnique({ where: { userId: session.userId } });
  if (record?.enabledAt) throw ALREADY_ENABLED();
  if (!record) throw conflict('Comece a configuração de novo para gerar um QR code.', 'TWO_FACTOR_NOT_STARTED');
  await enforceLimit(limiter(env), TWO_FACTOR_RULE, session.userId, now());
  const step = verifyTotp(decryptSecret(env, session.userId, record.secretEnc), code, now().getTime());
  if (step === null) throw INVALID_CODE();
  const recoveryCodes = generateRecoveryCodes();
  const user = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { nickname: true } });
  await withAudit(db, auditCtx(c, session.userId), async (tx) => {
    // Condicional: dois pedidos ao mesmo tempo ativam uma vez só (o segundo cai no 409).
    const done = await tx.twoFactor.updateMany({
      where: { userId: session.userId, enabledAt: null, secretEnc: record.secretEnc },
      data: { enabledAt: now(), recoveryCodesHash: recoveryCodes.map((r) => hashRecoveryCode(env, r)), lastUsedStep: step },
    });
    if (done.count === 0) throw ALREADY_ENABLED();
    await audited(tx, { action: 'TWO_FACTOR_CHANGED', entityType: 'User', entityId: session.userId, entityLabel: user.nickname, before: { twoFactorEnabled: false }, after: { twoFactorEnabled: true } });
  });
  // Quem acabou de digitar o código já fez o 2FA nesta sessão.
  await markTwoFactorVerified(c);
  c.header('Cache-Control', 'private, no-store');
  return respond(c, TwoFactorEnabled, { recoveryCodes });
});

/** Desliga com o código do aplicativo ou um de recuperação. Para Admin e Super Admin é obrigatória (RNF-08). */
twoFactor.post('/me/2fa/disable', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const { code } = await body(c, TwoFactorDisableInput);
  const record = await db.twoFactor.findUnique({ where: { userId: session.userId }, select: { enabledAt: true } });
  if (!record?.enabledAt) throw conflict('A verificação em duas etapas já está desligada.', 'TWO_FACTOR_NOT_ENABLED');
  const roles = await currentRoles(c);
  if (isAdmin(roles)) throw new HttpProblem(403, 'Administradores não podem desligar a verificação em duas etapas.', 'TWO_FACTOR_REQUIRED');
  const method = await verifyTwoFactorCode(c, session.userId, code);
  const user = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { nickname: true } });
  await withAudit(db, auditCtx(c, session.userId), async (tx) => {
    await tx.twoFactor.deleteMany({ where: { userId: session.userId } });
    await audited(tx, {
      action: 'TWO_FACTOR_CHANGED',
      entityType: 'User',
      entityId: session.userId,
      entityLabel: user.nickname,
      before: { twoFactorEnabled: true },
      after: { twoFactorEnabled: false },
      reason: method === 'recovery' ? 'Desligada com código de recuperação' : null,
    });
  });
  return respond(c, TwoFactorStatus, await statusOf(c, session.userId, roles));
});

/** Quem perdeu o autenticador e os códigos: só o Super Admin redefine, com motivo, auditado (lacuna do PRD). */
twoFactor.post('/admin/users/:id/2fa/reset', async (c) => {
  const actor = await requireAdminTwoFactor(c, { superAdmin: true });
  const db = c.get('deps').db();
  const id = c.req.param('id');
  const target = UUID.test(id) ? await db.user.findUnique({ where: { id }, select: { id: true, nickname: true, twoFactor: { select: { enabledAt: true } }, roles: { select: { role: true } } } }) : null;
  if (!target) throw notFound('Usuário');
  const { reason } = await body(c, TwoFactorResetInput);
  if (target.id === actor.userId) throw badRequest('Para a sua própria conta, use a página Segurança.', 'SELF_RESET');
  if (!target.twoFactor?.enabledAt) throw conflict('Esta conta não tem a verificação em duas etapas ativa.', 'TWO_FACTOR_NOT_ENABLED');
  await withAudit(db, auditCtx(c, actor.userId), async (tx) => {
    await tx.twoFactor.deleteMany({ where: { userId: target.id } });
    // As sessões abertas deixam de valer como "2FA feito" (a área de administração volta a pedir a configuração).
    await tx.session.updateMany({ where: { userId: target.id, twoFactorVerified: true }, data: { twoFactorVerified: false } });
    await audited(tx, { action: 'TWO_FACTOR_CHANGED', entityType: 'User', entityId: target.id, entityLabel: target.nickname, before: { twoFactorEnabled: true }, after: { twoFactorEnabled: false }, reason });
  });
  const roles = target.roles.map((r) => r.role);
  await notify(c, [target.id], {
    type: 'SANCTION',
    title: 'Verificação em duas etapas redefinida',
    body: isAdmin(roles)
      ? 'A administração redefiniu a sua verificação em duas etapas. Configure de novo para voltar a acessar a área de administração.'
      : 'A administração redefiniu a sua verificação em duas etapas. Você pode configurar de novo quando quiser.',
    link: '/minha-conta/seguranca',
  });
  return respond(c, TwoFactorStatus, await statusOf(c, target.id, roles));
});
