/**
 * Login social (issue #68): Google e Discord com `state` e PKCE, vinculação segura de contas e a gestão
 * dos provedores em "Minha conta".
 *
 * Regras de vinculação (contra tomada de conta), na ordem:
 * 1. Provedor já vinculado → entra nessa conta.
 * 2. Pessoa logada vinculando em "Minha conta" (`mode=link`) → vincula à conta dela.
 * 3. Já existe conta com o mesmo e-mail → só vincula se o e-mail estiver verificado **nos dois lados**
 *    (no provedor e na Nova Arena). Senão, volta ao login pedindo para entrar com a senha e vincular depois.
 * 4. E-mail novo → cria a conta (sem senha; a data de nascimento fica pendente).
 *
 * O fluxo é de navegação (o navegador vai e volta do provedor): erros viram redirecionamento para
 * `/entrar?erro=<código>`, não JSON.
 */
import { LoginMethods, Ok,OAuthProviderName, SetPasswordInput } from '@nova/schemas';
import { generateCodeVerifier, generateState } from 'arctic';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { conflict, HttpProblem, notFound } from '../../errors';
import { hashPassword } from '../../auth/crypto';
import type { OAuthProfile } from '../../auth/oauth';
import { nicknameBase } from '../../auth/oauth';
import { currentSession, requireSession, startSession } from '../../auth/session';

const FLOW_COOKIE = 'na_oauth';
const FLOW_PATH = '/api/v1/auth/oauth';
const FLOW_TTL_SECONDS = 600;

interface Flow {
  provider: string;
  state: string;
  verifier: string;
  next: string | null;
  mode: 'login' | 'link';
}

/** Só caminhos internos (`/algo`), nunca `//outro-site` nem URL absoluta: evita redirecionamento aberto. */
export function safeNext(value: string | undefined | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  return value.slice(0, 300);
}

function parseFlow(raw: string | undefined): Flow | null {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Flow;
  } catch {
    return null;
  }
}

const secure = (c: AppContext) => new URL(c.req.url).protocol === 'https:';
const redirectUri = (c: AppContext, provider: string) => `${c.get('env').NEXT_PUBLIC_SITE_URL ?? new URL(c.req.url).origin}/api/v1/auth/oauth/${provider}/callback`;
const fail = (c: AppContext, code: string) => c.redirect(`/entrar?erro=${code}`, 302);

function provider(c: AppContext) {
  const parsed = OAuthProviderName.safeParse(c.req.param('provider'));
  if (!parsed.success) throw notFound('Provedor');
  return parsed.data;
}

/** Apelido único a partir do nome do provedor: "Bianca", "Bianca2", "Bianca3"… */
async function uniqueNickname(c: AppContext, profile: OAuthProfile): Promise<string> {
  const db = c.get('deps').db();
  const base = nicknameBase(profile.name, profile.email);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 20 - String(i + 1).length)}${i + 1}`;
    if (!(await db.user.findUnique({ where: { nicknameKey: candidate.toLowerCase() }, select: { id: true } }))) return candidate;
  }
  return `${base.slice(0, 12)}${Math.floor(Math.random() * 1e8)}`.slice(0, 20);
}

export const oauth = new Hono<AppEnv>();

oauth.get('/auth/oauth/:provider', (c) => {
  const name = provider(c);
  const client = c.get('deps').oauth(c.get('env'), name, redirectUri(c, name));
  if (!client) return fail(c, 'oauth_indisponivel');
  const flow: Flow = { provider: name, state: generateState(), verifier: generateCodeVerifier(), next: safeNext(c.req.query('next')), mode: c.req.query('mode') === 'link' ? 'link' : 'login' };
  // `SameSite=Lax`: o cookie volta na navegação de retorno do provedor (GET de nível superior).
  setCookie(c, FLOW_COOKIE, Buffer.from(JSON.stringify(flow)).toString('base64url'), { httpOnly: true, secure: secure(c), sameSite: 'Lax', path: FLOW_PATH, maxAge: FLOW_TTL_SECONDS });
  return c.redirect(client.authorizationUrl(flow.state, flow.verifier).toString(), 302);
});

oauth.get('/auth/oauth/:provider/callback', async (c) => {
  const name = provider(c);
  const raw = getCookie(c, FLOW_COOKIE);
  deleteCookie(c, FLOW_COOKIE, { path: FLOW_PATH, secure: secure(c) });
  const flow = parseFlow(raw);
  if (c.req.query('error')) return fail(c, 'oauth_cancelado');
  const code = c.req.query('code');
  if (!flow || flow.provider !== name || !code || c.req.query('state') !== flow.state) return fail(c, 'oauth_estado');

  const client = c.get('deps').oauth(c.get('env'), name, redirectUri(c, name));
  if (!client) return fail(c, 'oauth_indisponivel');
  let profile: OAuthProfile;
  try {
    profile = await client.exchange(code, flow.verifier);
  } catch (error) {
    c.get('log').warn('falha no retorno do provedor', { provider: name, error: error instanceof Error ? error.message : String(error) });
    return fail(c, 'oauth_falhou');
  }

  const db = c.get('deps').db();
  const email = profile.email?.toLowerCase() ?? null;
  const linked = await db.oAuthAccount.findUnique({ where: { provider_providerAccountId: { provider: name, providerAccountId: profile.providerAccountId } }, include: { user: true } });

  // 2. Vincular a partir de "Minha conta".
  if (flow.mode === 'link') {
    const session = await currentSession(c);
    if (!session) return fail(c, 'sessao_expirada');
    if (linked && linked.userId !== session.userId) return c.redirect('/minha-conta/seguranca?erro=oauth_ja_vinculado', 302);
    if (!linked) await db.oAuthAccount.create({ data: { userId: session.userId, provider: name, providerAccountId: profile.providerAccountId, email, emailVerified: profile.emailVerified } });
    return c.redirect(flow.next ?? `/minha-conta/seguranca?vinculado=${name}`, 302);
  }

  let user = linked?.user ?? null;
  let created = false;
  if (!user && email) {
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      // 3. Mesma pessoa só com e-mail verificado nos dois lados; senão, nada de assumir a conta.
      if (!profile.emailVerified || !existing.emailVerified) return fail(c, 'oauth_email_existente');
      await db.oAuthAccount.create({ data: { userId: existing.id, provider: name, providerAccountId: profile.providerAccountId, email, emailVerified: true } });
      user = existing;
    }
  }
  if (!user) {
    // 4. Conta nova.
    if (!email) return fail(c, 'oauth_sem_email');
    const nickname = await uniqueNickname(c, profile);
    user = await db.user.create({
      data: {
        email,
        nickname,
        nicknameKey: nickname.toLowerCase(),
        emailVerified: profile.emailVerified,
        avatarUrl: profile.avatarUrl,
        country: 'Brasil',
        lastSeenAt: c.get('deps').now(),
        roles: { create: { role: 'PARTICIPANT' } },
        oauthAccounts: { create: { provider: name, providerAccountId: profile.providerAccountId, email, emailVerified: profile.emailVerified } },
      },
    });
    created = true;
  }

  // 1. (ou 3/4 resolvidos) — mesmas regras de bloqueio do login com senha.
  if (user.status === 'BANNED') return fail(c, 'conta_banida');
  if (user.status === 'SUSPENDED') return fail(c, 'conta_suspensa');
  if (user.status !== 'ACTIVE') return fail(c, 'oauth_falhou');
  await startSession(c, user);
  // Conta nova completa a data de nascimento (idade mínima, ADR-0001 Q5) em "Minha conta".
  return c.redirect(created ? '/minha-conta?completar=1' : (flow.next ?? '/'), 302);
});

/** Jeitos de entrar: se a conta tem senha e quais provedores estão vinculados. */
oauth.get('/me/oauth', async (c) => {
  const session = await requireSession(c);
  const user = await c.get('deps').db().user.findUniqueOrThrow({ where: { id: session.userId }, select: { passwordHash: true, oauthAccounts: { orderBy: { createdAt: 'asc' } } } });
  const links = user.oauthAccounts.map((l) => ({ provider: l.provider, email: l.email, linkedAt: l.createdAt.toISOString() }));
  return respond(c, LoginMethods, { hasPassword: user.passwordHash !== null, links });
});

/** Desvincula um provedor, sem deixar a conta sem nenhum jeito de entrar. */
oauth.delete('/me/oauth/:provider', async (c) => {
  const session = await requireSession(c);
  const name = provider(c);
  const db = c.get('deps').db();
  const user = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { passwordHash: true, oauthAccounts: { select: { provider: true } } } });
  if (!user.oauthAccounts.some((a) => a.provider === name)) throw notFound('Vínculo');
  const others = user.oauthAccounts.filter((a) => a.provider !== name).length;
  if (!user.passwordHash && others === 0) {
    throw new HttpProblem(409, 'Este é o único jeito de entrar na sua conta. Defina uma senha antes de desvincular.', 'LAST_LOGIN_METHOD');
  }
  await db.oAuthAccount.deleteMany({ where: { userId: session.userId, provider: name } });
  return c.body(null, 204);
});

/** Conta criada só com Google/Discord define a primeira senha. Trocar uma senha existente é outra rota (#69). */
oauth.post('/me/password', async (c) => {
  const session = await requireSession(c);
  const { password } = await body(c, SetPasswordInput);
  const db = c.get('deps').db();
  const user = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { passwordHash: true } });
  if (user.passwordHash) throw conflict('Sua conta já tem senha. Para trocar, informe a senha atual na troca de senha.', 'PASSWORD_ALREADY_SET');
  await db.user.update({ where: { id: session.userId }, data: { passwordHash: await hashPassword(password) } });
  return respond(c, Ok, { ok: true as const });
});
