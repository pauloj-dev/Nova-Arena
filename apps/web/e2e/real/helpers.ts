/**
 * Caminhos equivalentes aos atalhos do protótipo, para os E2E com a API real (issue #102). Nada disso existe na API:
 * os testes falam com o banco do servidor de teste ou com a API como uma pessoa faria.
 *
 * | Protótipo                                   | API real                                                       |
 * |---------------------------------------------|----------------------------------------------------------------|
 * | `POST /auth/dev-login` (dentro da página)   | `apiAs(pessoa, …)`: sessão criada no banco, chamada pelo Node   |
 * | link de verificação/redefinição na tela     | `emailLink(email, tipo)`: o mesmo token que o e-mail levaria    |
 * | código do 2FA na tela (`/me/2fa/dev-code`)  | `totp(segredo)`: o código que o aplicativo autenticador mostra  |
 */
import { request, type APIRequestContext } from '@playwright/test';
import { demoId } from '@nova/api/demo-ids';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createSession, query } from './db';
import { requireServerEnv } from './env';

/** Contexto de requisições do Node com a sessão da pessoa (cookies `httpOnly`) e o `Origin` do site. */
export async function sessionContext(baseURL: string, mockUserId: string): Promise<APIRequestContext> {
  return sessionContextFor(baseURL, demoId(mockUserId));
}

/** Igual a `sessionContext`, pelo UUID da conta (ex.: o adversário lido do banco). */
export async function sessionContextFor(baseURL: string, userId: string): Promise<APIRequestContext> {
  const { access, refresh } = await createSession(userId);
  const url = new URL(baseURL);
  return request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: url.origin, 'x-forwarded-for': `198.19.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    storageState: {
      cookies: [
        { name: 'na_at', value: access, domain: url.hostname, path: '/', httpOnly: true, sameSite: 'Lax', secure: false, expires: -1 },
        { name: 'na_rt', value: refresh, domain: url.hostname, path: '/api/v1/auth', httpOnly: true, sameSite: 'Lax', secure: false, expires: -1 },
      ],
      origins: [],
    },
  });
}

/** Chamada à API como uma pessoa de demonstração (fora da página aberta). */
export async function apiAs<T = unknown>(baseURL: string, mockUserId: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  return apiAsId<T>(baseURL, demoId(mockUserId), method, path, body);
}

/** Igual a `apiAs`, pelo UUID da conta. */
export async function apiAsId<T = unknown>(baseURL: string, userId: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const ctx = await sessionContextFor(baseURL, userId);
  try {
    const res = await ctx.fetch(`/api/v1${path}`, { method, ...(body === undefined ? {} : { data: body as object }) });
    const text = await res.text();
    return { status: res.status(), data: (text ? JSON.parse(text) : null) as T };
  } finally {
    await ctx.dispose();
  }
}

/**
 * O link que o e-mail levaria (verificação, redefinição de senha): o token de uso único é gravado no banco do mesmo
 * jeito que a API grava (só o hash), e o link aponta para a mesma página.
 */
export async function emailLink(email: string, type: 'VERIFY' | 'RESET'): Promise<string> {
  const [user] = await query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (!user) throw new Error(`Conta ${email} não existe`);
  const token = randomBytes(32).toString('base64url');
  await query(`INSERT INTO email_tokens (id, "userId", type, "tokenHash", "expiresAt") VALUES (gen_random_uuid(), $1, $2::"EmailTokenType", $3, now() + interval '1 hour')`, [
    user.id,
    type,
    createHash('sha256').update(token).digest('hex'),
  ]);
  return `${type === 'VERIFY' ? '/verificar-email' : '/redefinir-senha'}?token=${encodeURIComponent(token)}`;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Código TOTP do momento (RFC 6238: 6 dígitos, passo de 30 s), como o aplicativo autenticador mostraria. */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 15;
  const code = ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, '0');
}

/** Segredo do 2FA das contas de demonstração que nascem com ele ativo (Rafael e Ana): `SEED_DEMO_TOTP_SECRET`. */
export const demoTotpSecret = () => requireServerEnv('SEED_DEMO_TOTP_SECRET');

/**
 * Prova já enviada por alguém (upload privado confirmado), como depois do envio direto ao Vercel Blob: o endereço que
 * a tela manda nos envios de resultado. O arquivo em si não existe (o Blob não está configurado no ambiente local).
 */
export async function evidenceOf(userId: string): Promise<string> {
  const [row] = await query<{ id: string }>(
    `INSERT INTO uploads (id, "ownerId", purpose, access, "blobUrl", pathname, "contentType", size) VALUES (gen_random_uuid(), $1::uuid, 'evidence', 'private', 'https://blob.exemplo/' || gen_random_uuid() || '.png', 'evidence/' || $1::text || '/print.png', 'image/png', 1000) RETURNING id`,
    [userId],
  );
  return `/api/v1/files/${row?.id}`;
}
