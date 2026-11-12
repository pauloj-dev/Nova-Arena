/**
 * Verificação em duas etapas por TOTP (RFC 6238) sobre HOTP (RFC 4226), com HMAC-SHA1 do `crypto.subtle`.
 * Funções puras: a API simulada usa agora e a API real usará a mesma regra (janela de ±1 passo de 30 s).
 */
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

/** Aceita minúsculas, espaços, hífens e `=` de preenchimento. Caractere fora do alfabeto gera erro. */
export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 5) / 8));
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
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

function counterBytes(counter: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(8);
  let high = Math.floor(counter / 2 ** 32);
  let low = counter >>> 0;
  for (let i = 7; i >= 4; i -= 1) {
    out[i] = low & 255;
    low >>>= 8;
  }
  for (let i = 3; i >= 0; i -= 1) {
    out[i] = high & 255;
    high >>>= 8;
  }
  return out;
}

/** HOTP (RFC 4226): HMAC-SHA1 do contador + truncamento dinâmico. */
export async function hotp(key: Uint8Array, counter: number, digits = TOTP_DIGITS): Promise<string> {
  const raw = new Uint8Array(key.length);
  raw.set(key);
  const cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBytes(counter)));
  const offset = (mac[mac.length - 1] ?? 0) & 15;
  const binary = (((mac[offset] ?? 0) & 127) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export interface TotpOptions {
  /** Instante em milissegundos (padrão: agora). */
  time?: number;
  step?: number;
  digits?: number;
}

function keyOf(secret: string | Uint8Array): Uint8Array {
  return typeof secret === 'string' ? base32Decode(secret) : secret;
}

/** Código TOTP do instante informado. `secret` em Base32 (como no aplicativo) ou em bytes. */
export function totp(secret: string | Uint8Array, opts: TotpOptions = {}): Promise<string> {
  const step = opts.step ?? TOTP_STEP_SECONDS;
  const counter = Math.floor((opts.time ?? Date.now()) / 1000 / step);
  return hotp(keyOf(secret), counter, opts.digits ?? TOTP_DIGITS);
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Confere o código aceitando o passo atual e `window` passos para trás e para a frente
 * (padrão ±1: tolera até 30 s de relógio adiantado ou atrasado).
 */
export async function verifyTotp(secret: string | Uint8Array, code: string, opts: TotpOptions & { window?: number } = {}): Promise<boolean> {
  const digits = opts.digits ?? TOTP_DIGITS;
  const clean = code.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(clean)) return false;
  const step = opts.step ?? TOTP_STEP_SECONDS;
  const window = opts.window ?? 1;
  const key = keyOf(secret);
  const current = Math.floor((opts.time ?? Date.now()) / 1000 / step);
  let ok = false;
  for (let delta = -window; delta <= window; delta += 1) {
    if (current + delta < 0) continue;
    // Sem sair no primeiro acerto: o tempo de resposta não revela qual passo bateu.
    if (sameText(await hotp(key, current + delta, digits), clean)) ok = true;
  }
  return ok;
}

/** Segundos que faltam para o código atual trocar. */
export function secondsToNextStep(time = Date.now(), step = TOTP_STEP_SECONDS): number {
  return step - (Math.floor(time / 1000) % step);
}

/** Endereço `otpauth://` que os aplicativos autenticadores entendem (formato "Key URI"). */
export function otpauthUrl(input: { issuer: string; account: string; secret: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({ secret: input.secret, issuer: input.issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString().replace(/\+/g, '%20')}`;
}

/** Códigos de recuperação de uso único, no formato `xxxx-xxxx` (sem caracteres ambíguos). */
export function generateRecoveryCodes(count = 8): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const codes: string[] = [];
  const bytes = new Uint8Array(count * 8);
  crypto.getRandomValues(bytes);
  for (let c = 0; c < count; c += 1) {
    let code = '';
    for (let i = 0; i < 8; i += 1) {
      code += alphabet[(bytes[c * 8 + i] ?? 0) % alphabet.length];
      if (i === 3) code += '-';
    }
    codes.push(code);
  }
  return codes;
}
