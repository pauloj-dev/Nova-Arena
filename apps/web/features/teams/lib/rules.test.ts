import { describe, expect, it } from 'vitest';
import {
  AttemptLimiter,
  INVITE_ATTEMPT_LIMIT,
  INVITE_ATTEMPT_WINDOW_MS,
  inviteExpiry,
  invitePath,
  inviteState,
  inviteStateMessage,
  isInviteCodeShape,
  normalizeInviteCode,
  validateLogoDataUrl,
  validateLogoFile,
} from './rules';

const NOW = new Date('2026-11-12T15:00:00.000Z');
const iso = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * 3_600_000).toISOString();

describe('convite de squad', () => {
  it('expira em 72 horas', () => {
    expect(inviteExpiry(NOW)).toBe(iso(72));
  });
  it('pendente dentro do prazo vale; pendente vencido é expirado', () => {
    expect(inviteState({ status: 'PENDING', expiresAt: iso(1) }, NOW)).toBe('VALID');
    expect(inviteState({ status: 'PENDING', expiresAt: iso(-1) }, NOW)).toBe('EXPIRED');
    expect(inviteState({ status: 'PENDING', expiresAt: NOW.toISOString() }, NOW)).toBe('EXPIRED');
  });
  it('revogado, aceito e recusado mantêm o estado, mesmo dentro do prazo', () => {
    expect(inviteState({ status: 'REVOKED', expiresAt: iso(10) }, NOW)).toBe('REVOKED');
    expect(inviteState({ status: 'ACCEPTED', expiresAt: iso(10) }, NOW)).toBe('ACCEPTED');
    expect(inviteState({ status: 'DECLINED', expiresAt: iso(10) }, NOW)).toBe('DECLINED');
    expect(inviteState({ status: 'EXPIRED', expiresAt: iso(10) }, NOW)).toBe('EXPIRED');
  });
  it('só o convite válido não tem mensagem de bloqueio', () => {
    expect(inviteStateMessage('VALID')).toBeNull();
    expect(inviteStateMessage('EXPIRED')).toMatch(/expirou/);
    expect(inviteStateMessage('REVOKED')).toMatch(/cancelado pelo capitão/);
  });
  it('normaliza o código digitado e confere o formato', () => {
    expect(normalizeInviteCode('  alfa42 ')).toBe('ALFA42');
    expect(isInviteCodeShape('ALFA42')).toBe(true);
    expect(isInviteCodeShape('ALFA4')).toBe(false);
    expect(isInviteCodeShape('ALFA-42')).toBe(false);
    expect(invitePath('ALFA42')).toBe('/squads/convite/ALFA42');
  });
});

describe('AttemptLimiter (força bruta de código)', () => {
  it('bloqueia depois de 10 erros em um minuto', () => {
    const limiter = new AttemptLimiter();
    const t0 = NOW.getTime();
    for (let i = 0; i < INVITE_ATTEMPT_LIMIT; i += 1) {
      expect(limiter.isBlocked('u1', t0 + i)).toBe(false);
      limiter.fail('u1', t0 + i);
    }
    expect(limiter.isBlocked('u1', t0 + 100)).toBe(true);
  });
  it('conta cada chave separadamente', () => {
    const limiter = new AttemptLimiter(2, 1000);
    limiter.fail('a', 0);
    limiter.fail('a', 1);
    expect(limiter.isBlocked('a', 2)).toBe(true);
    expect(limiter.isBlocked('b', 2)).toBe(false);
  });
  it('libera quando os erros saem da janela', () => {
    const limiter = new AttemptLimiter();
    const t0 = NOW.getTime();
    for (let i = 0; i < INVITE_ATTEMPT_LIMIT; i += 1) limiter.fail('u1', t0);
    expect(limiter.isBlocked('u1', t0 + INVITE_ATTEMPT_WINDOW_MS - 1)).toBe(true);
    expect(limiter.retryAfterSeconds('u1', t0 + 45_000)).toBe(15);
    expect(limiter.isBlocked('u1', t0 + INVITE_ATTEMPT_WINDOW_MS)).toBe(false);
    expect(limiter.retryAfterSeconds('u1', t0 + INVITE_ATTEMPT_WINDOW_MS)).toBe(0);
  });
  it('reset limpa tudo', () => {
    const limiter = new AttemptLimiter(1, 1000);
    limiter.fail('a', 0);
    limiter.reset();
    expect(limiter.isBlocked('a', 1)).toBe(false);
  });
});

describe('logo do squad', () => {
  const MB = 1024 * 1024;
  it('aceita imagem de até 5 MB', () => {
    expect(validateLogoFile({ type: 'image/png', size: 5 * MB })).toBeNull();
    expect(validateLogoFile({ type: 'image/webp', size: 10 })).toBeNull();
  });
  it('recusa arquivo que não é imagem e imagem grande demais', () => {
    expect(validateLogoFile({ type: 'application/pdf', size: 10 })).toMatch(/PNG, JPG, WebP ou GIF/);
    expect(validateLogoFile({ type: 'image/svg+xml', size: 10 })).toMatch(/PNG, JPG, WebP ou GIF/);
    expect(validateLogoFile({ type: 'image/jpeg', size: 5 * MB + 1 })).toMatch(/5 MB/);
  });
  it('confere o data URL que chega à API', () => {
    expect(validateLogoDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBeNull();
    expect(validateLogoDataUrl('https://exemplo.com/logo.png')).toMatch(/PNG, JPG, WebP ou GIF/);
    expect(validateLogoDataUrl('data:text/html;base64,PGI+')).toMatch(/PNG, JPG, WebP ou GIF/);
    expect(validateLogoDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toMatch(/PNG, JPG, WebP ou GIF/);
    expect(validateLogoDataUrl(`data:image/png;base64,${'A'.repeat(Math.ceil((5 * MB * 4) / 3) + 8)}`)).toMatch(/5 MB/);
  });
});
