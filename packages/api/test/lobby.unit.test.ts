/** Sala da partida sem banco (issue #83): cifra AES-256-GCM e mensagens do QStash amarradas ao horário. */
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { envFrom } from '../src';
import { decryptLobby, encryptLobby } from '../src/competition/lobby-crypto';
import { isCurrentSchedule, scheduleMatchJobs } from '../src/jobs/matches';

const env = envFrom({ NODE_ENV: 'test', LOBBY_ENCRYPTION_KEY: randomBytes(32).toString('base64') });

describe('código da sala cifrado', () => {
  it('cifra e decifra; o texto guardado não contém o código', () => {
    const enc = encryptLobby(env, 'partida-1', { code: 'SALA-4242', password: 'senha99' });
    expect(enc.startsWith('v1.')).toBe(true);
    expect(enc).not.toContain('SALA-4242');
    expect(enc).not.toContain('senha99');
    expect(decryptLobby(env, 'partida-1', enc)).toEqual({ code: 'SALA-4242', password: 'senha99' });
    // Mesmo código cifrado duas vezes dá textos diferentes (vetor aleatório).
    expect(encryptLobby(env, 'partida-1', { code: 'SALA-4242', password: null })).not.toBe(encryptLobby(env, 'partida-1', { code: 'SALA-4242', password: null }));
  });

  it('texto copiado para outra partida, adulterado ou com outra chave não abre', () => {
    const enc = encryptLobby(env, 'partida-1', { code: 'X1', password: null });
    expect(() => decryptLobby(env, 'partida-2', enc)).toThrow(/Não foi possível abrir a sala/);
    const parts = enc.split('.');
    const tampered = [...parts.slice(0, 3), `${parts[3]?.slice(0, -2)}AA`].join('.');
    expect(() => decryptLobby(env, 'partida-1', tampered)).toThrow();
    const other = envFrom({ NODE_ENV: 'test', LOBBY_ENCRYPTION_KEY: randomBytes(32).toString('base64') });
    expect(() => decryptLobby(other, 'partida-1', enc)).toThrow();
  });

  it('sem chave configurada (ou com chave de tamanho errado): 503, nada é guardado', () => {
    expect(() => encryptLobby(envFrom({ NODE_ENV: 'test' }), 'p', { code: 'X', password: null })).toThrow(/A sala não pode ser guardada/);
    expect(() => encryptLobby(envFrom({ NODE_ENV: 'test', LOBBY_ENCRYPTION_KEY: 'curta' }), 'p', { code: 'X', password: null })).toThrow();
  });
});

describe('mensagens da partida', () => {
  it('reagendar: a mensagem antiga deixa de valer', () => {
    const at = new Date('2026-11-20T22:00:00Z');
    expect(isCurrentSchedule({ scheduledAt: at }, { matchId: 'm', scheduledAt: '2026-11-20T22:00:00.000Z' })).toBe(true);
    expect(isCurrentSchedule({ scheduledAt: new Date('2026-11-20T23:00:00Z') }, { matchId: 'm', scheduledAt: at.toISOString() })).toBe(false);
    expect(isCurrentSchedule({ scheduledAt: null }, { matchId: 'm', scheduledAt: at.toISOString() })).toBe(false);
  });

  it('agenda no fechamento do check-in, com deduplicação pelo horário', async () => {
    const schedule = vi.fn(async () => undefined);
    const at = new Date('2026-11-20T22:00:00Z');
    await scheduleMatchJobs({ schedule }, { id: 'm1', scheduledAt: at }, '2026-11-20T21:50:00.000Z');
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({ at: new Date('2026-11-20T21:50:00.000Z'), dedupId: `checkin-m1-${at.getTime()}`, body: { matchId: 'm1', scheduledAt: at.toISOString() } }));
    await scheduleMatchJobs({ schedule }, { id: 'm1', scheduledAt: null }, null);
    expect(schedule).toHaveBeenCalledTimes(1);
  });
});
