/**
 * Módulo `auth` (issue #67): cadastro, login, refresh, logout, verificação de e-mail e recuperação de
 * senha, mais `GET /me`. Porta de `apps/web/mocks/handlers/auth.ts`: mesmas rotas, mensagens e códigos.
 *
 * Diferenças da API simulada (registradas no PR):
 * - `POST /auth/refresh` existe (o mock não tem sessão real).
 * - `POST /auth/dev-login` não existe.
 * - `devVerifyToken`/`devResetToken` só voltam fora de produção (`VERCEL_ENV !== 'production'`), até os
 *   e-mails reais da issue #80; em produção esses campos nunca vão na resposta.
 * - A flag `publicSignup` passa a valer quando as flags forem para o Edge Config (issue #94).
 */
import { ForgotPasswordInput, ForgotPasswordResponse, LoginInput, Me, Ok, RegisterInput, RegisterResponse, ResendVerificationResponse, ResetPasswordInput, VerifyEmailInput } from '@nova/schemas';
import { Hono } from 'hono';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, HttpProblem } from '../../errors';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../auth/crypto';
import { currentSession, endSession, loginGuard, requireSession, revokeAllSessions, rotateSession, startSession } from '../../auth/session';
import { clientIp, enforceLimit, RULES } from '../../security';
import { loadMe, meInclude, toMe } from '../../views';

const VERIFY_TTL_MS = 24 * 3600_000;
const RESET_TTL_MS = 3600_000;
const MeOrNull = Me.nullable();

/** Fora de produção, o token do e-mail volta na resposta (as telas mostram o link enquanto não há e-mail real). */
const devToken = (c: AppContext, token: string | null) => (c.get('env').VERCEL_ENV === 'production' ? undefined : token);

async function createEmailToken(c: AppContext, userId: string, type: 'VERIFY' | 'RESET'): Promise<string> {
  const token = randomToken();
  const ttl = type === 'VERIFY' ? VERIFY_TTL_MS : RESET_TTL_MS;
  await c.get('deps').db().emailToken.create({ data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(c.get('deps').now().getTime() + ttl) } });
  return token;
}

function linkFor(c: AppContext, path: string, token: string): string {
  const base = c.get('env').NEXT_PUBLIC_SITE_URL ?? new URL(c.req.url).origin;
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}

/** Token de e-mail válido (existe, do tipo certo, não usado e não vencido) → o registro. */
async function useEmailToken(c: AppContext, token: string, type: 'VERIFY' | 'RESET', invalidMessage: string) {
  const db = c.get('deps').db();
  const now = c.get('deps').now();
  const record = await db.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.type !== type || record.usedAt || record.expiresAt <= now) throw badRequest(invalidMessage, 'INVALID_TOKEN');
  // Marca como usado só se ninguém usou no meio do caminho (dois cliques no mesmo link).
  const { count } = await db.emailToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: now } });
  if (count === 0) throw badRequest(invalidMessage, 'INVALID_TOKEN');
  return record;
}

export const auth = new Hono<AppEnv>();


/** 200 com `null` (e não 401) para visitante: a tela pública não deve gerar erro no console. */
auth.get('/me', async (c) => {
  const session = await currentSession(c);
  return respond(c, MeOrNull, session ? await loadMe(c.get('deps').db(), session.userId) : null);
});

auth.post('/auth/register', async (c) => {
  const { db, now, limiter, mailer } = c.get('deps');
  await enforceLimit(limiter(c.get('env')), RULES.register, clientIp(c.req.raw.headers), now());
  const input = await body(c, RegisterInput);
  const email = input.email.toLowerCase();
  const client = db();
  if (await client.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new HttpProblem(409, 'Já existe uma conta com este e-mail.', 'EMAIL_TAKEN', { email: 'Já existe uma conta com este e-mail.' });
  }
  if (await client.user.findUnique({ where: { nicknameKey: input.nickname.toLowerCase() }, select: { id: true } })) {
    throw new HttpProblem(409, 'Este apelido já está em uso.', 'NICKNAME_TAKEN', { nickname: 'Este apelido já está em uso.' });
  }
  const passwordHash = await hashPassword(input.password);
  let user;
  try {
    user = await client.user.create({
      data: { email, nickname: input.nickname, nicknameKey: input.nickname.toLowerCase(), passwordHash, birthDate: new Date(`${input.birthDate}T00:00:00Z`), country: 'Brasil', lastSeenAt: now(), roles: { create: { role: 'PARTICIPANT' } } },
      include: meInclude,
    });
  } catch (error) {
    // Corrida entre dois cadastros iguais: a restrição única do banco decide.
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002') throw conflict('Este e-mail ou apelido acabou de ser usado. Tente outro.', 'EMAIL_OR_NICKNAME_TAKEN');
    throw error;
  }
  const token = await createEmailToken(c, user.id, 'VERIFY');
  await mailer(c.get('log')).send({ to: email, template: 'VERIFY_EMAIL', data: { nickname: user.nickname, link: linkFor(c, '/verificar-email', token) } });
  await startSession(c, user);
  return respond(c, RegisterResponse, { user: toMe(user), devVerifyToken: devToken(c, token) }, 201);
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
  await db().user.update({ where: { id: user.id }, data: { lastSeenAt: now() } });
  await startSession(c, user);
  return respond(c, Me, toMe(user));
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
  await mailer(c.get('log')).send({ to: user.email, template: 'VERIFY_EMAIL', data: { nickname: user.nickname, link: linkFor(c, '/verificar-email', token) } });
  return respond(c, ResendVerificationResponse, { ok: true, devVerifyToken: devToken(c, token) });
});

/** Sempre 200: a resposta não revela se o e-mail tem conta. */
auth.post('/auth/forgot-password', async (c) => {
  const { db, now, limiter, mailer } = c.get('deps');
  await enforceLimit(limiter(c.get('env')), RULES.forgotPassword, clientIp(c.req.raw.headers), now());
  const { email } = await body(c, ForgotPasswordInput);
  const user = await db().user.findUnique({ where: { email: email.toLowerCase() } });
  let token: string | null = null;
  if (user && user.status !== 'DELETED' && user.status !== 'MERGED') {
    token = await createEmailToken(c, user.id, 'RESET');
    await mailer(c.get('log')).send({ to: user.email, template: 'RESET_PASSWORD', data: { nickname: user.nickname, link: linkFor(c, '/redefinir-senha', token) } });
  }
  return respond(c, ForgotPasswordResponse, { ok: true, devResetToken: devToken(c, token) });
});

/** Nova senha: derruba todas as sessões abertas (quem tinha a senha antiga sai de todos os aparelhos). */
auth.post('/auth/reset-password', async (c) => {
  const { db, now } = c.get('deps');
  const { token, password } = await body(c, ResetPasswordInput);
  const record = await useEmailToken(c, token, 'RESET', 'Este link de redefinição é inválido ou já foi usado.');
  await db().user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(password) } });
  await revokeAllSessions(db(), record.userId, now());
  return respond(c, Ok, { ok: true as const });
});

