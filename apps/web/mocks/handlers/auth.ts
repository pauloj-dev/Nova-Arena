/** Módulo `auth` da API simulada: cadastro, login, sessão, verificação de e-mail e recuperação de senha. */
import { http } from 'msw';
import { ForgotPasswordInput, LoginInput, RegisterInput, ResetPasswordInput, VerifyEmailInput } from '@nova/schemas';
import { db, nowIso, save, setSessionUserId, uid, type DbUser } from '../db';
import { badRequest, body, conflict, currentUser, handle, HttpProblem, json, noContent, requireUser, url } from '../http';
import { toMe } from '../views';
import { isFlagEnabled } from './admin-settings';

export const moduleName = 'auth';

function loginGuard(user: DbUser) {
  if (user.status === 'BANNED') throw new HttpProblem(403, 'Esta conta foi banida.', 'ACCOUNT_BANNED');
  if (user.status === 'SUSPENDED') throw new HttpProblem(403, 'Esta conta está suspensa.', 'ACCOUNT_SUSPENDED');
  if (user.status === 'MERGED' || user.status === 'DELETED') throw new HttpProblem(401, 'E-mail ou senha incorretos.', 'INVALID_CREDENTIALS');
}

export const handlers = [
  http.get(
    url('/me'),
    handle(() => {
      const user = currentUser();
      // 200 com `null` (e não 401) para visitante: a tela pública não deve gerar erro no console.
      return json(user ? toMe(user) : null);
    }),
  ),

  http.post(
    url('/auth/register'),
    handle(async ({ request }) => {
      if (!isFlagEnabled('publicSignup')) throw new HttpProblem(403, 'O cadastro público está fechado no momento.', 'SIGNUP_CLOSED');
      const input = await body(request, RegisterInput);
      const d = db();
      if (d.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
        throw new HttpProblem(409, 'Já existe uma conta com este e-mail.', 'EMAIL_TAKEN', { email: 'Já existe uma conta com este e-mail.' });
      }
      if (d.users.some((u) => u.nickname.toLowerCase() === input.nickname.toLowerCase())) {
        throw new HttpProblem(409, 'Este apelido já está em uso.', 'NICKNAME_TAKEN', { nickname: 'Este apelido já está em uso.' });
      }
      const now = nowIso();
      const user: DbUser = {
        id: uid('u'),
        email: input.email,
        nickname: input.nickname,
        password: input.password,
        emailVerified: false,
        birthDate: input.birthDate,
        avatarUrl: null,
        country: 'Brasil',
        state: null,
        bio: null,
        socials: {},
        timezone: null,
        status: 'ACTIVE',
        roles: ['PARTICIPANT'],
        verifiedOrganizer: false,
        twoFactorEnabled: false,
        gameAccounts: [],
        organizerLimits: null,
        createdAt: now,
        lastSeenAt: now,
      };
      d.users.push(user);
      // No protótipo o "e-mail" de verificação é devolvido na resposta, para a tela mostrar o link.
      const token = uid('verify');
      d.emailTokens.push({ token, userId: user.id, type: 'VERIFY', usedAt: null });
      save();
      setSessionUserId(user.id);
      return json({ user: toMe(user), devVerifyToken: token }, 201);
    }),
  ),

  http.post(
    url('/auth/login'),
    handle(async ({ request }) => {
      const input = await body(request, LoginInput);
      const user = db().users.find((u) => u.email.toLowerCase() === input.email.toLowerCase());
      // Mesma mensagem para e-mail inexistente e senha errada: não revela quem tem conta.
      if (!user || user.password !== input.password) throw new HttpProblem(401, 'E-mail ou senha incorretos.', 'INVALID_CREDENTIALS');
      loginGuard(user);
      user.lastSeenAt = nowIso();
      save();
      setSessionUserId(user.id);
      return json(toMe(user));
    }),
  ),

  /** Só no protótipo: botões Google/Discord e o seletor "Entrar como". */
  http.post(
    url('/auth/dev-login'),
    handle(async ({ request }) => {
      const { userId } = (await request.json()) as { userId?: string };
      const user = db().users.find((u) => u.id === userId);
      if (!user) throw badRequest('Usuário de demonstração não encontrado.');
      loginGuard(user);
      setSessionUserId(user.id);
      return json(toMe(user));
    }),
  ),

  http.post(
    url('/auth/logout'),
    handle(() => {
      setSessionUserId(null);
      return noContent();
    }),
  ),

  http.post(
    url('/auth/verify-email'),
    handle(async ({ request }) => {
      const { token } = await body(request, VerifyEmailInput);
      const d = db();
      const record = d.emailTokens.find((t) => t.token === token && t.type === 'VERIFY');
      if (!record || record.usedAt) throw badRequest('Este link de verificação é inválido ou já foi usado.', 'INVALID_TOKEN');
      const user = d.users.find((u) => u.id === record.userId);
      if (!user) throw badRequest('Este link de verificação é inválido.', 'INVALID_TOKEN');
      record.usedAt = nowIso();
      user.emailVerified = true;
      save();
      return json(toMe(user));
    }),
  ),

  http.post(
    url('/auth/resend-verification'),
    handle(() => {
      const user = requireUser();
      if (user.emailVerified) throw conflict('Seu e-mail já está verificado.');
      const token = uid('verify');
      db().emailTokens.push({ token, userId: user.id, type: 'VERIFY', usedAt: null });
      save();
      return json({ ok: true, devVerifyToken: token });
    }),
  ),

  http.post(
    url('/auth/forgot-password'),
    handle(async ({ request }) => {
      const { email } = await body(request, ForgotPasswordInput);
      const d = db();
      const user = d.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
      let devResetToken: string | null = null;
      if (user) {
        devResetToken = uid('reset');
        d.emailTokens.push({ token: devResetToken, userId: user.id, type: 'RESET', usedAt: null });
        save();
      }
      // Sempre 200: a resposta não revela se o e-mail tem conta.
      return json({ ok: true, devResetToken });
    }),
  ),

  http.post(
    url('/auth/reset-password'),
    handle(async ({ request }) => {
      const { token, password } = await body(request, ResetPasswordInput);
      const d = db();
      const record = d.emailTokens.find((t) => t.token === token && t.type === 'RESET');
      if (!record || record.usedAt) throw badRequest('Este link de redefinição é inválido ou já foi usado.', 'INVALID_TOKEN');
      const user = d.users.find((u) => u.id === record.userId);
      if (!user) throw badRequest('Este link de redefinição é inválido.', 'INVALID_TOKEN');
      record.usedAt = nowIso();
      user.password = password;
      save();
      return json({ ok: true });
    }),
  ),
];
