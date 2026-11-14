/** Tokens de uso único enviados por e-mail (verificação, redefinição de senha, troca de e-mail). Só o hash fica no banco. */
import type { AppContext } from '../context';
import { badRequest } from '../errors';
import { randomToken, sha256 } from './crypto';

export type EmailTokenKind = 'VERIFY' | 'RESET' | 'CHANGE_EMAIL';

const TTL_MS: Record<EmailTokenKind, number> = { VERIFY: 24 * 3600_000, RESET: 3600_000, CHANGE_EMAIL: 24 * 3600_000 };

export async function createEmailToken(c: AppContext, userId: string, type: EmailTokenKind, newEmail?: string): Promise<string> {
  const token = randomToken();
  await c.get('deps').db().emailToken.create({ data: { userId, type, tokenHash: sha256(token), newEmail: newEmail ?? null, expiresAt: new Date(c.get('deps').now().getTime() + TTL_MS[type]) } });
  return token;
}

export function siteUrl(c: AppContext, path: string): string {
  return `${c.get('env').NEXT_PUBLIC_SITE_URL ?? new URL(c.req.url).origin}${path}`;
}

export function linkFor(c: AppContext, path: string, token: string): string {
  return `${siteUrl(c, path)}?token=${encodeURIComponent(token)}`;
}

/** Token válido (existe, do tipo certo, não usado e não vencido) → o registro, já marcado como usado. */
export async function useEmailToken(c: AppContext, token: string, type: EmailTokenKind, invalidMessage: string) {
  const db = c.get('deps').db();
  const now = c.get('deps').now();
  const record = await db.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.type !== type || record.usedAt || record.expiresAt <= now) throw badRequest(invalidMessage, 'INVALID_TOKEN');
  // Marca como usado só se ninguém usou no meio do caminho (dois cliques no mesmo link).
  const { count } = await db.emailToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: now } });
  if (count === 0) throw badRequest(invalidMessage, 'INVALID_TOKEN');
  return record;
}
