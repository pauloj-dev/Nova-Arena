/** 2FA e tempo real sem banco (issues #95 e #97): TOTP pelas RFCs, cifra do segredo, hash dos códigos e permissões do Ably. */
import { describe, expect, it } from 'vitest';
import { envFrom } from '../src';
import { base32Decode, base32Encode, generateRecoveryCodes, generateSecret, hotp, normalizeRecoveryCode, otpauthUrl, totp, verifyTotp } from '../src/auth/totp';
import { decryptSecret, encryptSecret, hashRecoveryCode } from '../src/auth/two-factor';
import { buildCapability } from '../src/modules/realtime';

const RFC_KEY = Buffer.from('12345678901234567890');
const env = envFrom({ NODE_ENV: 'test', TWO_FACTOR_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('em T=%i s o código de 8 dígitos é %s (apêndice B, SHA-1)', (seconds, expected) => {
    expect(totp(RFC_KEY, seconds * 1000, 8)).toBe(expected);
  });

  it('HOTP confere com o apêndice D da RFC 4226', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expect(expected.map((_, counter) => hotp(RFC_KEY, counter))).toEqual(expected);
  });

  it('Base32 ida e volta, e o mesmo segredo que o aplicativo autenticador recebe', () => {
    expect(base32Encode(RFC_KEY)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq')).toEqual(RFC_KEY);
    expect(generateSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('janela de ±1 passo devolve o passo que bateu; fora dela ou malformado, nulo', () => {
    const secret = base32Encode(RFC_KEY);
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, totp(secret, now), now)).toBe(step);
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(secret, totp(secret, now + 30_000), now)).toBe(step + 1);
    expect(verifyTotp(secret, totp(secret, now + 60_000), now)).toBeNull();
    const code = totp(secret, now);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(step);
    for (const bad of ['', '12345', 'abcdef', '1234567']) expect(verifyTotp(secret, bad, now)).toBeNull();
  });

  it('otpauth:// no formato "Key URI"', () => {
    expect(otpauthUrl({ issuer: 'Nova Arena', account: 'bia@exemplo.com', secret: 'ABC' })).toBe('otpauth://totp/Nova%20Arena:bia%40exemplo.com?secret=ABC&issuer=Nova%20Arena&algorithm=SHA1&digits=6&period=30');
  });

  it('códigos de recuperação: 8, no formato xxxx-xxxx, sem repetir; digitação flexível', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
    expect(normalizeRecoveryCode(' ABCD EFGH ')).toBe('abcd-efgh');
    expect(normalizeRecoveryCode('abcdefgh')).toBe('abcd-efgh');
  });
});

describe('segredo cifrado e códigos guardados como hash', () => {
  it('o segredo cifrado só abre para a mesma conta e com a mesma chave', () => {
    const enc = encryptSecret(env, 'conta-a', 'JBSWY3DPEHPK3PXP');
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(env, 'conta-a', enc)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decryptSecret(env, 'conta-b', enc)).toThrow();
    const other = envFrom({ NODE_ENV: 'test', TWO_FACTOR_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64') });
    expect(() => decryptSecret(other, 'conta-a', enc)).toThrow();
  });

  it('sem a chave: 503 TWO_FACTOR_UNAVAILABLE (nunca guarda o segredo aberto)', () => {
    expect(() => encryptSecret(envFrom({ NODE_ENV: 'test' }), 'x', 'y')).toThrow(expect.objectContaining({ status: 503, code: 'TWO_FACTOR_UNAVAILABLE' }));
  });

  it('o hash do código de recuperação não revela o código e ignora a forma de digitar', () => {
    const h = hashRecoveryCode(env, 'abcd-efgh');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('abcd');
    expect(hashRecoveryCode(env, 'ABCDEFGH')).toBe(h);
    expect(hashRecoveryCode(env, 'abcd-efgj')).not.toBe(h);
  });
});

describe('permissões do token do Ably (issue #97)', () => {
  it('visitante: só os campeonatos, nunca `user:*` nem partida', () => {
    expect(buildCapability(null, [])).toEqual({ 'tournament:*': ['subscribe'] });
  });

  it('logado: o próprio canal e só as partidas liberadas, tudo só para assinar', () => {
    const cap = buildCapability('u1', ['m1']);
    expect(cap).toEqual({ 'tournament:*': ['subscribe'], 'user:u1': ['subscribe'], 'match:m1': ['subscribe'] });
    expect(Object.keys(cap).some((ch) => ch === 'user:*' || ch === 'match:*' || ch === '*')).toBe(false);
  });
});
