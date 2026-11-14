/**
 * JWT de acesso (15 min, HS256 com `AUTH_JWT_SECRET`), em cookie `httpOnly` (ADR-009, RNF-06).
 * Carrega o usuário (`sub`), a sessão (`sid`), a versão da sessão do usuário (`sv`: sobe em sanção ou
 * troca de senha e invalida tokens antigos) e se o 2FA foi feito (`tfa`, usado em /admin, issue #95).
 */
import { jwtVerify, SignJWT } from 'jose';
import type { Env } from '../env';
import { HttpProblem } from '../errors';

export const ACCESS_TTL_SECONDS = 15 * 60;
const ISSUER = 'nova-arena';
const AUDIENCE = 'nova-arena-web';

export interface AccessClaims {
  sub: string;
  sid: string;
  sv: number;
  tfa: boolean;
}

function secretOf(env: Env): Uint8Array {
  if (!env.AUTH_JWT_SECRET) throw new HttpProblem(500, 'O servidor está com a configuração incompleta. Avise o suporte.', 'CONFIG_INVALID');
  return new TextEncoder().encode(env.AUTH_JWT_SECRET);
}

export function signAccessToken(env: Env, claims: AccessClaims, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ sid: claims.sid, sv: claims.sv, tfa: claims.tfa })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TTL_SECONDS)
    .sign(secretOf(env));
}

/** Valida assinatura, emissor, público e validade. Token inválido ou vencido → `null`. */
export async function verifyAccessToken(env: Env, token: string, now: Date): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretOf(env), { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'], currentDate: now });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.sv !== 'number') return null;
    return { sub: payload.sub, sid: payload.sid, sv: payload.sv, tfa: payload.tfa === true };
  } catch (error) {
    if (error instanceof HttpProblem) throw error;
    return null;
  }
}
