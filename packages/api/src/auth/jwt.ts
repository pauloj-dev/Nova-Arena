/**
 * JWT de acesso (15 min, HS256 com `AUTH_JWT_SECRET`), em cookie `httpOnly` (ADR-009, RNF-06).
 * Carrega o usuário (`sub`), a sessão (`sid`), a versão da sessão do usuário (`sv`: sobe em sanção ou
 * troca de senha e invalida tokens antigos), se o 2FA foi feito (`tfa`, usado em /admin, issue #95) e os
 * papéis (`roles`, só para o `proxy.ts` redirecionar na borda; a API confere os papéis no banco, issue #70).
 */
import { SignJWT } from 'jose';
import type { Env } from '../env';
import { HttpProblem } from '../errors';
import { JWT_AUDIENCE, JWT_ISSUER, readAccessClaims, type EdgeClaims } from './edge';

export const ACCESS_TTL_SECONDS = 15 * 60;

export type AccessClaims = EdgeClaims;

function secretOf(env: Env): string {
  if (!env.AUTH_JWT_SECRET) throw new HttpProblem(500, 'O servidor está com a configuração incompleta. Avise o suporte.', 'CONFIG_INVALID');
  return env.AUTH_JWT_SECRET;
}

export function signAccessToken(env: Env, claims: AccessClaims, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ sid: claims.sid, sv: claims.sv, tfa: claims.tfa, roles: claims.roles })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TTL_SECONDS)
    .sign(new TextEncoder().encode(secretOf(env)));
}

/** Valida assinatura, emissor, público e validade. Token inválido ou vencido → `null`. */
export function verifyAccessToken(env: Env, token: string, now: Date): Promise<AccessClaims | null> {
  return readAccessClaims(secretOf(env), token, now);
}
