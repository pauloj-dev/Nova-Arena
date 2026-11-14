/**
 * Conta (issue #69): aparelhos conectados, troca de senha e troca de e-mail.
 *
 * - Um **aparelho** é uma família de refresh tokens (cada login abre uma). Encerrar um aparelho revoga a
 *   família inteira: o refresh deixa de funcionar e o token de acesso dele cai em até 15 min.
 * - **Trocar a senha** pede a atual, revoga todas as sessões (as outras saem; o token de acesso delas cai na
 *   hora pela `sessionVersion`) e abre uma sessão nova neste aparelho.
 * - **Trocar o e-mail** pede a senha e só vale depois de confirmar pelo link enviado ao endereço novo; o
 *   endereço antigo recebe um aviso.
 */
import { ChangeEmailInput, ChangeEmailResponse, ChangePasswordInput, describeDevice, DeviceSessions, maskIp, Me, Ok, VerifyEmailInput } from '@nova/schemas';
import { Hono } from 'hono';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, HttpProblem, notFound } from '../../errors';
import { hashPassword, verifyPassword } from '../../auth/crypto';
import { createEmailToken, linkFor, siteUrl, useEmailToken } from '../../auth/email-tokens';
import { assertStrongPassword } from '../../auth/password-policy';
import { requireSession, revokeAllSessions, startSession } from '../../auth/session';
import { clientIp, enforceLimit, RULES } from '../../security';
import { loadMe } from '../../views';

export { describeDevice, maskIp };

async function currentFamily(c: AppContext): Promise<{ userId: string; familyId: string }> {
  const session = await requireSession(c);
  const row = await c.get('deps').db().session.findUniqueOrThrow({ where: { id: session.sessionId }, select: { familyId: true } });
  return { userId: session.userId, familyId: row.familyId };
}

/** Confere a senha atual, com limite de tentativas por conta. Conta só com Google/Discord → 409 `NO_PASSWORD`. */
async function confirmPassword(c: AppContext, userId: string, password: string, field: string) {
  const { db, limiter, now } = c.get('deps');
  await enforceLimit(limiter(c.get('env')), RULES.confirmPassword, `user:${userId}`, now());
  const user = await db().user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash) throw conflict('Sua conta ainda não tem senha. Defina uma em Jeitos de entrar.', 'NO_PASSWORD');
  if (!(await verifyPassword(user.passwordHash, password))) throw new HttpProblem(400, 'Senha incorreta.', 'INVALID_PASSWORD', { [field]: 'Senha incorreta.' });
  return user;
}

const isUniqueViolation = (error: unknown) => error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002';

export const account = new Hono<AppEnv>();

account.get('/me/sessions', async (c) => {
  const { userId, familyId } = await currentFamily(c);
  const now = c.get('deps').now();
  const rows = await c.get('deps').db().session.findMany({
    where: { userId, revokedAt: null, replacedById: null, expiresAt: { gt: now } },
    orderBy: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
  });
  return respond(
    c,
    DeviceSessions,
    rows.map((s) => ({
      id: s.familyId,
      device: describeDevice(s.userAgent),
      ip: maskIp(s.ip),
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: (s.lastUsedAt ?? s.createdAt).toISOString(),
      current: s.familyId === familyId,
    })),
  );
});

/** Encerra todos os outros aparelhos (este continua). */
account.delete('/me/sessions', async (c) => {
  const { userId, familyId } = await currentFamily(c);
  await c.get('deps').db().session.updateMany({ where: { userId, familyId: { not: familyId }, revokedAt: null }, data: { revokedAt: c.get('deps').now() } });
  return c.body(null, 204);
});

/** Encerra um aparelho. Para sair deste, use o logout. */
account.delete('/me/sessions/:id', async (c) => {
  const { userId, familyId } = await currentFamily(c);
  const target = c.req.param('id');
  if (target === familyId) throw badRequest('Para sair deste aparelho, use "Sair".', 'CURRENT_SESSION');
  const { count } = await c.get('deps').db().session.updateMany({ where: { userId, familyId: target, revokedAt: null }, data: { revokedAt: c.get('deps').now() } });
  if (count === 0) throw notFound('Sessão');
  return c.body(null, 204);
});

account.post('/me/password/change', async (c) => {
  const { userId } = await currentFamily(c);
  const { currentPassword, newPassword } = await body(c, ChangePasswordInput);
  const user = await confirmPassword(c, userId, currentPassword, 'currentPassword');
  await assertStrongPassword(c, newPassword, { field: 'newPassword', nickname: user.nickname, email: user.email });
  const { db, now, mailer } = c.get('deps');
  await db().user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
  // Todas as sessões (e os tokens de acesso em circulação) caem; este aparelho ganha uma sessão nova.
  await revokeAllSessions(db(), userId, now());
  const fresh = await db().user.findUniqueOrThrow({ where: { id: userId } });
  await startSession(c, fresh);
  await mailer(c.get('env'), c.get('log')).send(fresh.email, { template: 'PASSWORD_CHANGED', data: { nickname: fresh.nickname, link: siteUrl(c, '/recuperar-senha') } });
  return respond(c, Ok, { ok: true as const });
});

account.post('/me/email', async (c) => {
  const { userId } = await currentFamily(c);
  const input = await body(c, ChangeEmailInput);
  const newEmail = input.newEmail.toLowerCase();
  const user = await confirmPassword(c, userId, input.password, 'password');
  if (newEmail === user.email) throw new HttpProblem(400, 'Esse já é o e-mail da sua conta.', 'SAME_EMAIL', { newEmail: 'Esse já é o e-mail da sua conta.' });
  const { db, now, mailer } = c.get('deps');
  if (await db().user.findUnique({ where: { email: newEmail }, select: { id: true } })) {
    throw new HttpProblem(409, 'Já existe uma conta com este e-mail.', 'EMAIL_TAKEN', { newEmail: 'Já existe uma conta com este e-mail.' });
  }
  // Um pedido por vez: links antigos de troca deixam de valer.
  await db().emailToken.updateMany({ where: { userId, type: 'CHANGE_EMAIL', usedAt: null }, data: { usedAt: now() } });
  const token = await createEmailToken(c, userId, 'CHANGE_EMAIL', newEmail);
  await mailer(c.get('env'), c.get('log')).send(newEmail, { template: 'CONFIRM_EMAIL_CHANGE', data: { nickname: user.nickname, link: linkFor(c, '/confirmar-email', token) } });
  const devConfirmToken = c.get('env').VERCEL_ENV === 'production' ? undefined : token;
  return respond(c, ChangeEmailResponse, { ok: true, pendingEmail: newEmail, devConfirmToken }, 202);
});

/** Link do e-mail novo. Não exige estar logado: o link pode ser aberto em outro aparelho. */
account.post('/auth/confirm-email-change', async (c) => {
  const { db, now, limiter, mailer } = c.get('deps');
  await enforceLimit(limiter(c.get('env')), RULES.verifyEmail, clientIp(c.req.raw.headers), now());
  const { token } = await body(c, VerifyEmailInput);
  const record = await useEmailToken(c, token, 'CHANGE_EMAIL', 'Este link de confirmação é inválido ou já foi usado.');
  if (!record.newEmail) throw badRequest('Este link de confirmação é inválido.', 'INVALID_TOKEN');
  const before = await db().user.findUniqueOrThrow({ where: { id: record.userId } });
  try {
    await db().user.update({ where: { id: record.userId }, data: { email: record.newEmail, emailVerified: true } });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Outra conta passou a usar este e-mail. Peça a troca de novo com outro endereço.', 'EMAIL_TAKEN');
    throw error;
  }
  await mailer(c.get('env'), c.get('log')).send(before.email, { template: 'EMAIL_CHANGED', data: { nickname: before.nickname, newEmail: record.newEmail, link: siteUrl(c, '/recuperar-senha') } });
  return respond(c, Me, await loadMe(db(), record.userId));
});
