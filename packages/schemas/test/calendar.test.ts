import { describe, expect, it } from 'vitest';
import { buildIcs, calendarMatchTitle, estimatedMatchMinutes, icsDateTime, icsEscape, icsFold, matchToIcsEvent } from '../src/calendar';

const bytes = (s: string) => new TextEncoder().encode(s).length;
const now = new Date('2026-11-21T12:00:00.000Z');

const duel = {
  id: 'm1',
  kind: 'DUEL' as const,
  bestOf: 1,
  roundLabel: 'Quartas',
  stageName: 'Mata-mata',
  status: 'SCHEDULED' as const,
  scheduledAt: '2026-11-21T22:00:00.000Z',
  participants: [
    { name: 'Bianca', sourceLabel: null },
    { name: '', sourceLabel: 'Vencedor da partida 2' },
  ],
} as unknown as Parameters<typeof matchToIcsEvent>[0];

describe('formato iCalendar (RFC 5545)', () => {
  it('datas em UTC com Z', () => {
    expect(icsDateTime(new Date('2026-01-02T03:04:05.000Z'))).toBe('20260102T030405Z');
  });

  it('escapa barra, ponto e vírgula, vírgula e quebra de linha', () => {
    expect(icsEscape('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
  });

  it('dobra linhas longas em até 75 bytes sem partir caractere acentuado', () => {
    const line = `SUMMARY:${'Partida de eliminação ção '.repeat(10)}`;
    const folded = icsFold(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(bytes(p)).toBeLessThanOrEqual(75);
    for (const p of parts.slice(1)) expect(p.startsWith(' ')).toBe(true);
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
    expect(icsFold('CURTA:ok')).toBe('CURTA:ok');
  });

  it('monta o calendário com CRLF, atualização periódica e um evento por partida', () => {
    const event = matchToIcsEvent(duel, { name: 'Liga CR', slug: 'liga-cr' }, { siteUrl: 'https://novaarena.gg/' });
    expect(event).not.toBeNull();
    const ics = buildIcs({ name: 'Minhas partidas', timeZone: 'America/Sao_Paulo', events: event ? [event] : [], now });
    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
    expect(lines).toContain('X-WR-TIMEZONE:America/Sao_Paulo');
    expect(lines).toContain('DTSTAMP:20261121T120000Z');
    expect(lines).toContain('DTSTART:20261121T220000Z');
    expect(lines).toContain('DTEND:20261121T221500Z');
    expect(lines).toContain('UID:partida-m1@novaarena.gg');
    expect(lines).toContain('TRIGGER:-PT15M');
    expect(lines).toContain('URL:https://novaarena.gg/c/liga-cr?aba=partidas');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    // Nenhuma quebra de linha solta (só CRLF).
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('partida cancelada sai como CANCELLED e sem lembrete; sem horário fica de fora', () => {
    const cancelled = matchToIcsEvent({ ...duel, status: 'CANCELLED' } as typeof duel, { name: 'Liga', slug: 'liga' }, { siteUrl: 'https://x.gg' });
    const ics = buildIcs({ name: 'X', events: cancelled ? [cancelled] : [], now });
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).not.toContain('BEGIN:VALARM');
    expect(matchToIcsEvent({ ...duel, scheduledAt: null } as typeof duel, { name: 'Liga', slug: 'liga' }, { siteUrl: 'https://x.gg' })).toBeNull();
  });

  it('título e duração estimada por tipo de partida', () => {
    expect(calendarMatchTitle(duel, 'Liga')).toBe('Liga: Quartas · Bianca x Vencedor da partida 2');
    expect(calendarMatchTitle({ ...duel, kind: 'LOBBY', roundLabel: 'Queda 2' } as typeof duel, 'Copa FF')).toBe('Copa FF: Mata-mata · Queda 2');
    expect(estimatedMatchMinutes({ kind: 'DUEL', bestOf: 1 })).toBe(15);
    expect(estimatedMatchMinutes({ kind: 'DUEL', bestOf: 5 })).toBe(50);
    expect(estimatedMatchMinutes({ kind: 'LOBBY', bestOf: 1 })).toBe(30);
  });
});
