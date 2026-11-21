/**
 * Módulo `auth` (issue #67): cadastro, login, refresh, logout, verificação de e-mail e recuperação de
 * senha, mais `GET /me`. Porta de `apps/web/mocks/handlers/auth.ts`: mesmas rotas, mensagens e códigos.
 *
 * Diferenças da API simulada (registradas no PR):
 * - `POST /auth/refresh` existe (o mock não tem sessão real).
 * - `POST /auth/dev-login` não existe.
 * - `devVerifyToken`/`devResetToken` (atalho do protótipo) não existem: os links vão só por e-mail (issue #102).
 * - A flag `publicSignup` passa a valer quando as flags forem para o Edge Config (issue #94).
 * - Login com 2FA (issue #95): para quem tem 2FA ativo, `POST /auth/login` responde 202 `{ twoFactorRequired: true }`
 *   sem abrir sessão; o código (ou um de recuperação) vai em `POST /auth/2fa/verify`, que abre a sessão com `tfa`.
 */
import { ageOn, isMinor, MIN_AGE, ForgotPasswordInput, ForgotPasswordResponse, LoginInput, Me, Ok, RegisterInput, RegisterResponse, ResendVerificationResponse, ResetPasswordInput, TwoFactorChallenge, TwoFactorVerifyInput, VerifyEmailInput } from '@nova/schemas';
import { Hono } from 'hono';
import { body, respond, type AppEnv } from '../../context';
import { conflict, HttpProblem } from '../../errors';
import { assertHuman } from '../../auth/bot';
import { hashPassword, verifyPassword } from '../../auth/crypto';
import { createEmailToken, linkFor, useEmailToken } from '../../auth/email-tokens';
import { assertStrongPassword } from '../../auth/password-policy';
import { currentSession, endSession, loginGuard, requireSession, revokeAllSessions, rotateSession, startSession } from '../../auth/session';
import { clearTwoFactorChallenge, readTwoFactorChallenge, startTwoFactorChallenge, verifyTwoFactorCode } from '../../auth/two-factor';
import { publish } from '../../notify';
import { clientIp, enforceLimit, RULES } from '../../security';
import { loadMe, meInclude, toMe } from '../../views';
import { siteSettings } from '../site/store';

const MeOrNull = Me.nullable();

/** Fora de produção, o token do e-mail volta na resposta (as telas mostram o link enquanto não há e-mail real). */

export const auth = new Hono<AppEnv>();


/** 200 com `null` (e não 401) para visitante: a tela pública não deve gerar erro no console. */
auth.get('/me', async (c) => {
  const session = await currentSession(c);
  return respond(c, MeOrNull, session ? await loadMe(c.get('deps').db(), session.userId) : null);
});

auth.post('/auth/register', async (c) => {
  const { db, now, limiter, mailer } = c.get('deps');
  await enforceLimit(limiter(c.get('env')), RULES.register, clientIp(c.req.raw.headers), now());
  await assertHuman(c);
  const input = await body(c, RegisterInput);
  const email = input.email.toLowerCase();
  const client = db();
  if (await client.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new HttpProblem(409, 'Já existe uma conta com este e-mail.', 'EMAIL_TAKEN', { email: 'Já existe uma conta com este e-mail.' });
  }
  if (await client.user.findUnique({ where: { nicknameKey: input.nickname.toLowerCase() }, select: { id: true } })) {
    throw new HttpProblem(409, 'Este apelido já está em uso.', 'NICKNAME_TAKEN', { nickname: 'Este apelido já está em uso.' });
  }
  // Idade mínima da configuração do site (ADR-0001 Q5): o contrato já barra abaixo de MIN_AGE; aqui vale o valor atual.
  // Configuração indisponível: vale o piso do contrato (MIN_AGE), que já foi conferido.
  const minAge = await siteSettings(c).then((s) => s.minAge).catch(() => MIN_AGE);
  if (ageOn(input.birthDate, now()) < minAge) {
    throw new HttpProblem(400, 'Confira os campos destacados.', 'VALIDATION', { birthDate: `É preciso ter pelo menos ${minAge} anos para se cadastrar` });
  }
  await assertStrongPassword(c, input.password, { nickname: input.nickname, email });
  const passwordHash = await hashPassword(input.password);
  let user;
  try {
    user = await client.user.create({
      data: { email, nickname: input.nickname, nicknameKey: input.nickname.toLowerCase(), passwordHash, birthDate: new Date(`${input.birthDate}T00:00:00Z`), guardianConsentAt: isMinor(input.birthDate, now()) ? now() : null, country: 'Brasil', lastSeenAt: now(), roles: { create: { role: 'PARTICIPANT' } } },
      include: meInclude,
    });
  } catch (error) {
    // Corrida entre dois cadastros iguais: a restrição única do banco decide.
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002') throw conflict('Este e-mail ou apelido acabou de ser usado. Tente outro.', 'EMAIL_OR_NICKNAME_TAKEN');
    throw error;
  }
  const token = await createEmailToken(c, user.id, 'VERIFY');
  await mailer(c.get('env'), c.get('log')).send(email, { template: 'VERIFY_EMAIL', data: { nickname: user.nickname, link: linkFor(c, '/verificar-email', token) } });
  await startSession(c, user);
  return respond(c, RegisterResponse, { user: toMe(user) }, 201);
});

auth.post('/auth/login', async (c) => {
  const { db, now, limiter } = c.get('deps');
  await enforceLimit(limiter(c.get('env')), RULES.login, clientIp(c.req.raw.headers), now());
  const input = await body(c, LoginInput);
  const user = await db().user.findUnique({ where: { email: input.email.toLowerCase() }, include: meInclude });
  // Mesma mensagem e o mesmo tempo para e-mail inexistente e senha errada: não revela quem tem conta.
  const ok = await verifyPassword(user?.passwordHash, input.password);
  if (!user || !ok) throw new HttpProblem(401, 'E-mail ou senha incorretos.', 'INVALID_CREDENTIALS');
  loginGuard(user);
  // 2FA ativo: a senha só leva ao passo do código; a sessão abre em `/auth/2fa/verify`.
  if (user.twoFactor?.enabledAt) {
    await startTwoFactorChallenge(c, user);
    return respond(c, TwoFactorChallenge, { twoFactorRequired: true as const }, 202);
  }
  await db().user.update({ where: { id: user.id }, data: { lastSeenAt: now() } });
  await startSession(c, user);
  return respond(c, Me, toMe(user));
});

/**
 * Segundo passo do login: o código do aplicativo ou um código de recuperação (gasto na hora). Sem o passo
 * pendente (venceu em 5 min, ou a senha mudou nesse meio-tempo) → 401 `TWO_FACTOR_CHALLENGE_EXPIRED`.
 */
auth.post('/auth/2fa/verify', async (c) => {
  const { db, now } = c.get('deps');
  const challenge = await readTwoFactorChallenge(c);
  const user = challenge ? await db().user.findUnique({ where: { id: challenge.userId }, include: meInclude }) : null;
  if (!challenge || !user || user.sessionVersion !== challenge.sessionVersion) {
    clearTwoFactorChallenge(c);
    throw new HttpProblem(401, 'O tempo para informar o código acabou. Entre de novo com e-mail e senha.', 'TWO_FACTOR_CHALLENGE_EXPIRED');
  }
  loginGuard(user);
  const { code } = await body(c, TwoFactorVerifyInput);
  const method = await verifyTwoFactorCode(c, user.id, code);
  if (method === 'recovery') c.get('log').info('login com código de recuperação do 2FA', { userId: user.id });
  clearTwoFactorChallenge(c);
  await db().user.update({ where: { id: user.id }, data: { lastSeenAt: now() } });
  await startSession(c, user, { twoFactorVerified: true });
  return respond(c, Me, await loadMe(db(), user.id));
});

/** Troca o refresh token (rotação) e devolve a conta. Reuso de token já trocado derruba a família. */
auth.post('/auth/refresh', async (c) => {
  const user = await rotateSession(c);
  return respond(c, Me, await loadMe(c.get('deps').db(), user.id));
});

auth.post('/auth/logout', async (c) => {
  await endSession(c);
  return c.body(null, 204);
});

auth.post('/auth/verify-email', async (c) => {
  const { db, now, limiter } = c.get('deps');
  await enforceLimit(limiter(c.get('env')), RULES.verifyEmail, clientIp(c.req.raw.headers), now());
  const { token } = await body(c, VerifyEmailInput);
  const record = await useEmailToken(c, token, 'VERIFY', 'Este link de verificação é inválido ou já foi usado.');
  await db().user.update({ where: { id: record.userId }, data: { emailVerified: true } });
  return respond(c, Me, await loadMe(db(), record.userId));
});

auth.post('/auth/resend-verification', async (c) => {
  const session = await requireSession(c);
  const { db, mailer } = c.get('deps');
  const user = await db().user.findUniqueOrThrow({ where: { id: session.userId } });
  if (user.emailVerified) throw conflict('Seu e-mail já está verificado.');
  const token = await createEmailToken(c, user.id, 'VERIFY');
  await mailer(c.get('env'), c.get('log')).send(user.email, { template: 'VERIFY_EMAIL', data: { nickname: user.nickname, link: linkFor(c, '/verificar-email', token) } });
  return respond(c, ResendVerificationResponse, { ok: true });
});

/** Sempre 200: a resposta não revela se o e-mail tem conta. */
auth.post('/auth/forgot-password', async (c) => {
  const { db, now, limiter, mailer } = c.get('deps');
  await enforceLimit(limiter(c.get('env')), RULES.forgotPassword, clientIp(c.req.raw.headers), now());
  await assertHuman(c);
  const { email } = await body(c, ForgotPasswordInput);
  const user = await db().user.findUnique({ where: { email: email.toLowerCase() } });
  if (user && user.status !== 'DELETED' && user.status !== 'MERGED') {
    const token = await createEmailToken(c, user.id, 'RESET');
    await mailer(c.get('env'), c.get('log')).send(user.email, { template: 'RESET_PASSWORD', data: { nickname: user.nickname, link: linkFor(c, '/redefinir-senha', token) } });
  }
  return respond(c, ForgotPasswordResponse, { ok: true });
});

/** Nova senha: derruba todas as sessões abertas (quem tinha a senha antiga sai de todos os aparelhos). */
auth.post('/auth/reset-password', async (c) => {
  const { db, now } = c.get('deps');
  const { token, password } = await body(c, ResetPasswordInput);
  // A senha é conferida antes de gastar o link: se for recusada, a pessoa tenta outra com o mesmo link.
  await assertStrongPassword(c, password);
  const record = await useEmailToken(c, token, 'RESET', 'Este link de redefinição é inválido ou já foi usado.');
  await db().user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(password) } });
  await revokeAllSessions(db(), record.userId, now());
  // As telas abertas em outros aparelhos voltam para visitante na hora (canal `user:{id}`).
  await publish(c, `user:${record.userId}`, { type: 'session.revoked', reason: 'PASSWORD_RESET' });
  return respond(c, Ok, { ok: true as const });
});

