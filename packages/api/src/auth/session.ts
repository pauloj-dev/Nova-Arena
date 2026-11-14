/**
 * Sessões (ADR-009, RNF-06): JWT de acesso de 15 min + refresh rotativo com detecção de reuso.
 *
 * Cada login abre uma **família** de refresh tokens. Usar o refresh troca o token (o antigo fica marcado
 * como substituído). Se alguém apresentar um token que já foi trocado, é sinal de roubo: a família
 * inteira é revogada e todos os aparelhos daquela família saem.
 */
import type { PrismaClient, User } from '@nova/db';
import { randomUUID } from 'node:crypto';
import type { AppContext, SessionInfo } from '../context';
import { HttpProblem, unauthorized } from '../errors';
import { clientIp } from '../security';
import { accessCookie, clearSessionCookies, refreshCookie, REFRESH_TTL_SECONDS, setSessionCookies } from './cookies';
import { randomToken, sha256 } from './crypto';
import { signAccessToken, verifyAccessToken } from './jwt';

/** Quem não pode entrar (mesmas mensagens e códigos da API simulada). */
export function loginGuard(user: Pick<User, 'status'>): void {
  if (user.status === 'BANNED') throw new HttpProblem(403, 'Esta conta foi banida.', 'ACCOUNT_BANNED');
  if (user.status === 'SUSPENDED') throw new HttpProblem(403, 'Esta conta está suspensa.', 'ACCOUNT_SUSPENDED');
  if (user.status === 'MERGED' || user.status === 'DELETED') throw new HttpProblem(401, 'E-mail ou senha incorretos.', 'INVALID_CREDENTIALS');
}

async function issue(c: AppContext, db: PrismaClient, user: Pick<User, 'id' | 'sessionVersion'>, familyId: string): Promise<string> {
  const { now } = c.get('deps');
  const refreshToken = randomToken();
  const session = await db.session.create({
    data: {
      userId: user.id,
      familyId,
      refreshTokenHash: sha256(refreshToken),
      sessionVersion: user.sessionVersion,
      userAgent: c.req.header('user-agent')?.slice(0, 500) ?? null,
      ip: clientIp(c.req.raw.headers),
      expiresAt: new Date(now().getTime() + REFRESH_TTL_SECONDS * 1000),
    },
  });
  const access = await signAccessToken(c.get('env'), { sub: user.id, sid: session.id, sv: user.sessionVersion, tfa: false }, now());
  setSessionCookies(c, access, refreshToken);
  c.set('session', { userId: user.id, sessionId: session.id, twoFactorVerified: false });
  return session.id;
}

/** Abre uma sessão nova (login, cadastro): nova família de refresh tokens. */
export function startSession(c: AppContext, user: Pick<User, 'id' | 'sessionVersion'>): Promise<string> {
  return issue(c, c.get('deps').db(), user, randomUUID());
}

/**
 * Troca o refresh token. Devolve o usuário da sessão.
 * - Token desconhecido ou vencido → 401 (sem sessão).
 * - Token já trocado ou revogado → reuso: revoga a família inteira e responde 401 `SESSION_REUSED`.
 */
export async function rotateSession(c: AppContext): Promise<User> {
  const db = c.get('deps').db();
  const now = c.get('deps').now();
  const token = refreshCookie(c);
  if (!token) throw unauthorized('Sua sessão terminou. Entre de novo.');
  const current = await db.session.findUnique({ where: { refreshTokenHash: sha256(token) }, include: { user: true } });
  if (!current) {
    clearSessionCookies(c);
    throw unauthorized('Sua sessão terminou. Entre de novo.');
  }
  if (current.revokedAt || current.replacedById) {
    await db.session.updateMany({ where: { familyId: current.familyId, revokedAt: null }, data: { revokedAt: now } });
    c.get('log').warn('reuso de refresh token: família revogada', { userId: current.userId, familyId: current.familyId });
    clearSessionCookies(c);
    throw new HttpProblem(401, 'Por segurança, encerramos suas sessões. Entre de novo.', 'SESSION_REUSED');
  }
  const user = current.user;
  if (current.expiresAt <= now || user.status !== 'ACTIVE' || current.sessionVersion !== user.sessionVersion) {
    await db.session.update({ where: { id: current.id }, data: { revokedAt: now } });
    clearSessionCookies(c);
    throw unauthorized('Sua sessão terminou. Entre de novo.');
  }
  const nextId = await issue(c, db, user, current.familyId);
  await db.session.update({ where: { id: current.id }, data: { revokedAt: now, replacedById: nextId, lastUsedAt: now } });
  return user;
}

/** Encerra a sessão atual (pelo refresh token ou pelo token de acesso) e apaga os cookies. */
export async function endSession(c: AppContext): Promise<void> {
  const db = c.get('deps').db();
  const now = c.get('deps').now();
  const token = refreshCookie(c);
  if (token) {
    const s = await db.session.findUnique({ where: { refreshTokenHash: sha256(token) } });
    if (s) await db.session.updateMany({ where: { familyId: s.familyId, revokedAt: null }, data: { revokedAt: now } });
  } else {
    const session = await currentSession(c);
    if (session) await db.session.updateMany({ where: { id: session.sessionId, revokedAt: null }, data: { revokedAt: now } });
  }
  clearSessionCookies(c);
  c.set('session', null);
}

/** Revoga todas as sessões do usuário e invalida os tokens de acesso em circulação (troca de senha, sanção). */
export async function revokeAllSessions(db: PrismaClient, userId: string, now: Date): Promise<void> {
  await db.$transaction([
    db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
    db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } }),
  ]);
}

/**
 * Sessão da requisição pelo token de acesso. Vale só se: token válido, sessão não revogada, conta ativa
 * e a versão da sessão do usuário não mudou (sanção ou troca de senha derrubam na hora).
 */
export async function currentSession(c: AppContext): Promise<SessionInfo | null> {
  const cached = c.get('session');
  if (cached !== undefined) return cached;
  const token = accessCookie(c);
  let session: SessionInfo | null = null;
  if (token) {
    const claims = await verifyAccessToken(c.get('env'), token, c.get('deps').now());
    if (claims) {
      const row = await c.get('deps').db().session.findUnique({ where: { id: claims.sid }, select: { revokedAt: true, userId: true, twoFactorVerified: true, user: { select: { status: true, sessionVersion: true } } } });
      if (row && !row.revokedAt && row.userId === claims.sub && row.user.status === 'ACTIVE' && row.user.sessionVersion === claims.sv) {
        session = { userId: claims.sub, sessionId: claims.sid, twoFactorVerified: claims.tfa || row.twoFactorVerified };
      }
    }
  }
  c.set('session', session);
  return session;
}

/** Exige login: sem sessão válida → 401. */
export async function requireSession(c: AppContext): Promise<SessionInfo> {
  const session = await currentSession(c);
  if (!session) throw unauthorized();
  return session;
}
