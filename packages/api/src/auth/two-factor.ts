/**
 * Verificação em duas etapas (issue #95, RNF-08): segredo cifrado, códigos de recuperação, o passo do código no
 * login e a exigência de 2FA na área de administração.
 *
 * - O segredo TOTP fica cifrado (AES-256-GCM, chave `TWO_FACTOR_ENCRYPTION_KEY`, o id do usuário como dado
 *   autenticado: o texto cifrado copiado para outra conta não abre).
 * - Os códigos de recuperação ficam só como HMAC-SHA256 com uma chave derivada da mesma variável: quem lê o banco
 *   não consegue testar os ~40 bits de cada código fora do servidor.
 * - O login de quem tem 2FA ativo não abre sessão: emite um **passo** (JWT de 5 min num cookie `httpOnly` só para
 *   `/api/v1/auth`) que `POST /auth/2fa/verify` troca pela sessão com `tfa` verdadeiro.
 * - Tentativas de código limitadas por conta (5 a cada 5 min), no login, ao ativar e ao desligar.
 */
import type { PrismaClient, Role } from '@nova/db';
import { SignJWT, jwtVerify } from 'jose';
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppContext } from '../context';
import type { Env } from '../env';
import { forbidden, HttpProblem } from '../errors';
import { enforceLimit, type RateRule } from '../security';
import { REFRESH_PATH } from './cookies';
import { JWT_ISSUER } from './edge';
import { currentRoles, isAdmin } from './rbac';
import { requireSession } from './session';
import { normalizeRecoveryCode, verifyTotp } from './totp';

/** Tentativas de código por conta: 5 a cada 5 minutos (o código tem 10⁶ combinações e vale ~90 s). */
export const TWO_FACTOR_RULE: RateRule = { name: 'two-factor', tokens: 5, windowSeconds: 300 };

export const INVALID_CODE = () => new HttpProblem(400, 'Código incorreto ou vencido. Confira o aplicativo e tente de novo.', 'INVALID_CODE', { code: 'Código incorreto ou vencido.' });

// ── Chaves ───────────────────────────────────────────────────────────

function masterKey(env: Env): Buffer {
  const raw = env.TWO_FACTOR_ENCRYPTION_KEY;
  const key = raw ? Buffer.from(raw, 'base64') : null;
  if (!key || key.length !== 32) throw new HttpProblem(503, 'A verificação em duas etapas está indisponível no momento. Avise o suporte.', 'TWO_FACTOR_UNAVAILABLE');
  return key;
}

const derive = (env: Env, info: string) => Buffer.from(hkdfSync('sha256', masterKey(env), Buffer.alloc(0), `nova-arena/2fa/${info}`, 32));

export function encryptSecret(env: Env, userId: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive(env, 'totp-secret'), iv);
  cipher.setAAD(Buffer.from(userId));
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(env: Env, userId: string, value: string): string {
  const [version, iv, tag, data] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new HttpProblem(500, 'Configuração de duas etapas com formato desconhecido.', 'TWO_FACTOR_CORRUPTED');
  try {
    const decipher = createDecipheriv('aes-256-gcm', derive(env, 'totp-secret'), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // Chave trocada ou dado adulterado: nunca aceita código contra lixo.
    throw new HttpProblem(500, 'Não foi possível conferir a verificação em duas etapas. Avise o suporte.', 'TWO_FACTOR_CORRUPTED');
  }
}

export function hashRecoveryCode(env: Env, code: string): string {
  return createHmac('sha256', derive(env, 'recovery-code')).update(normalizeRecoveryCode(code)).digest('hex');
}

// ── Estado ───────────────────────────────────────────────────────────

export async function twoFactorEnabled(db: PrismaClient, userId: string): Promise<boolean> {
  const row = await db.twoFactor.findUnique({ where: { userId }, select: { enabledAt: true } });
  return Boolean(row?.enabledAt);
}

/**
 * Confere um código (do aplicativo ou de recuperação) de quem tem 2FA ativo. O código do aplicativo só vale uma
 * vez (guarda o passo usado); o de recuperação é gasto numa atualização condicional (dois pedidos ao mesmo
 * tempo com o mesmo código: só um passa). Tentativas limitadas por conta.
 */
export async function verifyTwoFactorCode(c: AppContext, userId: string, input: string): Promise<'totp' | 'recovery'> {
  const { db: getDb, now, limiter } = c.get('deps');
  const env = c.get('env');
  await enforceLimit(limiter(env), TWO_FACTOR_RULE, userId, now());
  const db = getDb();
  const record = await db.twoFactor.findUnique({ where: { userId } });
  if (!record?.enabledAt) throw new HttpProblem(409, 'A verificação em duas etapas já está desligada.', 'TWO_FACTOR_NOT_ENABLED');
  const typed = input.trim();
  if (/^\d{3}\s?\d{3}$/.test(typed)) {
    const step = verifyTotp(decryptSecret(env, userId, record.secretEnc), typed, now().getTime());
    if (step === null || (record.lastUsedStep !== null && step <= record.lastUsedStep)) throw INVALID_CODE();
    const claimed = await db.twoFactor.updateMany({ where: { userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] }, data: { lastUsedStep: step } });
    if (claimed.count === 0) throw INVALID_CODE();
    return 'totp';
  }
  const hash = hashRecoveryCode(env, typed);
  if (!record.recoveryCodesHash.includes(hash)) throw INVALID_CODE();
  const spent = await db.twoFactor.updateMany({
    where: { userId, recoveryCodesHash: { has: hash } },
    data: { recoveryCodesHash: record.recoveryCodesHash.filter((h) => h !== hash) },
  });
  if (spent.count === 0) throw INVALID_CODE();
  return 'recovery';
}

// ── Passo do código no login ─────────────────────────────────────────

export const CHALLENGE_COOKIE = 'na_tfa';
const CHALLENGE_AUDIENCE = 'nova-arena-2fa';
export const CHALLENGE_TTL_SECONDS = 5 * 60;

const secure = (c: AppContext) => new URL(c.req.url).protocol === 'https:';
const jwtKey = (env: Env) => {
  if (!env.AUTH_JWT_SECRET) throw new HttpProblem(500, 'O servidor está com a configuração incompleta. Avise o suporte.', 'CONFIG_INVALID');
  return new TextEncoder().encode(env.AUTH_JWT_SECRET);
};

/** Senha conferida, falta o código: guarda o passo num cookie que só vai para `/api/v1/auth`. */
export async function startTwoFactorChallenge(c: AppContext, user: { id: string; sessionVersion: number }): Promise<void> {
  const iat = Math.floor(c.get('deps').now().getTime() / 1000);
  const token = await new SignJWT({ sv: user.sessionVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setJti(randomUUID())
    .setIssuer(JWT_ISSUER)
    .setAudience(CHALLENGE_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + CHALLENGE_TTL_SECONDS)
    .sign(jwtKey(c.get('env')));
  setCookie(c, CHALLENGE_COOKIE, token, { httpOnly: true, secure: secure(c), sameSite: 'Lax', path: REFRESH_PATH, maxAge: CHALLENGE_TTL_SECONDS });
}

/** O passo pendente (usuário e versão da sessão) ou `null` se venceu, foi adulterado ou não existe. */
export async function readTwoFactorChallenge(c: AppContext): Promise<{ userId: string; sessionVersion: number } | null> {
  const token = getCookie(c, CHALLENGE_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwtKey(c.get('env')), { issuer: JWT_ISSUER, audience: CHALLENGE_AUDIENCE, algorithms: ['HS256'], currentDate: c.get('deps').now() });
    if (typeof payload.sub !== 'string' || typeof payload.sv !== 'number') return null;
    return { userId: payload.sub, sessionVersion: payload.sv };
  } catch {
    return null;
  }
}

export function clearTwoFactorChallenge(c: AppContext): void {
  deleteCookie(c, CHALLENGE_COOKIE, { path: REFRESH_PATH, secure: secure(c) });
}

// ── Área de administração ────────────────────────────────────────────

/**
 * Admin ou Super Admin **com 2FA ativo e feito nesta sessão** (RNF-08: sem 2FA, `/admin/*` responde 403
 * `TWO_FACTOR_REQUIRED`). `superAdmin: true` exige também o papel de Super Admin. Para os módulos `admin-*`.
 */
export async function requireAdminTwoFactor(c: AppContext, opts: { superAdmin?: boolean } = {}): Promise<{ userId: string; roles: Role[] }> {
  const session = await requireSession(c);
  const roles = await currentRoles(c);
  if (!isAdmin(roles)) throw forbidden();
  if (!session.twoFactorVerified || !(await twoFactorEnabled(c.get('deps').db(), session.userId))) {
    throw new HttpProblem(403, 'Ative a verificação em duas etapas para usar a área de administração.', 'TWO_FACTOR_REQUIRED');
  }
  if (opts.superAdmin && !roles.includes('SUPER_ADMIN')) throw forbidden('Só o Super Admin pode fazer isso.');
  return { userId: session.userId, roles };
}
