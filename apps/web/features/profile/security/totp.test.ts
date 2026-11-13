import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateRecoveryCodes, generateSecret, hotp, otpauthUrl, secondsToNextStep, totp, verifyTotp } from './totp';

const ascii = (text: string) => new TextEncoder().encode(text);
/** Segredo dos vetores de teste da RFC 6238 (SHA-1) e da RFC 4226. */
const RFC_KEY = ascii('12345678901234567890');

describe('TOTP (RFC 6238)', () => {
  // Apêndice B da RFC 6238, modo SHA-1, 8 dígitos.
  const vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  it.each(vectors)('em T=%i s o código é %s', async (seconds, expected) => {
    expect(await totp(RFC_KEY, { time: seconds * 1000, digits: 8 })).toBe(expected);
  });

  it('HOTP confere com o apêndice D da RFC 4226 (6 dígitos)', async () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    const got: string[] = [];
    for (let counter = 0; counter < expected.length; counter += 1) got.push(await hotp(RFC_KEY, counter));
    expect(got).toEqual(expected);
  });

  it('aceita o segredo em Base32, como o aplicativo autenticador recebe', async () => {
    const secret = base32Encode(RFC_KEY);
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(await totp(secret, { time: 59_000, digits: 8 })).toBe('94287082');
  });

  it('janela de ±1 passo: aceita o código anterior e o seguinte, recusa o que está a 2 passos', async () => {
    const secret = base32Encode(RFC_KEY);
    const now = 1_700_000_000_000;
    const at = (steps: number) => totp(secret, { time: now + steps * 30_000 });
    expect(await verifyTotp(secret, await at(0), { time: now })).toBe(true);
    expect(await verifyTotp(secret, await at(-1), { time: now })).toBe(true);
    expect(await verifyTotp(secret, await at(1), { time: now })).toBe(true);
    expect(await verifyTotp(secret, await at(2), { time: now })).toBe(false);
    expect(await verifyTotp(secret, await at(-2), { time: now })).toBe(false);
    expect(await verifyTotp(secret, await at(-1), { time: now, window: 0 })).toBe(false);
  });

  it('recusa código malformado sem lançar erro', async () => {
    const secret = base32Encode(RFC_KEY);
    for (const code of ['', '12345', '1234567', 'abcdef', '12 34']) expect(await verifyTotp(secret, code)).toBe(false);
  });

  it('aceita o código digitado com espaço no meio', async () => {
    const secret = base32Encode(RFC_KEY);
    const now = 1_700_000_000_000;
    const code = await totp(secret, { time: now });
    expect(await verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { time: now })).toBe(true);
  });
});

describe('Base32, segredo e endereço otpauth', () => {
  it('codifica e decodifica (vetores da RFC 4648)', () => {
    const cases: Array<[string, string]> = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [plain, encoded] of cases) {
      expect(base32Encode(ascii(plain))).toBe(encoded);
      expect(new TextDecoder().decode(base32Decode(encoded))).toBe(plain);
    }
    expect(new TextDecoder().decode(base32Decode('mzxw 6ytb-oi======'))).toBe('foobar');
    expect(() => base32Decode('MZXW6!')).toThrow();
  });

  it('gera segredo de 160 bits, diferente a cada vez', () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(a)).toHaveLength(20);
    expect(a).not.toBe(b);
  });

  it('monta o endereço otpauth com emissor e conta escapados', () => {
    const url = otpauthUrl({ issuer: 'Nova Arena', account: 'ana@novaarena.gg', secret: 'ABC234' });
    expect(url).toBe('otpauth://totp/Nova%20Arena:ana%40novaarena.gg?secret=ABC234&issuer=Nova%20Arena&algorithm=SHA1&digits=6&period=30');
  });

  it('diz quantos segundos faltam para o código trocar', () => {
    expect(secondsToNextStep(0)).toBe(30);
    expect(secondsToNextStep(29_000)).toBe(1);
    expect(secondsToNextStep(31_000)).toBe(29);
  });

  it('gera códigos de recuperação únicos no formato xxxx-xxxx', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const code of codes) expect(code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
  });
});
