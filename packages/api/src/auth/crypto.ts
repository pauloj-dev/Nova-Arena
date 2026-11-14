/**
 * Senhas (Argon2id) e tokens. Tokens de e-mail e de refresh são aleatórios (256 bits) e só o hash
 * SHA-256 vai para o banco: quem lê o banco não consegue usar os tokens.
 */
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';

// Parâmetros recomendados pela OWASP para Argon2id (m=19 MiB, t=2, p=1).
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2);
}

/** Hash de uma senha qualquer, usado para gastar o mesmo tempo quando o e-mail não existe. */
let dummyHash: Promise<string> | undefined;

/** Confere a senha. Sem hash (conta inexistente ou só OAuth), compara com um hash falso no mesmo tempo. */
export async function verifyPassword(passwordHash: string | null | undefined, password: string): Promise<boolean> {
  if (!passwordHash) {
    dummyHash ??= hashPassword('nova-arena-senha-falsa');
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  return verify(passwordHash, password).catch(() => false);
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
