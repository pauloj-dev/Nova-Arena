/**
 * Leitura do JWT de acesso **sem dependências do servidor** (só `jose`), para o `proxy.ts` do Next na borda
 * (issue #70). A borda só decide redirecionamentos: a checagem que vale continua na API.
 */
import { jwtVerify } from 'jose';

export const ACCESS_COOKIE = 'na_at';
export const JWT_ISSUER = 'nova-arena';
export const JWT_AUDIENCE = 'nova-arena-web';

export type EdgeRole = 'SUPER_ADMIN' | 'ADMIN' | 'ORGANIZER' | 'PARTICIPANT';
const ROLES: readonly string[] = ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER', 'PARTICIPANT'];

export interface EdgeClaims {
  sub: string;
  sid: string;
  sv: number;
  tfa: boolean;
  /** Papéis no momento em que o token foi emitido (até 15 min de atraso; a API confere no banco). */
  roles: EdgeRole[];
}

/** Valida assinatura, emissor, público e validade. Token inválido ou vencido → `null`. */
export async function readAccessClaims(secret: string, token: string, now: Date = new Date()): Promise<EdgeClaims | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithms: ['HS256'], currentDate: now });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.sv !== 'number') return null;
    const roles = Array.isArray(payload.roles) ? payload.roles.filter((r): r is EdgeRole => typeof r === 'string' && ROLES.includes(r)) : [];
    return { sub: payload.sub, sid: payload.sid, sv: payload.sv, tfa: payload.tfa === true, roles };
  } catch {
    return null;
  }
}

/**
 * Para onde a borda manda quem abre uma área protegida. `null` = deixa passar (a página e a API decidem o resto).
 * `two-factor`: Admin sem a verificação em duas etapas feita nesta sessão (RNF-08, issue #95) → página Segurança.
 */
export function edgeRedirect(pathname: string, claims: EdgeClaims | null): 'login' | 'forbidden' | 'two-factor' | null {
  const area = pathname === '/admin' || pathname.startsWith('/admin/') ? 'admin' : pathname === '/organizador' || pathname.startsWith('/organizador/') ? 'organizer' : null;
  if (!area) return null;
  if (!claims) return 'login';
  const allowed: EdgeRole[] = area === 'admin' ? ['SUPER_ADMIN', 'ADMIN'] : ['SUPER_ADMIN', 'ADMIN', 'ORGANIZER'];
  if (!claims.roles.some((r) => allowed.includes(r))) return 'forbidden';
  return area === 'admin' && !claims.tfa ? 'two-factor' : null;
}
