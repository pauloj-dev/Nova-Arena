import { describe, expect, it } from 'vitest';
import { formatDateTime, formatTime, isoToLocalInput, localInputToIso, timeZoneLabel } from './datetime';

describe('datas em UTC exibidas no fuso da pessoa (PRD R8)', () => {
  const instant = '2026-11-14T23:00:00.000Z';

  it('o mesmo instante aparece em horários diferentes para São Paulo e Manaus', () => {
    expect(formatTime(instant, { timeZone: 'America/Sao_Paulo' })).toBe('20h');
    expect(formatTime(instant, { timeZone: 'America/Manaus' })).toBe('19h');
  });

  it('mostra minutos só quando não é hora cheia', () => {
    expect(formatTime('2026-11-14T23:30:00.000Z', { timeZone: 'America/Sao_Paulo' })).toBe('20h30');
  });

  it('sempre indica o fuso junto do horário', () => {
    expect(formatDateTime(instant, { timeZone: 'America/Sao_Paulo' })).toContain('horário de Brasília');
    expect(formatDateTime(instant, { timeZone: 'America/Manaus' })).toContain('horário de Manaus');
    expect(formatDateTime(instant, { timeZone: 'America/Sao_Paulo', withZone: false })).not.toContain('horário');
  });

  it('dá nome aos fusos conhecidos e usa o deslocamento nos demais', () => {
    expect(timeZoneLabel('America/Sao_Paulo')).toBe('horário de Brasília');
    expect(timeZoneLabel('Asia/Tokyo', new Date(instant))).toMatch(/GMT\+9/);
  });

  it('converte o valor digitado no fuso do organizador para UTC, e de volta', () => {
    expect(localInputToIso('2026-11-14T20:00', 'America/Sao_Paulo')).toBe(instant);
    expect(localInputToIso('2026-11-14T19:00', 'America/Manaus')).toBe(instant);
    expect(isoToLocalInput(instant, 'America/Sao_Paulo')).toBe('2026-11-14T20:00');
    expect(isoToLocalInput(instant, 'America/Manaus')).toBe('2026-11-14T19:00');
  });

  it('respeita a virada de horário de verão (Lisboa: UTC+1 no verão, UTC+0 no inverno)', () => {
    expect(localInputToIso('2026-07-01T20:00', 'Europe/Lisbon')).toBe('2026-07-01T19:00:00.000Z');
    expect(localInputToIso('2026-12-01T20:00', 'Europe/Lisbon')).toBe('2026-12-01T20:00:00.000Z');
    // Dia da virada (25/10/2026, 02:00 → 01:00): antes e depois da mudança.
    expect(localInputToIso('2026-10-25T00:30', 'Europe/Lisbon')).toBe('2026-10-24T23:30:00.000Z');
    expect(localInputToIso('2026-10-25T03:00', 'Europe/Lisbon')).toBe('2026-10-25T03:00:00.000Z');
  });

  it('recusa valor malformado', () => {
    expect(() => localInputToIso('amanhã', 'America/Sao_Paulo')).toThrow();
  });
});
