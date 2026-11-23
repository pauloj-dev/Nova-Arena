/**
 * TOTP (RFC 6238) sobre HOTP (RFC 4226) com HMAC-SHA1 do `node:crypto` — a mesma regra que a API simulada usa
 * (`apps/web/features/profile/security/totp.ts`): 6 dígitos, passo de 30 s e janela de ±1 passo.
 *
 * Implementação própria (em vez do `otplib`) porque são poucas linhas, sem dependência, e conferidas contra os
 * vetores das RFCs em `test/two-factor.unit.test.ts`. `verifyTotp` devolve o **passo** que bateu: quem chama
 * guarda o último passo usado e recusa o mesmo código de novo (proteção contra repetição).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  const out = Buffer.alloc(Math.floor((clean.length * 5) / 8));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    const v = BASE32.indexOf(char);
    if (v < 0) throw new Error('Chave Base32 inválida');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out[index] = (value >>> (bits - 8)) & 255;
      index += 1;
      bits -= 8;
    }
  }
  return out;
}

/** Segredo novo: 20 bytes aleatórios (160 bits, o tamanho recomendado pela RFC 4226), em Base32. */
export function generateSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

export function hotp(key: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 15;
  const binary = (((mac[offset] ?? 0) & 127) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

const keyOf = (secret: string | Uint8Array) => (typeof secret === 'string' ? base32Decode(secret) : secret);

export const stepAt = (timeMs: number) => Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS);

/** Código do instante informado (`secret` em Base32, como no aplicativo, ou em bytes). */
export function totp(secret: string | Uint8Array, timeMs: number, digits = TOTP_DIGITS): string {
  return hotp(keyOf(secret), stepAt(timeMs), digits);
}

/**
 * Confere o código no passo atual e nos vizinhos (±`window`). Devolve o passo que bateu, ou `null`.
 * Sem sair no primeiro acerto e com comparação de tempo constante: o tempo de resposta não revela nada.
 */
export function verifyTotp(secret: string | Uint8Array, code: string, timeMs: number, window = 1): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const key = keyOf(secret);
  const current = stepAt(timeMs);
  let matched: number | null = null;
  for (let delta = -window; delta <= window; delta += 1) {
    const step = current + delta;
    if (step < 0) continue;
    if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(clean)) && matched === null) matched = step;
  }
  return matched;
}

/** Endereço `otpauth://` que os aplicativos autenticadores entendem (formato "Key URI"). */
export function otpauthUrl(input: { issuer: string; account: string; secret: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({ secret: input.secret, issuer: input.issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString().replace(/\+/g, '%20')}`;
}

/** Códigos de recuperação de uso único, `xxxx-xxxx`, sem caracteres ambíguos (~40 bits cada). */
export function generateRecoveryCodes(count = 8): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const codes: string[] = [];
  for (let c = 0; c < count; c += 1) {
    // Amostragem por rejeição: sem viés de módulo.
    let code = '';
    while (code.replace('-', '').length < 8) {
      const byte = randomBytes(1)[0] ?? 0;
      if (byte >= alphabet.length * Math.floor(256 / alphabet.length)) continue;
      code += alphabet[byte % alphabet.length];
      if (code.length === 4) code += '-';
    }
    codes.push(code);
  }
  return codes;
}

/** Como a pessoa digita o código de recuperação: maiúsculas, espaços e sem o hífen também valem. */
export function normalizeRecoveryCode(input: string): string {
  const clean = input.trim().toLowerCase().replace(/[\s-]/g, '');
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}
