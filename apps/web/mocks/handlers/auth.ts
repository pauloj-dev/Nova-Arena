/** Módulo `auth` da API simulada: cadastro, login, sessão, verificação de e-mail e recuperação de senha. */
import { http } from 'msw';
import { ChangeEmailInput, ChangePasswordInput, describeDevice, ForgotPasswordInput, LoginInput, OAuthProviderName, RegisterInput, ResetPasswordInput, SetPasswordInput, VerifyEmailInput, weakPasswordReason } from '@nova/schemas';
import { db, nowIso, save, setSessionUserId, uid, type DbUser } from '../db';
import { badRequest, body, conflict, currentUser, handle, HttpProblem, json, noContent, notFound, requireUser, url } from '../http';
import { toMe } from '../views';
import { isFlagEnabled } from './admin-settings';

export const moduleName = 'auth';

function loginGuard(user: DbUser) {
  if (user.status === 'BANNED') throw new HttpProblem(403, 'Esta conta foi banida.', 'ACCOUNT_BANNED');
  if (user.status === 'SUSPENDED') throw new HttpProblem(403, 'Esta conta está suspensa.', 'ACCOUNT_SUSPENDED');
  if (user.status === 'MERGED' || user.status === 'DELETED') throw new HttpProblem(401, 'E-mail ou senha incorretos.', 'INVALID_CREDENTIALS');
}

/** Senha fraca: a mesma regra da API real (a checagem de vazamento só existe lá). */
function assertNotWeak(password: string, context: { nickname?: string; email?: string } = {}, field = 'password') {
  const reason = weakPasswordReason(password, context);
  if (reason) throw new HttpProblem(400, reason, 'WEAK_PASSWORD', { [field]: reason });
}

/** Aparelhos de demonstração enquanto a pessoa não encerrar nenhum. */
function otherDevices(user: DbUser) {
  user.otherDevices ??= [{ id: 'dev_windows', device: 'Chrome no Windows', ip: '177.32.10.x', createdAt: '2026-11-01T22:10:00.000Z', lastUsedAt: '2026-11-12T23:40:00.000Z' }];
  return user.otherDevices;
}

function confirmPassword(user: DbUser, password: string, field: string) {
  if (user.password === '') throw conflict('Sua conta ainda não tem senha. Defina uma em Jeitos de entrar.', 'NO_PASSWORD');
  if (user.password !== password) throw new HttpProblem(400, 'Senha incorreta.', 'INVALID_PASSWORD', { [field]: 'Senha incorreta.' });
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
      assertNotWeak(input.password, { nickname: input.nickname, email: input.email });
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
      assertNotWeak(password);
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
  // Jeitos de entrar (issue #68). O vínculo em si só acontece com a API real (é uma ida ao provedor).
  http.get(
    url('/me/oauth'),
    handle(() => {
      const user = requireUser();
      return json({ hasPassword: user.password !== '', links: user.oauthLinks ?? [] });
    }),
  ),

  http.delete(
    url('/me/oauth/:provider'),
    handle(({ params }) => {
      const user = requireUser();
      const provider = OAuthProviderName.parse(params.provider);
      const links = user.oauthLinks ?? [];
      if (!links.some((l) => l.provider === provider)) throw notFound('Vínculo');
      if (user.password === '' && links.length === 1) {
        throw new HttpProblem(409, 'Este é o único jeito de entrar na sua conta. Defina uma senha antes de desvincular.', 'LAST_LOGIN_METHOD');
      }
      user.oauthLinks = links.filter((l) => l.provider !== provider);
      save();
      return noContent();
    }),
  ),

  http.post(
    url('/me/password'),
    handle(async ({ request }) => {
      const user = requireUser();
      const { password } = await body(request, SetPasswordInput);
      assertNotWeak(password, { nickname: user.nickname, email: user.email });
      if (user.password !== '') throw conflict('Sua conta já tem senha. Para trocar, informe a senha atual na troca de senha.', 'PASSWORD_ALREADY_SET');
      user.password = password;
      save();
      return json({ ok: true });
    }),
  ),

  // Aparelhos, troca de senha e de e-mail (issue #69).
  http.get(
    url('/me/sessions'),
    handle(({ request }) => {
      const user = requireUser();
      const current = { id: 'dev_atual', device: describeDevice(request.headers.get('user-agent') ?? (typeof navigator === 'undefined' ? null : navigator.userAgent)), ip: null, createdAt: user.lastSeenAt, lastUsedAt: nowIso(), current: true };
      return json([current, ...otherDevices(user).map((d) => ({ ...d, current: false }))]);
    }),
  ),

  http.delete(
    url('/me/sessions'),
    handle(() => {
      const user = requireUser();
      user.otherDevices = [];
      save();
      return noContent();
    }),
  ),

  http.delete(
    url('/me/sessions/:id'),
    handle(({ params }) => {
      const user = requireUser();
      if (params.id === 'dev_atual') throw badRequest('Para sair deste aparelho, use "Sair".', 'CURRENT_SESSION');
      const list = otherDevices(user);
      if (!list.some((d) => d.id === params.id)) throw notFound('Sessão');
      user.otherDevices = list.filter((d) => d.id !== params.id);
      save();
      return noContent();
    }),
  ),

  http.post(
    url('/me/password/change'),
    handle(async ({ request }) => {
      const user = requireUser();
      const { currentPassword, newPassword } = await body(request, ChangePasswordInput);
      confirmPassword(user, currentPassword, 'currentPassword');
      assertNotWeak(newPassword, { nickname: user.nickname, email: user.email }, 'newPassword');
      user.password = newPassword;
      user.otherDevices = [];
      save();
      return json({ ok: true });
    }),
  ),

  http.post(
    url('/me/email'),
    handle(async ({ request }) => {
      const user = requireUser();
      const input = await body(request, ChangeEmailInput);
      const newEmail = input.newEmail.toLowerCase();
      confirmPassword(user, input.password, 'password');
      if (newEmail === user.email.toLowerCase()) throw new HttpProblem(400, 'Esse já é o e-mail da sua conta.', 'SAME_EMAIL', { newEmail: 'Esse já é o e-mail da sua conta.' });
      const d = db();
      if (d.users.some((u) => u.email.toLowerCase() === newEmail)) throw new HttpProblem(409, 'Já existe uma conta com este e-mail.', 'EMAIL_TAKEN', { newEmail: 'Já existe uma conta com este e-mail.' });
      for (const t of d.emailTokens) if (t.userId === user.id && t.type === 'CHANGE_EMAIL' && !t.usedAt) t.usedAt = nowIso();
      const token = uid('tok');
      d.emailTokens.push({ token, userId: user.id, type: 'CHANGE_EMAIL', newEmail, usedAt: null });
      save();
      return json({ ok: true, pendingEmail: newEmail, devConfirmToken: token }, 202);
    }),
  ),

  http.post(
    url('/auth/confirm-email-change'),
    handle(async ({ request }) => {
      const { token } = await body(request, VerifyEmailInput);
      const d = db();
      const record = d.emailTokens.find((t) => t.token === token && t.type === 'CHANGE_EMAIL');
      if (!record || record.usedAt || !record.newEmail) throw badRequest('Este link de confirmação é inválido ou já foi usado.', 'INVALID_TOKEN');
      const user = d.users.find((u) => u.id === record.userId);
      if (!user) throw badRequest('Este link de confirmação é inválido.', 'INVALID_TOKEN');
      const newEmail = record.newEmail;
      if (d.users.some((u) => u.id !== user.id && u.email.toLowerCase() === newEmail)) throw conflict('Outra conta passou a usar este e-mail. Peça a troca de novo com outro endereço.', 'EMAIL_TAKEN');
      record.usedAt = nowIso();
      user.email = newEmail;
      user.emailVerified = true;
      save();
      return json(toMe(user));
    }),
  ),
];
